// Browser mock of the EFB and the sim, for reviewing the UI on a Mac. A page working here proves nothing about the sim.
// It fakes: window.msfssdk (DisplayComponent, FSComponent, Subject), window.EFB_API, SimVar, Coherent, and a tiny physics model
// so the tug "drive" visibly moves the aircraft when velocity writes arrive.
(function () {
  var sim = {
    'PLANE LATITUDE': -43.4890, 'PLANE LONGITUDE': 172.5375, 'PLANE HEADING DEGREES TRUE': 90, 'PLANE ALTITUDE': 80,
    'PLANE ALT ABOVE GROUND': 0, 'GROUND VELOCITY': 0, 'AIRSPEED INDICATED': 0, 'VERTICAL SPEED': 0,
    'VELOCITY BODY Z': 0, 'VELOCITY BODY Y': 0, 'ROTATION VELOCITY BODY Y': 0, 'ROTATION VELOCITY BODY X': 0,
    'SIM ON GROUND': 1, 'GENERAL ENG COMBUSTION:1': 0, 'CAMERA STATE': 2, 'BRAKE PARKING POSITION': 1, 'BRAKE PARKING INDICATOR': 1,
    'L:A32NX_PARK_BRAKE_LEVER_POS': 0, 'L:XMLVAR_PARK_BRAKE_POS': 0,
    'NUMBER OF ENGINES': 2, 'GENERAL ENG COMBUSTION:1': 0, 'GENERAL ENG COMBUSTION:2': 0, 'TURBINE ENG N1:1': 0, 'TURBINE ENG N1:2': 0,
    'PUSHBACK ATTACHED': 0, 'PUSHBACK STATE': 3, 'PUSHBACK WAIT': 1,
    'TITLE': 'Mock Airbus A320neo', 'ATC MODEL': 'A20N', 'ATC AIRLINE': 'MOCK', 'ATC FLIGHT NUMBER': '123'
  };
  var READ_ONLY = { 'PLANE ALTITUDE': 1, 'TITLE': 1, 'GROUND VELOCITY': 1 };
  var last = Date.now();
  setInterval(function () {
    var now = Date.now(), dt = (now - last) / 1000; last = now;
    var vz = sim['VELOCITY BODY Z'], yawDegS = sim['ROTATION VELOCITY BODY Y'] * 180 / Math.PI;
    var driven = sim['PUSHBACK ATTACHED'] > 0 && sim['PUSHBACK WAIT'] === 0;
    sim['GROUND VELOCITY'] = driven ? Math.abs(vz) / 1.688 : 0;
    if (driven) {
      var hdg = sim['PLANE HEADING DEGREES TRUE'] * Math.PI / 180;
      sim['PLANE LATITUDE'] += (vz * 0.3048 * dt * Math.cos(hdg)) / 111320;
      sim['PLANE LONGITUDE'] += (vz * 0.3048 * dt * Math.sin(hdg)) / (111320 * Math.cos(sim['PLANE LATITUDE'] * Math.PI / 180));
      // the nose turns at 2.3 x what is written, less a small dead band (fitted to the first real pushes)
      var mag = Math.max(0, 2.3 * Math.abs(yawDegS) - 0.30);
      sim['PLANE HEADING DEGREES TRUE'] = (sim['PLANE HEADING DEGREES TRUE'] + (yawDegS < 0 ? -1 : 1) * mag * dt + 360) % 360;
    }
    sim['VELOCITY BODY Z'] *= 0.96; sim['ROTATION VELOCITY BODY Y'] *= 0.96;   // velocity is not sticky: it decays unless rewritten
  }, 50);

  window.SimVar = {
    GetSimVarValue: function (name, unit) {
      if (unit === 'string' && typeof sim[name] !== 'string') throw new Error('wrong unit');
      if (!(name in sim)) { if (name.indexOf('L:') === 0) return 0; throw new Error('unknown variable ' + name); }
      return sim[name];
    },
    SetSimVarValue: function (name, unit, value) {
      if (name.indexOf('K:') === 0) {
        console.log('[mock] key event', name, value); window.__lastKey = [name, value];
        if (name === 'K:TOGGLE_PUSHBACK') setTimeout(function () { sim['PUSHBACK ATTACHED'] = sim['PUSHBACK ATTACHED'] ? 0 : 1; }, 300);
        if (name === 'K:PARKING_BRAKES') sim['BRAKE PARKING POSITION'] = sim['BRAKE PARKING POSITION'] ? 0 : 1;
        return Promise.resolve();
      }
      if (READ_ONLY[name]) return Promise.resolve();
      sim[name] = value; return Promise.resolve();
    }
  };
  window.Coherent = {
    call: function (name, a, b) { console.log('[mock] Coherent.call', name, a, b); return Promise.resolve(); },
    on: function () {}, trigger: function () {}
  };

  // Minimal stand-ins for the SDK pieces the shell uses.
  function Subject() {}
  Subject.create = function (v) { return { get: function () { return v; } }; };
  function DisplayComponent(props) { this.props = props; }
  DisplayComponent.prototype.destroy = function () {};
  var FSComponent = {
    createRef: function () { return { instance: null }; },
    buildComponent: function (tag, props) {
      var kids = Array.prototype.slice.call(arguments, 2);
      if (typeof tag === 'function') {
        var inst = new tag(props);
        var node = inst.render();
        if (inst.onAfterRender) setTimeout(function () { inst.onAfterRender(); if (inst.onOpen) inst.onOpen(); }, 0);
        window.__view = inst;
        return node;
      }
      var el = document.createElement(tag);
      if (props) { if (props.class) el.className = props.class; if (props.ref) props.ref.instance = el; }
      kids.forEach(function (k) { if (k) el.appendChild(k); });
      return el;
    }
  };
  window.msfssdk = { DisplayComponent: DisplayComponent, FSComponent: FSComponent, Subject: Subject };

  // Facility loader: nearest search finds NZCH, and getFacility returns it with one runway (runways only, like the real sim).
  window.msfssdk.FacilityType = { Airport: 'A' };
  window.msfssdk.FacilitySearchType = { Airport: 0 };
  window.msfssdk.FacilityRepository = { getRepository: function () { return {}; } };
  window.msfssdk.FacilityLoader = function () {
    return {
      startNearestSearchSession: function () {
        return Promise.resolve({ searchNearest: function () { return Promise.resolve({ added: ['A      NZCH '] }); } });
      },
      getFacility: function () {
        return Promise.resolve({ icao: 'A      NZCH ', lat: -43.4894, lon: 172.5344,
          runways: [{ designation: '02/20', latitude: -43.4890, longitude: 172.5320, direction: 20, length: 3000, width: 45 }] });
      }
    };
  };
  // AI traffic: a few aircraft taxiing around the player, moving each time the listener is called (like GET_AIR_TRAFFIC).
  var trafficT0 = Date.now();
  window.RegisterViewListener = function (name, cb) {
    setTimeout(function () { if (cb) cb(); }, 0);
    return {
      call: function () {
        var t = (Date.now() - trafficT0) / 1000;
        function at(id, name, dN, dE, hdg) { return { uId: id, name: name, lat: -43.4890 + dN / 111320, lon: 172.5375 + dE / (111320 * Math.cos(43.489 * Math.PI / 180)), alt: 10, heading: hdg, isOnGround: true }; }
        return Promise.resolve([
          at(1, 'MOCK-A320', 40 + t * 2, -80 + 0, 0),
          at(2, 'MOCK-B738', 10, 120 - t * 3, 270),
          at(3, 'MOCK-E190', -90, 30 + t, 90)
        ]);
      }
    };
  };


  // Mock of the taxi WASM module over the CommBus. Replies come from harness/taxi-sample.txt, which is real output of the
  // C++ core (wasm/test/gen_sample.cpp). Set window.__noTaxiModule = true to simulate the module not being installed.
  var taxiLines = null;
  function loadTaxiLines() {
    if (taxiLines) return taxiLines;
    var x = new XMLHttpRequest();
    x.open('GET', '/harness/taxi-sample.txt', false);
    x.send();
    taxiLines = x.responseText.split('\n').filter(Boolean);
    return taxiLines;
  }
  window.RegisterCommBusListener = function (cb) {
    var handlers = {};
    if (cb) setTimeout(cb, 0);
    return {
      on: function (name, h) { handlers[name] = h; },
      callWasm: function (name, json) {
        var req = JSON.parse(json);
        var reply = function (obj, delay) { setTimeout(function () { if (handlers.PusherTaxiResponse) handlers.PusherTaxiResponse(JSON.stringify(obj)); }, delay || 5); };
        // The files module: saved themes kept in memory (it keeps them as .json files in its work folder in the sim). Set window.__noFilesModule = true to leave it out.
        if (/^PusherFiles/.test(name)) {
          if (window.__noFilesModule) return Promise.resolve();
          window.__mockFiles = window.__mockFiles || {};
          var fr = function (m) { setTimeout(function () { if (handlers.PusherFilesResponse) handlers.PusherFilesResponse(JSON.stringify(m)); }, 5); };
          if (name === 'PusherFilesPing') fr({ id: req.id, kind: 'pong', version: '0.2.0-mock' });
          else if (name === 'PusherFilesList') { Object.keys(window.__mockFiles).forEach(function (n) { fr({ id: req.id, kind: 'file', name: n, text: window.__mockFiles[n] }); }); setTimeout(function () { fr({ id: req.id, kind: 'end', count: Object.keys(window.__mockFiles).length }); }, 20); }
          else if (name === 'PusherFilesSave') { window.__mockFiles[req.name] = req.text; fr({ id: req.id, kind: 'saved', name: req.name, ok: true, detail: '' }); }
          else if (name === 'PusherFilesDelete') { var had = req.name in window.__mockFiles; delete window.__mockFiles[req.name]; fr({ id: req.id, kind: 'deleted', name: req.name, ok: had, detail: had ? '' : 'missing' }); }
          return Promise.resolve();
        }
        if (window.__noTaxiModule) return Promise.resolve();
        if (name === 'PusherTaxiPing') reply({ id: req.id, kind: 'pong', version: '0.1.0-mock' });
        else if (name === 'PusherTaxiRequest') {
          if (req.icao !== 'NZCH') { reply({ id: req.id, kind: 'error', message: 'the sim returned no taxiway data for ' + req.icao }, 200); return Promise.resolve(); }
          loadTaxiLines().forEach(function (l, i) { var m = JSON.parse(l); m.id = req.id; reply(m, 150 + i * 40); });
        }
        return Promise.resolve();
      }
    };
  };

  var started = false;
  window.EFB_API = {
    use: function (AppClass) {
      if (!started && Date.now() - window.__t0 < 300) throw new Error('Bus has not been initialized yet.'); // exercise the retry
      started = true;
      var app = new AppClass();
      app._install({ bus: {}, notificationManager: window.__mockNotificationManager || null }).then(function () {
        var mount = document.getElementById('efb-screen');
        mount.appendChild(app.render());
        window.__app = app;
      });
    }
  };
  window.__t0 = Date.now();
  window.__mockNotificationManager = {
    notifications: [],
    showNotification: function (n) { console.log('[mock] showNotification', JSON.stringify(n)); this.notifications.push(n); },
    clearAll: function () { this.notifications = []; }
  };
  window.__themeBase = '/PackageSources/PushPlanner/themes';   // where this page serves the package's theme files from
  window.__sim = sim;
})();
