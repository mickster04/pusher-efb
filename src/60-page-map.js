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
    var canvas = h('canvas', { class: 'ps-canvas', width: '640', height: '420' });
    var mountBox = h('div', { class: 'ps-mount' });
    var probeBox = h('pre', { class: 'ps-log', text: '(press Probe)' });
    var rangeSel = ui.select([{ value: '200', label: '200 m' }, { value: '500', label: '500 m' }, { value: '1000', label: '1 km' }, { value: '3000', label: '3 km' }, { value: '10000', label: '10 km' }], '1000', function () { draw(); });
    // Bing map: the sim lists modes CURSOR, PLANE, VFR, HORIZON, TOPVIEW. PLANE is a terrain-coloured map; VFR is the detailed one.
    var modeEnum = typeof EBingMode !== 'undefined' ? EBingMode : null;
    var modeOptions = [];
    ['VFR', 'PLANE', 'TOPVIEW'].forEach(function (k) { if (modeEnum && modeEnum[k] !== undefined) modeOptions.push({ value: k, label: k }); });
    if (!modeOptions.length) modeOptions.push({ value: 'PLANE', label: 'PLANE' });
    var bingModeSel = ui.select(modeOptions, modeOptions[0].value, function () { tryMount(); });
    var bingRangeSel = ui.select([{ value: '500', label: '500 m' }, { value: '1000', label: '1 km' }, { value: '3000', label: '3 km' }, { value: '10000', label: '10 km' }, { value: '30000', label: '30 km' }], '3000', function () { followOwn(); });
    var marker = null;
    var mounted = false;
    var airportLoading = false;
    var infoLine = h('div', { class: 'ps-kv', text: '' });
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
      var radius = Number(bingRangeSel.value);
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

    function draw() {
      var ctx2 = canvas.getContext && canvas.getContext('2d');
      if (!ctx2) { infoLine.textContent = 'Canvas 2D not available.'; return; }
      var w = canvas.width, hgt = canvas.height, cx = w / 2, cy = hgt / 2;
      var range = Number(rangeSel.value);
      var scale = Math.min(cx, cy) / range; // px per metre
      var own = PS.readOwn();
      var live = !!own;
      if (!own) own = { lat: 51.47, lon: -0.4543, hdgDeg: 90, gsKt: 0, altFt: 0 };

      ctx2.fillStyle = '#0f171e'; ctx2.fillRect(0, 0, w, hgt);
      ctx2.strokeStyle = '#2a3a47'; ctx2.fillStyle = '#6f8294'; ctx2.font = '11px Arial';
      [0.25, 0.5, 0.75, 1].forEach(function (f) {
        ctx2.beginPath(); ctx2.arc(cx, cy, range * f * scale, 0, Math.PI * 2); ctx2.stroke();
        ctx2.fillText(PS.fmt.dist(range * f), cx + 4, cy - range * f * scale + 12);
      });
      function xy(lat, lon) { var p = PS.geo.toXY(own.lat, own.lon, lat, lon); return [cx + p.x * scale, cy - p.y * scale]; }

      var taxi = PS.state.taxi;
      var drawn = 0;
      if (taxi) {
        taxi.items.forEach(function (it) {
          if (!it.points.length) return;
          ctx2.strokeStyle = it.category === 'Runway' ? '#8aa3b8' : (it.category === 'Taxiway' ? '#f0a830' : '#4d6275');
          ctx2.lineWidth = it.category === 'Runway' ? 4 : 2;
          ctx2.beginPath();
          it.points.forEach(function (p, i) { var q = xy(p[0], p[1]); if (i === 0) ctx2.moveTo(q[0], q[1]); else ctx2.lineTo(q[0], q[1]); });
          ctx2.stroke(); drawn++;
        });
        ctx2.lineWidth = 1;
      }
      PS.airTraffic.poll();
      var contacts = (PS.state.contacts && PS.state.contacts.length) ? PS.state.contacts : (PS.airTraffic.contacts || []);
      var inRange = 0;
      ctx2.font = '11px Arial';
      contacts.forEach(function (c) {
        var q = xy(c.lat, c.lon);
        if (q[0] < -10 || q[0] > w + 10 || q[1] < -10 || q[1] > hgt + 10) return;
        inRange++;
        ctx2.fillStyle = c.simulated ? '#c46af0' : '#ff5c5c';
        ctx2.beginPath(); ctx2.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx2.fill();
        ctx2.fillStyle = '#e8b4b4'; ctx2.fillText(c.title || '', q[0] + 8, q[1] + 4);
      });
      // own aircraft: arrow pointing along heading
      ctx2.save(); ctx2.translate(cx, cy); ctx2.rotate(PS.geo.rad(own.hdgDeg));
      ctx2.fillStyle = '#4cd18a'; ctx2.beginPath(); ctx2.moveTo(0, -20); ctx2.lineTo(13, 16); ctx2.lineTo(0, 8); ctx2.lineTo(-13, 16); ctx2.closePath(); ctx2.fill();
      ctx2.restore();
      infoLine.textContent = (live ? 'Own position live. ' : 'Own position: reference point (sim not readable). ') + 'Taxi items drawn: ' + drawn + '. AI aircraft in view: ' + inRange + ' of ' + contacts.length +
        (taxi && taxi.icao ? '. Airport ' + taxi.icao + ' loaded.' : '. No airport data loaded yet.');
    }

    var el = h('div', { class: 'ps-page' },
      ui.panel('Built-in map',
        h('div', { class: 'ps-row' }, ui.button('Probe for map APIs', probe), ui.button('Mount / remount built-in map', tryMount)),
        h('div', { class: 'ps-row' }, ui.field('Map mode', bingModeSel), ui.field('Map range', bingRangeSel)),
        mountBox, probeBox,
        ui.note('Looking for: whether the sim\'s own map can be shown in an EFB app, and whether we can draw taxiways, pins and the aircraft on top of it.')),
      ui.panel('Plot (runways, taxiways, AI aircraft; no imagery)',
        h('div', { class: 'ps-row' }, ui.field('Range', rangeSel)),
        canvas, infoLine),
      ui.panel('Log', ui.logBox(['map']))
    );
    return {
      el: el,
      onShow: function () {
        draw(); timer = setInterval(draw, 500);
        if (!mounted) tryMount();
        if (!PS.state.taxi && !airportLoading) {
          airportLoading = true;
          PS.facility.loadNearestIntoState().then(null, function (e) { log('could not load airport data: ' + PS.errText(e)); });
        }
      },
      onHide: function () { if (timer !== null) { clearInterval(timer); timer = null; } if (bingTimer !== null) { clearInterval(bingTimer); bingTimer = null; } }
    };
  }
});
