// Client for the Pusher taxi WASM module (wasm/): sends requests over the sim's CommBus and assembles the reply.
// Protocol (all JSON strings):
//   JS -> module  "PusherTaxiPing"    {"id":1}                       -> reply kind "pong"
//   JS -> module  "PusherTaxiRequest" {"id":7,"icao":"NZCH"}         -> reply messages below
//   module -> JS  "PusherTaxiResponse" one of:
//     {"id","kind":"pong","version"}
//     {"id","kind":"meta","icao","refLat","refLon","points","parking","paths","skippedPaths","names","chunks"}
//     {"id","kind":"names","seq","items":["A","B"]}
//     {"id","kind":"parking","seq","items":[[label,type,lat,lon,headingDeg,radiusM],...]}
//     {"id","kind":"paths","seq","items":[[type,widthM,lat1,lon1,lat2,lon2,nameIndex],...]}
//     {"id","kind":"end","chunks"}
//     {"id","kind":"error","message"}
// The module and this client are tested against each other on the host (test/wasm-core.test.mjs); the sim side is not.

PS.wasmTaxi = (function () {
  var EVT_REQUEST = 'PusherTaxiRequest';
  var EVT_PING = 'PusherTaxiPing';
  var EVT_RESPONSE = 'PusherTaxiResponse';

  var listener = null;
  var nextId = 1;
  var waiters = {};
  var alive = false;
  var version = '';

  // Collects the messages of one request. add() returns the finished layout when everything has arrived, else null.
  // Tolerates messages arriving in any order; throws on an error message.
  function newAssembler() {
    var meta = null;
    var chunks = {};
    var chunkCount = 0;
    var ended = false;

    function build() {
      var names = [],
        parking = [],
        pathRows = [];
      var seqs = Object.keys(chunks)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        });
      seqs.forEach(function (s) {
        var c = chunks[s];
        if (c.kind === 'names') names = names.concat(c.items);
        else if (c.kind === 'parking') parking = parking.concat(c.items);
        else if (c.kind === 'paths') pathRows = pathRows.concat(c.items);
      });
      return {
        icao: meta.icao,
        refLat: meta.refLat,
        refLon: meta.refLon,
        counts: { points: meta.points, parking: meta.parking, paths: meta.paths, skippedPaths: meta.skippedPaths, names: meta.names },
        paths: pathRows.map(function (r) {
          return {
            name: names[r[6]] !== undefined ? names[r[6]] : '',
            type: r[0],
            widthM: r[1],
            points: [
              [r[2], r[3]],
              [r[4], r[5]]
            ]
          };
        }),
        parking: parking.map(function (r) {
          return { name: r[0], type: r[1], lat: r[2], lon: r[3], headingDeg: r[4], radiusM: r[5] };
        })
      };
    }

    return {
      add: function (msg) {
        if (msg.kind === 'error') throw new Error(msg.message || 'the taxi module reported an error');
        if (msg.kind === 'meta') meta = msg;
        else if (msg.kind === 'end') ended = true;
        else if (msg.kind === 'names' || msg.kind === 'parking' || msg.kind === 'paths') {
          if (!chunks[msg.seq]) chunkCount++;
          chunks[msg.seq] = msg;
        }
        if (meta && ended && chunkCount >= meta.chunks) return build();
        return null;
      }
    };
  }

  function parseMessage(raw) {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (raw && typeof raw === 'object') return raw;
    throw new Error('unexpected CommBus payload of type ' + typeof raw);
  }

  function finish(id, fn) {
    var w = waiters[id];
    if (!w) return;
    delete waiters[id];
    clearTimeout(w.timer);
    fn(w);
  }

  function onMessage(raw) {
    var msg;
    try {
      msg = parseMessage(raw);
    } catch (e) {
      PS.log('wasm', 'unreadable message: ' + PS.errText(e));
      return;
    }
    if (!msg || typeof msg !== 'object') return; // "null" parses fine but has no id
    var w = waiters[msg.id];
    if (msg.kind === 'pong') {
      alive = true;
      version = msg.version || '';
      if (w)
        finish(msg.id, function (x) {
          x.resolve({ version: version });
        });
      return;
    }
    if (!w || w.type !== 'request') return; // a late reply to a request that already timed out
    try {
      var result = w.asm.add(msg);
      if (result)
        finish(msg.id, function (x) {
          x.resolve(result);
        });
    } catch (e) {
      finish(msg.id, function (x) {
        x.reject(e);
      });
    }
  }

  function ensureListener() {
    return new Promise(function (resolve, reject) {
      if (listener) {
        resolve(listener);
        return;
      }
      function attach() {
        try {
          listener = RegisterCommBusListener(function () {
            PS.logv('wasm', 'CommBus listener registered');
          });
          listener.on(EVT_RESPONSE, onMessage);
          resolve(listener);
        } catch (e) {
          reject(e);
        }
      }
      if (typeof RegisterCommBusListener === 'function') {
        attach();
        return;
      }
      // CommBus.js is the file that defines it; ask the sim to load it and wait briefly.
      if (typeof Include !== 'undefined' && Include && typeof Include.addScript === 'function') {
        try {
          Include.addScript('/JS/Services/CommBus.js');
          PS.logv('wasm', 'asked the sim to include /JS/Services/CommBus.js');
        } catch (e) {
          PS.log('wasm', 'Include.addScript failed: ' + PS.errText(e));
        }
      }
      var tries = 0;
      var t = setInterval(function () {
        if (typeof RegisterCommBusListener === 'function') {
          clearInterval(t);
          attach();
        } else if (++tries > 30) {
          clearInterval(t);
          reject(new Error('RegisterCommBusListener is not available (CommBus.js not loaded)'));
        }
      }, 100);
    });
  }

  function callWasm(name, obj) {
    var json = JSON.stringify(obj);
    if (listener && typeof listener.callWasm === 'function') return listener.callWasm(name, json);
    var co = PS.coherent();
    if (co && co.call) return co.call('COMM_BUS_WASM_CALLBACK', name, json);
    throw new Error('no way to call a WASM event (no callWasm, no Coherent)');
  }

  function ping(timeoutMs) {
    return ensureListener().then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        var timer = setTimeout(function () {
          finish(id, function (w) {
            w.reject(new Error('no reply from the taxi module (is it installed in the package modules folder?)'));
          });
        }, timeoutMs || 2500);
        waiters[id] = { type: 'ping', resolve: resolve, reject: reject, timer: timer };
        try {
          callWasm(EVT_PING, { id: id });
        } catch (e) {
          finish(id, function (w) {
            w.reject(e);
          });
        }
      });
    });
  }

  function request(icao, timeoutMs) {
    var first = alive ? Promise.resolve({ version: version }) : ping();
    return first.then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        var timer = setTimeout(function () {
          finish(id, function (w) {
            w.reject(new Error('taxi module did not finish within ' + Math.round((timeoutMs || 30000) / 1000) + ' s'));
          });
        }, timeoutMs || 30000);
        waiters[id] = { type: 'request', resolve: resolve, reject: reject, timer: timer, asm: newAssembler() };
        PS.logv('wasm', 'requesting taxi data for ' + icao + ' (id ' + id + ')');
        try {
          callWasm(EVT_REQUEST, { id: id, icao: String(icao).toUpperCase() });
        } catch (e) {
          finish(id, function (w) {
            w.reject(e);
          });
        }
      });
    });
  }

  return {
    newAssembler: newAssembler,
    ping: ping,
    request: request,
    // Test hook: feed a message as if it came off the bus.
    _deliver: onMessage,
    isAlive: function () {
      return alive;
    },
    version: function () {
      return version;
    }
  };
})();
