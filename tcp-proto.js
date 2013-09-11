
module.exports = function (platform, agent) {
  var common = require('git-proto')(platform, agent);
  var pushToPull = require('push-to-pull');
  var pktLine = require('git-pkt-line')(platform);
  var deframer = pushToPull(pktLine.deframer);
  var framer = pushToPull(pktLine.framer);
  var tcp = platform.tcp;
  var trace = platform.trace;

  return function (opts) {
    if (!opts.hostname || !opts.pathname) {
      throw new TypeError("Hostname and pathname are required for TCP");
    }
    opts.port = opts.port ? opts.port | 0 : 9418;
    var connection;

    return {
      discover: discover,
      fetch: fetch,
      push: push,
      close: closeConnection
    };

    function connect(callback) {
      return tcp.connect(opts.port, opts.hostname, function (err, socket) {
        if (err) return callback(err);
        var input = deframer(socket);
        if (trace) input = trace("input", input);

        var output = writable(input.abort);
        connection = {
          read: input.read,
          abort: input.abort,
          write: output
        };
        if (trace) output = trace("output", output);
        output = framer(output);
        socket.sink(output)(function (err) {
          if (err) console.error(err.stack || err);
          // TODO: handle this better somehow
          // maybe allow writable streams
        });
        callback();
      });
    }

    // Send initial git-upload-pack request
    // outputs refs and caps
    function discover(callback) {
      if (!callback) return discover.bind(this);
      if (!connection) {
        return connect(function (err) {
          if (err) return callback(err);
          return discover(callback);
        });
      }
      connection.write("git-upload-pack " + opts.pathname + "\0host=" + opts.hostname + "\0");
      common.discover(connection, callback);
    }

    function fetch(opts, callback) {
      if (!callback) return fetch.bind(this, opts);
      discover(function (err, refs, caps) {
        if (err) return callback(err);
        opts.refs = refs;
        opts.caps = caps;
        common.fetch(connection, opts, callback);
      });
    }

    function push() {
      throw new Error("TODO: Implement tcp-proto.push");
    }

    function closeConnection(callback) {
      if (!callback) return closeConnection.bind(this);
      connection.write(null);
      callback();
    }


  };
};

function writable(abort) {
  var queue = [];
  var emit = null;

  write.read = read;
  write.abort = abort;
  write.error = error;
  return write;

  function write(item) {
    queue.push([null, item]);
    check();
  }

  function error(err) {
    queue.push([err]);
    check();
  }

  function read(callback) {
    if (queue.length) {
      return callback.apply(null, queue.shift());
    }
    if (emit) return callback(new Error("Only one read at a time"));
    emit = callback;
    check();
  }

  function check() {
    if (emit && queue.length) {
      var callback = emit;
      emit = null;
      callback.apply(null, queue.shift());
    }
  }
}