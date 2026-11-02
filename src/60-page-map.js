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
    var rangeSel = ui.select([{ value: '200', label: '200 m' }, { value: '500', label: '500 m' }, { value: '1000', label: '1 km' }, { value: '3000', label: '3 km' }], '500', function () { draw(); });
    var infoLine = h('div', { class: 'ps-kv', text: '' });
    var timer = null;

    function log(msg) { PS.log('map', msg); }

    function probe() {
      var lines = PS.mapProbe();
      probeBox.textContent = lines.join('\n');
      lines.forEach(function (l) { log(l); });
    }

    // Best-effort mount of a built-in map. Which of these (if any) works inside an EFB app is exactly what we want to learn.
    function tryMount() {
      PS.clear(mountBox);
      var sdk = PS.global.msfssdk;
      try {
        var def = typeof customElements !== 'undefined' && customElements.get ? customElements.get('map-instrument') : null;
        if (def) {
          var mi = document.createElement('map-instrument');
          mi.style.width = '100%'; mi.style.height = '320px';
          mountBox.appendChild(mi);
          log('created <map-instrument>; it needs configuration (bing id, flight plan, etc.) that we have not added. Check whether it renders anything.');
          return;
        }
        if (sdk && sdk.BingComponent && sdk.FSComponent) {
          var mode = sdk.EBingMode ? sdk.EBingMode.PLANE : 0;
          var vnode = sdk.FSComponent.buildComponent(sdk.BingComponent, { id: 'ps-bing', mode: mode, resolution: sdk.EBingResolution ? sdk.EBingResolution.Normal : undefined });
          sdk.FSComponent.render(vnode, mountBox);
          log('rendered msfssdk BingComponent; check below for a map image.');
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
      var contacts = PS.state.contacts || [];
      contacts.forEach(function (c) {
        var q = xy(c.lat, c.lon);
        ctx2.fillStyle = c.simulated ? '#c46af0' : '#ff5c5c';
        ctx2.beginPath(); ctx2.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx2.fill();
      });
      // own aircraft: arrow pointing along heading
      ctx2.save(); ctx2.translate(cx, cy); ctx2.rotate(PS.geo.rad(own.hdgDeg));
      ctx2.fillStyle = '#4cd18a'; ctx2.beginPath(); ctx2.moveTo(0, -12); ctx2.lineTo(8, 10); ctx2.lineTo(0, 5); ctx2.lineTo(-8, 10); ctx2.closePath(); ctx2.fill();
      ctx2.restore();
      infoLine.textContent = (live ? 'Own position live. ' : 'Own position: reference point (sim not readable). ') + 'Taxi items drawn: ' + drawn + '. Contacts drawn: ' + contacts.length +
        '. Load taxiways on page 3 and contacts on page 4 to see them here.';
    }

    var el = h('div', { class: 'ps-page' },
      ui.panel('Built-in map',
        h('div', { class: 'ps-row' }, ui.button('Probe for map APIs', probe), ui.button('Try to mount a built-in map', tryMount)),
        probeBox, mountBox,
        ui.note('Looking for: whether the sim\'s own map can be shown in an EFB app, and whether we can draw taxiways, pins and the aircraft on top of it.')),
      ui.panel('Baseline plot (no imagery)',
        h('div', { class: 'ps-row' }, ui.field('Range', rangeSel)),
        canvas, infoLine),
      ui.panel('Log', ui.logBox(['map']))
    );
    return {
      el: el,
      onShow: function () { draw(); timer = setInterval(draw, 500); },
      onHide: function () { if (timer !== null) { clearInterval(timer); timer = null; } }
    };
  }
});
