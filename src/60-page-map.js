// Spike 6: can the sim's built-in map be used? Probes for map elements and msfs-sdk map classes, tries to mount one,
// and always shows a tile-less canvas plot as the baseline (own aircraft, range rings, taxiways, traffic).

PS.mapProbe = function () {
  var lines = [];
  var sdk = PS.global.msfssdk;
  var re = /map|bing|vfr/i;
  try {
    ['map-instrument', 'bing-map', 'vfr-map'].forEach(function (tag) {
      var def = typeof customElements !== 'undefined' && customElements.get ? customElements.get(tag) : null;
      lines.push('custom element <' + tag + '>: ' + (def ? 'registered' : 'not registered'));
    });
  } catch (e) { lines.push('custom element check failed: ' + PS.errText(e)); }
  ['Bing', 'MapInstrument', 'BingMap', 'MapSystemBuilder'].forEach(function (n) {
    lines.push('global ' + n + ': ' + (typeof PS.global[n]));
  });
  if (sdk) {
    var names = [];
    try { names = Object.getOwnPropertyNames(sdk).filter(function (k) { return re.test(k); }); } catch (e) { names = []; }
    lines.push('msfssdk names matching map/bing/vfr (' + names.length + '): ' + (names.slice(0, 40).join(', ') || 'none'));
  } else {
    lines.push('msfssdk: not available');
  }
  var co = PS.coherent();
  lines.push('Coherent: ' + (co ? 'available' : 'not available') + '; RegisterViewListener: ' + typeof PS.global.RegisterViewListener);
  lines.push('global EBingMode: ' + (typeof EBingMode === 'undefined' ? 'undefined' : Object.keys(EBingMode).join(', ')));
  if (sdk) {
    var all = [];
    try { all = Object.getOwnPropertyNames(sdk).filter(function (k) { return re.test(k); }); } catch (e) { all = []; }
    lines.push('ALL msfssdk map/bing/vfr names: ' + all.join(', '));
  }
  var efb = PS.global.EFB_API;
  if (efb) {
    var members = [];
    try { members = Object.getOwnPropertyNames(efb).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(efb) || {})); } catch (e) { members = []; }
    lines.push('EFB_API members: ' + members.join(', '));
  }
  var efbGlobals = [];
  try { efbGlobals = Object.getOwnPropertyNames(PS.global).filter(function (k) { return /efb|flightplan|vfrmap|navmap/i.test(k); }); } catch (e) { efbGlobals = []; }
  lines.push('window names matching efb/flightplan/vfrmap/navmap: ' + (efbGlobals.join(', ') || 'none'));
  return lines;
};


