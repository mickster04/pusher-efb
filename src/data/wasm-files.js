// Client for the files module (PusherFiles.wasm, wasm/files/files_module.cpp): a second WASM module kept apart from the taxi module. It keeps the user's
// saved themes as real .json files in the module's work folder (the sim lets a module write there and nowhere inside the package).
// Events (JS to module): PusherFilesPing, PusherFilesList, PusherFilesSave, PusherFilesDelete; answers on PusherFilesResponse. Small JSON strings.

PS.wasmFiles = (function () {
  var EVT_PING = 'PusherFilesPing',
    EVT_LIST = 'PusherFilesList',
    EVT_SAVE = 'PusherFilesSave',
    EVT_DELETE = 'PusherFilesDelete',
    EVT_RESPONSE = 'PusherFilesResponse';
  var listener = null,
    waiters = {},
    nextId = 1,
    alive = false,
    version = '';

  function onMessage(raw) {
    var msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      PS.log('files', 'unreadable message: ' + PS.errText(e));
      return;
    }
    if (!msg || typeof msg.id !== 'number') return;
    var w = waiters[msg.id];
    if (!w) return;
    if (msg.kind === 'pong') {
      alive = true;
      version = msg.version || '';
    }
    if (w.collect) {
      var done = w.collect(msg);
      if (!done) return;
    } // a list comes as several messages
    delete waiters[msg.id];
    clearTimeout(w.timer);
    w.resolve(w.result ? w.result() : msg);
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
            PS.logv('files', 'CommBus listener registered');
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
      if (typeof Include !== 'undefined' && Include && typeof Include.addScript === 'function') {
        try {
          Include.addScript('/JS/Services/CommBus.js');
        } catch (e) {
          /* the taxi client asks too */
        }
      }
      var tries = 0,
        t = setInterval(function () {
          if (typeof RegisterCommBusListener === 'function') {
            clearInterval(t);
            attach();
          } else if (++tries > 30) {
            clearInterval(t);
            reject(new Error('RegisterCommBusListener is not available'));
          }
        }, 100);
    });
  }

  function callWasm(name, obj) {
    var json = JSON.stringify(obj);
    if (listener && typeof listener.callWasm === 'function') return listener.callWasm(name, json);
    var co = PS.coherent();
    if (co && co.call) return co.call('COMM_BUS_WASM_CALLBACK', name, json);
    throw new Error('no way to call a WASM event');
  }

  function ask(event, timeoutMs, what, payload, collector) {
    return ensureListener().then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++;
        var timer = setTimeout(function () {
          delete waiters[id];
          reject(
            new Error('no reply from the files module for ' + what + ' (is PusherFiles.wasm installed in the package modules folder?)')
          );
        }, timeoutMs || 6000);
        waiters[id] = { resolve: resolve, reject: reject, timer: timer };
        if (collector) {
          var c = collector();
          waiters[id].collect = c.collect;
          waiters[id].result = c.result;
        }
        var body = { id: id },
          k;
        if (payload) {
          for (k in payload) body[k] = payload[k];
        }
        try {
          callWasm(event, body);
        } catch (e) {
          delete waiters[id];
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  }

  return {
    ping: function (t) {
      return ask(EVT_PING, t, 'a ping');
    },
    // The .json files in the module's work folder: resolves with [{ name, text }].
    list: function (t) {
      return ask(EVT_LIST, t || 8000, 'the file list', null, function () {
        var files = [];
        return {
          collect: function (m) {
            if (m.kind === 'file') files.push({ name: m.name, text: m.text });
            return m.kind === 'end';
          },
          result: function () {
            return files;
          }
        };
      });
    },
    // Write (or replace) a file: resolves with { ok, detail }. The module accepts only plain names ending in .json.
    save: function (name, text, t) {
      return ask(EVT_SAVE, t, 'saving ' + name, { name: name, text: text });
    },
    remove: function (name, t) {
      return ask(EVT_DELETE, t, 'deleting ' + name, { name: name });
    },
    isAlive: function () {
      return alive;
    },
    version: function () {
      return version;
    },
    _deliver: onMessage
  };
})();
