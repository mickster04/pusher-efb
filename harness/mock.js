// Browser mock of the EFB and the sim, for reviewing the UI on a Mac. A page working here proves nothing about the sim.
// It fakes: window.msfssdk (DisplayComponent, FSComponent, Subject), window.EFB_API, SimVar, Coherent, and a tiny physics model
// so the tug "drive" visibly moves the aircraft when velocity writes arrive.
(function () {
  var sim = {
    'PLANE LATITUDE': 51.4700, 'PLANE LONGITUDE': -0.4543, 'PLANE HEADING DEGREES TRUE': 90, 'PLANE ALTITUDE': 80,
    'PLANE ALT ABOVE GROUND': 0, 'GROUND VELOCITY': 0, 'AIRSPEED INDICATED': 0, 'VERTICAL SPEED': 0,
    'VELOCITY BODY Z': 0, 'VELOCITY BODY Y': 0, 'ROTATION VELOCITY BODY Y': 0, 'ROTATION VELOCITY BODY X': 0,
    'SIM ON GROUND': 1, 'GENERAL ENG COMBUSTION:1': 0, 'CAMERA STATE': 2, 'BRAKE PARKING POSITION': 0, 'BRAKE PARKING INDICATOR': 0,
    'L:A32NX_PARK_BRAKE_LEVER_POS': 0, 'L:XMLVAR_PARK_BRAKE_POS': 0,
    'PUSHBACK ATTACHED': 0, 'PUSHBACK STATE': 3, 'PUSHBACK WAIT': 1,
    'TITLE': 'Mock Airbus A320neo', 'ATC MODEL': 'A20N', 'ATC AIRLINE': 'MOCK', 'ATC FLIGHT NUMBER': '123'
  };
  var READ_ONLY = { 'PLANE ALTITUDE': 1, 'TITLE': 1, 'GROUND VELOCITY': 1 };
  var last = Date.now();
  setInterval(function () {
    var now = Date.now(), dt = (now - last) / 1000; last = now;
    var vz = sim['VELOCITY BODY Z'];
    sim['GROUND VELOCITY'] = Math.abs(vz) / 1.688;
    var hdg = sim['PLANE HEADING DEGREES TRUE'] * Math.PI / 180;
    sim['PLANE LATITUDE'] += (vz * 0.3048 * dt * Math.cos(hdg)) / 111320;
    sim['PLANE LONGITUDE'] += (vz * 0.3048 * dt * Math.sin(hdg)) / (111320 * Math.cos(sim['PLANE LATITUDE'] * Math.PI / 180));
    sim['PLANE HEADING DEGREES TRUE'] = (sim['PLANE HEADING DEGREES TRUE'] + sim['ROTATION VELOCITY BODY Y'] * 20000 * dt + 360) % 360;
    sim['VELOCITY BODY Z'] *= 0.96; // velocity is not sticky: decays unless rewritten
  }, 50);

  window.SimVar = {
    GetSimVarValue: function (name, unit) {
      if (unit === 'string' && typeof sim[name] !== 'string') throw new Error('wrong unit');
      if (!(name in sim)) { if (name.indexOf('L:') === 0) return 0; throw new Error('unknown variable ' + name); }
      return sim[name];
    },
    SetSimVarValue: function (name, unit, value) {
      if (name.indexOf('K:') === 0) { console.log('[mock] key event', name, value); window.__lastKey = [name, value]; return Promise.resolve(); }
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
  window.__sim = sim;
})();