PS.pages.push({
  id: 'map',
  title: '6 Map',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var PLOT_STEPS = [100, 200, 300, 500, 1000, 2000, 3000];
    var BING_STEPS = [500, 1000, 3000, 10000, 30000];
    var canvas = h('canvas', { class: 'ps-canvas', width: '760', height: '480' });
    var mountBox = h('div', { class: 'ps-mount' });
    var probeBox = h('pre', { class: 'ps-log', text: '(press Probe)' });
    var plotRange = ui.stepper(PLOT_STEPS, 500, function () { draw(); }, 'map');
    var bingRange = ui.stepper(BING_STEPS, 3000, function () { followOwn(); }, 'map');
    // Bing map: the sim lists modes CURSOR, PLANE, VFR, HORIZON, TOPVIEW. PLANE is a terrain-coloured map; VFR is the detailed one.
    var modeEnum = typeof EBingMode !== 'undefined' ? EBingMode : null;
    var modeOptions = [];
    ['VFR', 'PLANE', 'TOPVIEW'].forEach(function (k) { if (modeEnum && modeEnum[k] !== undefined) modeOptions.push({ value: k, label: k }); });
    if (!modeOptions.length) modeOptions.push({ value: 'PLANE', label: 'PLANE' });
    var bingModeSel = ui.select(modeOptions, modeOptions[0].value, function () { tryMount(); });
    var marker = null;
    var mounted = false;
    var airportLoading = false;
    var timer = null;

    function log(msg) { PS.log('map', msg); }

    function probe() {
      var lines = PS.mapProbe();
      probeBox.textContent = lines.join('\n');
      lines.forEach(function (l) { log(l); });
    }

    var bing = null;
    var bingTimer = null;
    var bingErrors = 0;

    function followOwn() {
      if (!bing) return;
      var own = PS.readOwn();
      if (!own) return;
      var radius = bingRange.get();
      if (marker) {
        var t = 'rotate(' + Math.round(own.hdgDeg) + 'deg)';
        marker.style.transform = t; marker.style.webkitTransform = t;
      }
      try {
        if (typeof bing.setPositionRadius === 'function') bing.setPositionRadius({ lat: own.lat, long: own.lon }, radius);
      } catch (e) {
        if (bingErrors++ < 3) log('setPositionRadius failed: ' + PS.errText(e));
      }
    }

    // Earth colours: the sdk's BingComponent paints water and every terrain height black unless it is given colours.
    // That is why the first mount was a black square.
    function earthColorsFor(sdk) {
      var terrain = [
        { elev: 0, color: '#4f8a4b' }, { elev: 1500, color: '#8aa35a' }, { elev: 5000, color: '#a68d5e' },
        { elev: 10000, color: '#cfc7b8' }, { elev: 30000, color: '#ffffff' }
      ];
      try {
        if (typeof sdk.BingComponent.createEarthColorsArray === 'function') return sdk.BingComponent.createEarthColorsArray('#2b6a9c', terrain);
      } catch (e) { log('createEarthColorsArray failed: ' + PS.errText(e)); }
      // Fallback: a flat array. R + G*256 + B*256^2.
      var water = 0x2b + 0x6a * 256 + 0x9c * 65536, land = 0x4f + 0x8a * 256 + 0x4b * 65536, arr = [water];
      for (var i = 0; i < 61; i++) arr.push(land);
      return arr;
    }

    function bingState(holder) {
      var img = holder ? holder.querySelector('img') : null;
      return 'isBound=' + (bing && bing.isBound ? bing.isBound() : '?') + ' isAwake=' + (bing && bing.isAwake ? bing.isAwake() : '?') +
        ' img.src=' + (img ? String(img.src).substring(0, 80) : 'none') + ' img size=' + (img ? img.clientWidth + 'x' + img.clientHeight : 'n/a');
    }

    // Mounts msfs-sdk BingComponent in a sized holder, gives it earth colours, and keeps it centred on the aircraft.
    function mountBing(sdk) {
      var holder = h('div', { style: 'position:relative;width:640px;height:400px;background:#000;overflow:hidden;' });
      mountBox.appendChild(holder);
      var ref = sdk.FSComponent.createRef();
      if (modeEnum) log('EBingMode values: ' + Object.keys(modeEnum).join(', '));
      var props = { ref: ref, id: 'ps-bing-' + (Date.now() % 100000), mode: modeEnum ? modeEnum[bingModeSel.value] : 0 };
      if (sdk.ArraySubject) props.earthColors = sdk.ArraySubject.create(earthColorsFor(sdk));
      else log('msfssdk.ArraySubject missing; map will keep its default black colours');
      if (sdk.Subject) props.skyColor = sdk.Subject.create(0);
      var vnode = sdk.FSComponent.buildComponent(sdk.BingComponent, props);
      sdk.FSComponent.render(vnode, holder);
      bing = ref.instance;
      if (!bing) { log('BingComponent rendered but no instance reference came back.'); return; }
      // Own aircraft marker (a CSS triangle, so no special characters are needed).
      marker = h('div', { style: 'position:absolute;left:50%;top:50%;width:0;height:0;margin-left:-9px;margin-top:-14px;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:28px solid #4cd18a;' });
      holder.appendChild(marker);
      log('mounting Bing map in mode ' + bingModeSel.value);
      followOwn();
      if (bingTimer !== null) clearInterval(bingTimer);
      var checks = 0;
      bingTimer = setInterval(function () {
        followOwn();
        if (checks++ < 4) log('bing state: ' + bingState(holder));
      }, 1000);
      log('BingComponent mounted with earth colours; following own position every 1 s.');
    }

    // Best-effort mount of a built-in map. Which of these (if any) works inside an EFB app is exactly what we want to learn.
    function tryMount() {
      PS.clear(mountBox);
      bing = null; marker = null; mounted = true;
      var sdk = PS.global.msfssdk;
      try {
        if (sdk && sdk.BingComponent && sdk.FSComponent) { mountBing(sdk); return; }
        var def = typeof customElements !== 'undefined' && customElements.get ? customElements.get('map-instrument') : null;
        if (def) {
          var mi = document.createElement('map-instrument');
          mi.style.width = '100%'; mi.style.height = '320px';
          mountBox.appendChild(mi);
          log('created <map-instrument>; it needs configuration we have not added. Check whether it renders anything.');
          return;
        }
        log('no known built-in map element or msfssdk BingComponent found; cannot mount.');
        mountBox.appendChild(ui.note('No built-in map component found to mount. The canvas plot below is a baseline only (no imagery).', 'warn'));
      } catch (e) {
        log('mount failed: ' + PS.errText(e));
        mountBox.appendChild(ui.note('Mount failed: ' + PS.errText(e), 'warn'));
      }
    }

    // ---------------- Plot: runways, taxiways, traffic, pins and suggested pushes ----------------
    var infoLine = h('div', { class: 'ps-kv', text: '' });
    var contactLine = h('div', { class: 'ps-kv', text: '' });
    var pinList = h('div');
    var sugBox = h('div');
    var pinModeBtn = null;
    var pinMode = false;
    var selectedPin = -1;
    var selectedContact = null;
    var drag = null;            // { idx, sx, sy, moved } while a pin is held
    var lastView = null;
    var lastOwn = null;
    var sug = { list: [], selectedId: null, key: '', at: 0, logged: false };

    function ownOrReference() {
      var o = PS.readOwn();
      if (o) return { own: o, live: true };
      var t = PS.state.taxi, p = t && t.parking && t.parking.length ? t.parking[0] : null;
      return { own: { lat: p ? p.lat : 51.47, lon: p ? p.lon : -0.4543, hdgDeg: 90, gsKt: 0, altFt: 0 }, live: false };
    }

    function contactsNow() {
      var real = PS.airTraffic.contacts || [];
      if (real.length) return real;
      // Simulated contacts from the Traffic page only (a stale real list used to be shown here and never updated).
      var st = PS.state.contacts || [];
      for (var i = 0; i < st.length; i++) { if (st[i].simulated) return st; }
      return [];
    }

    function canvasPoint(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * canvas.width / (r.width || canvas.width), (e.clientY - r.top) * canvas.height / (r.height || canvas.height)];
    }

    // ---- pins ----
    function renderPins() {
      PS.clear(pinList);
      var pins = PS.state.pins, o = lastOwn;
      if (!pins.length) {
        pinList.appendChild(ui.note('No pins. Press "Pin mode", then tap the plot to drop a pin; tap again for the next one. Pins are joined from the aircraft in order. Drag a pin to move it, or pick a suggested push below and press "Use as pins".'));
        return;
      }
      var r = PS.routeLegs(o || { lat: pins[0].lat, lon: pins[0].lon }, pins);
      pinList.appendChild(h('div', { class: 'ps-kv', text: pins.length + ' pin(s), route length ' + PS.fmt.dist(r.totalM) + (o ? ' from the aircraft' : '') }));
      pins.forEach(function (p, i) {
        var leg = r.legs[i];
        pinList.appendChild(h('div', { class: 'ps-pinrow' + (i === selectedPin ? ' on' : '') },
          h('span', { text: (i + 1) + ': ' + PS.fmt.dist(leg.distM) + ' on a bearing of ' + Math.round(leg.bearingDeg) + '°   (' + p.lat.toFixed(6) + ', ' + p.lon.toFixed(6) + ')' }),
          ui.button('Delete', function () { deletePin(i); }, 'ps-small ps-ghost')));
      });
    }
    function addPin(lat, lon) {
      PS.state.pins.push({ lat: lat, lon: lon });
      selectedPin = PS.state.pins.length - 1;
      log('pin ' + PS.state.pins.length + ' added at ' + lat.toFixed(6) + ', ' + lon.toFixed(6));
      renderPins(); draw();
    }
    function deletePin(i) {
      PS.state.pins.splice(i, 1);
      selectedPin = -1;
      log('pin ' + (i + 1) + ' deleted; ' + PS.state.pins.length + ' left');
      renderPins(); draw();
    }
    function undoPin() { if (PS.state.pins.length) deletePin(PS.state.pins.length - 1); }
    function clearPins() { PS.state.pins.length = 0; selectedPin = -1; log('pins cleared'); renderPins(); draw(); }
    function setPinMode(on) {
      pinMode = on;
      if (pinModeBtn) { pinModeBtn.textContent = 'Pin mode: ' + (on ? 'ON (tap the plot)' : 'off'); pinModeBtn.className = 'ps-btn' + (on ? ' ps-warn' : ''); }
      canvas.className = 'ps-canvas' + (on ? ' ps-pinmode' : '');
    }

    canvas.addEventListener('mousedown', function (e) {
      if (!lastView) return;
      var p = canvasPoint(e);
      var hit = PS.nearestPin(lastView, PS.state.pins, p[0], p[1], 18);
      drag = hit >= 0 ? { idx: hit, sx: p[0], sy: p[1], moved: false } : { idx: -1, sx: p[0], sy: p[1], moved: false };
      if (hit >= 0) { selectedPin = hit; renderPins(); draw(); }
    });
    canvas.addEventListener('mousemove', function (e) {
      if (!drag || !lastView) return;
      var p = canvasPoint(e);
      if (!drag.moved && Math.abs(p[0] - drag.sx) + Math.abs(p[1] - drag.sy) > 6) drag.moved = true;
      if (drag.idx >= 0 && drag.moved) {
        var ll = lastView.fromPx(p[0], p[1]);
        PS.state.pins[drag.idx].lat = ll[0]; PS.state.pins[drag.idx].lon = ll[1];
        draw();
      }
    });
    function release(e) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.idx >= 0) { if (d.moved) { log('pin ' + (d.idx + 1) + ' moved'); renderPins(); } return; }
      if (d.moved || !lastView) return;
      var p = canvasPoint(e);
      if (pinMode) { var ll = lastView.fromPx(p[0], p[1]); addPin(ll[0], ll[1]); return; }
      // Not in pin mode: pick the nearest aircraft to read its details.
      var best = null, bestD = 16;
      contactsNow().forEach(function (c) {
        var q = lastView.toPx(c.lat, c.lon), dd = Math.sqrt((q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]));
        if (dd < bestD) { bestD = dd; best = c; }
      });
      selectedContact = best ? best.id : null;
      selectedPin = -1; renderPins(); draw();
    }
    canvas.addEventListener('mouseup', release);
    canvas.addEventListener('mouseleave', function () { drag = null; });

    // ---- suggested pushes ----
    function selectedSuggestion() {
      for (var i = 0; i < sug.list.length; i++) { if (sug.list[i].id === sug.selectedId) return sug.list[i]; }
      return null;
    }
    function renderSuggestions() {
      PS.clear(sugBox);
      var t = PS.state.taxi;
      if (!t) { sugBox.appendChild(ui.note('No airport data loaded yet. Suggestions need the taxiway data (page 3, or wait for the airport to load here).')); return; }
      if (!sug.list.length) {
        sugBox.appendChild(ui.note('No suggestions: none of the named taxiways, links or lanes is within reach behind or beside the aircraft, or the taxi module did not supply taxi paths (' + t.items.length + ' items loaded).'));
        return;
      }
      var cur = selectedSuggestion();
      if (cur) {
        sugBox.appendChild(h('div', { class: 'ps-row' },
          ui.button('Use as pins', function () {
            PS.state.pins.length = 0;
            cur.pins.forEach(function (p) { PS.state.pins.push({ lat: p[0], lon: p[1] }); });
            selectedPin = -1; log('copied suggestion "' + cur.title + '" into ' + cur.pins.length + ' pin(s)');
            renderPins(); draw();
          }),
          ui.button('Hide route', function () { sug.selectedId = null; renderSuggestions(); draw(); }, 'ps-ghost')));
      }
      sug.list.forEach(function (s, i) {
        sugBox.appendChild(h('button', { type: 'button', class: 'ps-sug' + (s.id === sug.selectedId ? ' on' : ''), onclick: function () {
          sug.selectedId = s.id === sug.selectedId ? null : s.id;
          log('suggestion ' + (i + 1) + (sug.selectedId ? ' shown: ' : ' hidden: ') + s.title + ' (' + Math.round(s.lengthM) + ' m)');
          renderSuggestions(); draw();
        } }, h('div', { class: 'ps-sug-title', text: (i + 1) + '. ' + s.title }), h('div', { class: 'ps-sug-detail', text: s.detail })));
      });
    }
    function refreshSuggestions(own) {
      var now = Date.now(), t = PS.state.taxi;
      if (!t || !t.items || !t.items.length) {
        if (sug.list.length || sug.key !== 'none') { sug.list = []; sug.key = 'none'; renderSuggestions(); }
        return;
      }
      var key = [t.icao || '', t.items.length, own.lat.toFixed(5), own.lon.toFixed(5), Math.round(own.hdgDeg)].join('|');
      if (key === sug.key || now - sug.at < 1500) return;
      sug.key = key; sug.at = now;
      var before = sug.list.length;
      try {
        var t0 = Date.now();
        sug.list = PS.suggest.suggest(t.items, own);
        if (!sug.logged || sug.list.length !== before) { sug.logged = true; log('suggested pushes: ' + sug.list.length + ' option(s) in ' + (Date.now() - t0) + ' ms (heading ' + Math.round(own.hdgDeg) + ')'); }
      } catch (e) { sug.list = []; log('suggestion failed: ' + PS.errText(e)); }
      if (sug.selectedId && !selectedSuggestion()) sug.selectedId = null;
      renderSuggestions();
    }

    // ---- drawing ----
    function draw() {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) { infoLine.textContent = 'Canvas 2D not available.'; return; }
      var c = ownOrReference(), own = c.own;
      lastOwn = own;
      var w = canvas.width, hgt = canvas.height;
      var range = plotRange.get();
      var view = PS.plotView(w, hgt, own, range);
      lastView = view;
      refreshSuggestions(own);

      g.fillStyle = '#0f171e'; g.fillRect(0, 0, w, hgt);
      g.lineWidth = 1; g.strokeStyle = '#2a3a47'; g.fillStyle = '#6f8294'; g.font = '11px Arial';
      [0.25, 0.5, 0.75, 1].forEach(function (f) {
        g.beginPath(); g.arc(view.cx, view.cy, range * f * view.scale, 0, Math.PI * 2); g.stroke();
        g.fillText(PS.fmt.dist(range * f), view.cx + 4, view.cy - range * f * view.scale + 12);
      });
      g.fillStyle = '#8aa0b2'; g.font = 'bold 12px Arial'; g.fillText('N', 8, 16);

      var taxi = PS.state.taxi, drawn = 0, labels = {};
      if (taxi) {
        taxi.items.forEach(function (it) {
          if (!it.points.length) return;
          g.strokeStyle = it.category === 'Runway' ? '#8aa3b8' : (it.category === 'Taxiway' ? '#f0a830' : '#4d6275');
          g.lineWidth = it.category === 'Runway' ? 4 : 2;
          g.beginPath();
          var first = null, last = null;
          it.points.forEach(function (p, i) { var q = view.toPx(p[0], p[1]); if (i === 0) { g.moveTo(q[0], q[1]); first = q; } else g.lineTo(q[0], q[1]); last = q; });
          g.stroke(); drawn++;
          var nm = it.rawName;
          if (range <= 1000 && nm && it.category === 'Taxiway' && first && last && !labels[nm]) {
            var mx = (first[0] + last[0]) / 2, my = (first[1] + last[1]) / 2;
            if (mx > 0 && mx < w && my > 0 && my < hgt) { labels[nm] = [mx, my]; }
          }
        });
        g.lineWidth = 1; g.font = '11px Arial'; g.fillStyle = '#ffd37a';
        Object.keys(labels).forEach(function (nm) { g.fillText(nm, labels[nm][0] + 3, labels[nm][1] - 3); });
        if (range <= 300) {
          g.fillStyle = '#8aa3b8'; g.font = '10px Arial';
          (taxi.parking || []).forEach(function (p) {
            if (p.lat === null) return;
            var q = view.toPx(p.lat, p.lon);
            if (q[0] < 0 || q[0] > w || q[1] < 0 || q[1] > hgt) return;
            g.fillRect(q[0] - 2, q[1] - 2, 4, 4); g.fillText(p.name, q[0] + 4, q[1] + 3);
          });
        }
      }

      // Suggested pushes: end markers for all, the full route for the chosen one.
      var chosen = selectedSuggestion();
      g.font = 'bold 11px Arial';
      sug.list.forEach(function (s, i) {
        if (s === chosen) return;
        var e = s.pins[s.pins.length - 1], q = view.toPx(e[0], e[1]);
        g.fillStyle = '#34d2c8'; g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0f171e'; g.fillText(String(i + 1), q[0] - (i > 8 ? 6 : 3), q[1] + 4);
      });
      if (chosen) {
        g.strokeStyle = '#34d2c8'; g.lineWidth = 4; g.beginPath();
        chosen.route.forEach(function (p, i) { var q = view.toPx(p[0], p[1]); if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); });
        g.stroke(); g.lineWidth = 1;
        chosen.pins.forEach(function (p, i) {
          var q = view.toPx(p[0], p[1]), isEnd = i === chosen.pins.length - 1;
          g.fillStyle = '#34d2c8'; g.beginPath(); g.arc(q[0], q[1], isEnd ? 8 : 5, 0, Math.PI * 2); g.fill();
        });
        // The nose direction the push ends with, drawn at the end point.
        var ep = chosen.pins[chosen.pins.length - 1], eq = view.toPx(ep[0], ep[1]);
        g.save(); g.translate(eq[0], eq[1]); g.rotate(PS.geo.rad(chosen.facingDeg));
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(0, -22); g.lineTo(7, -10); g.lineTo(-7, -10); g.closePath(); g.fill();
        g.restore();
      }

      // Pins: joined from the aircraft in order.
      var pins = PS.state.pins;
      if (pins.length) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 2;
        if (g.setLineDash) g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(view.cx, view.cy);
        pins.forEach(function (p) { var q = view.toPx(p.lat, p.lon); g.lineTo(q[0], q[1]); });
        g.stroke();
        if (g.setLineDash) g.setLineDash([]);
        g.lineWidth = 1; g.font = 'bold 13px Arial';
        pins.forEach(function (p, i) {
          var q = view.toPx(p.lat, p.lon), sel = i === selectedPin;
          if (sel) { g.strokeStyle = '#ffe14d'; g.lineWidth = 3; g.beginPath(); g.arc(q[0], q[1], 17, 0, Math.PI * 2); g.stroke(); g.lineWidth = 1; }
          g.fillStyle = i === pins.length - 1 ? '#ff7a45' : '#ffffff';
          g.beginPath(); g.arc(q[0], q[1], 11, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#0f171e'; g.fillText(String(i + 1), q[0] - (i > 8 ? 7 : 4), q[1] + 5);
        });
      }

      // AI traffic: read fresh from the listener on every redraw.
      PS.airTraffic.poll();
      var contacts = contactsNow(), inView = 0, T = PS.airTraffic;
      g.font = '11px Arial';
      contacts.forEach(function (ct) {
        var q = view.toPx(ct.lat, ct.lon);
        if (q[0] < -10 || q[0] > w + 10 || q[1] < -10 || q[1] > hgt + 10) return;
        inView++;
        var sel = ct.id === selectedContact;
        g.fillStyle = ct.simulated ? '#c46af0' : '#ff5c5c';
        g.beginPath(); g.arc(q[0], q[1], sel ? 7 : 5, 0, Math.PI * 2); g.fill();
        var trk = typeof ct.trackDeg === 'number' && ct.gsKt > 1 ? ct.trackDeg : (ct.hdgDeg || 0);
        g.strokeStyle = g.fillStyle; g.lineWidth = 2; g.beginPath(); g.moveTo(q[0], q[1]);
        g.lineTo(q[0] + Math.sin(PS.geo.rad(trk)) * 16, q[1] - Math.cos(PS.geo.rad(trk)) * 16); g.stroke(); g.lineWidth = 1;
        g.fillStyle = '#e8b4b4'; g.fillText(ct.title || '', q[0] + 8, q[1] + 4);
      });

      // Own aircraft, pointing along its heading.
      g.save(); g.translate(view.cx, view.cy); g.rotate(PS.geo.rad(own.hdgDeg));
      g.fillStyle = '#4cd18a'; g.beginPath(); g.moveTo(0, -20); g.lineTo(13, 16); g.lineTo(0, 8); g.lineTo(-13, 16); g.closePath(); g.fill();
      g.restore();

      var age = T.lastAt ? ((Date.now() - T.lastAt) / 1000).toFixed(1) + ' s ago' : 'never';
      infoLine.textContent = (c.live ? 'Own position live. ' : 'Own position: reference point (sim not readable). ') + 'Range ' + PS.fmt.dist(range) + '. Taxi items drawn: ' + drawn +
        '. AI aircraft in view: ' + inView + ' of ' + contacts.length + ' (listener updated ' + age + ', ' + T.calls + ' replies)' +
        (taxi && taxi.icao ? '. Airport ' + taxi.icao + ' loaded.' : '. No airport data loaded yet.');
      var sc = null;
      for (var k = 0; k < contacts.length; k++) { if (contacts[k].id === selectedContact) sc = contacts[k]; }
      if (sc) {
        var a = PS.traffic.analyse(own, sc);
        contactLine.textContent = (sc.title || sc.id) + ': ' + PS.fmt.dist(a.distM) + ' away on a bearing of ' + Math.round(a.bearingDeg) + '°, ' + PS.fmt.num(sc.gsKt, 0) + ' kt, heading ' + Math.round(sc.hdgDeg || 0) + '°, closing ' + PS.fmt.num(a.closingKt, 1) + ' kt';
      } else {
        contactLine.textContent = contacts.length ? 'Tap an aircraft (pin mode off) to read its details.' : '';
      }
    }

    pinModeBtn = ui.button('Pin mode: off', function () { setPinMode(!pinMode); });

    var el = h('div', { class: 'ps-page' },
      ui.panel('Plot (runways, taxiways, AI aircraft, pins and suggested pushes; no imagery)',
        h('div', { class: 'ps-row' }, ui.field('Range', plotRange.el), pinModeBtn,
          ui.button('Undo pin', undoPin, 'ps-ghost'), ui.button('Clear pins', clearPins, 'ps-ghost')),
        canvas, infoLine, contactLine,
        ui.note('North is up, centred on the aircraft. Pin mode on: tap to drop pins, drag a pin to move it. Pin mode off: tap an aircraft to read its details. Orange = taxiway, grey-blue = runway, red = AI aircraft, teal = suggested push end points, white = your pins.')),
      ui.panel('Pins', pinList),
      ui.panel('Suggested pushes', sugBox,
        ui.note('Simplified port of the original suggester: straight back to the nearest taxiways, links and lanes, and back then along a taxiway either way. It does not yet check whether the tug can make the turn the way the original planner does, so treat sharp-turn options with care.')),
      ui.panel('Built-in map (kept for reference; not very useful)',
        h('div', { class: 'ps-row' }, ui.button('Probe for map APIs', probe), ui.button('Mount / remount built-in map', tryMount)),
        h('div', { class: 'ps-row' }, ui.field('Map mode', bingModeSel), ui.field('Map range', bingRange.el)),
        mountBox, probeBox,
        ui.note('Looking for: whether the sim\'s own map can be shown in an EFB app, and whether we can draw taxiways, pins and the aircraft on top of it. Not mounted automatically any more; press Mount.')),
      ui.panel('Log', ui.logBox(['map', 'traffic']))
    );
    return {
      el: el,
      onShow: function () {
        renderPins(); renderSuggestions();
        draw(); timer = setInterval(draw, 500);
        if (!PS.state.taxi && !airportLoading) {
          airportLoading = true;
          PS.facility.loadNearestIntoState().then(null, function (e) { log('could not load airport data: ' + PS.errText(e)); });
        }
      },
      onHide: function () { if (timer !== null) { clearInterval(timer); timer = null; } if (bingTimer !== null) { clearInterval(bingTimer); bingTimer = null; } drag = null; }
    };
  }
});
