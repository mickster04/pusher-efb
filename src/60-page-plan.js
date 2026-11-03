// Plan tab: where the push should go. A north-up plot centred on the aircraft shows runways, taxiways, stands and AI aircraft. Tap to drop
// directional pins (each is drawn as an aircraft pointing the way the nose will be there), drag a pin to move it, drag the handle behind a
// selected pin to rotate it, or pick a suggested push. The planned route (turn arcs, forward and reverse legs, warnings) comes from
// PS.plan / PS.planner. The plan it leaves is what the Push tab will drive.

PS.pages.push({
  id: 'plan',
  title: 'Plan',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var PLOT_STEPS = [100, 200, 300, 500, 1000, 2000, 3000];
    var HANDLE_PX = 42;          // how far behind the tail the heading handle sits
    var canvas = h('canvas', { class: 'ps-canvas', width: '900', height: '540' });
    var plotRange = ui.stepper(PLOT_STEPS, 300, function () { draw('action'); }, 'plan');
    var infoLine = h('div', { class: 'ps-kv', text: '' });
    var contactLine = h('div', { class: 'ps-kv', text: '' });
    var routeBox = h('div');
    var pinList = h('div');
    var sugBox = h('div');
    var airportLine = h('div', { class: 'ps-kv', text: '' });
    var calLine = h('div', { class: 'ps-kv', text: '' });
    var calBtn = null;
    var addBtn = null;
    var addMode = true;
    var timer = null;
    var airportLoading = false;
    var drag = null;            // { kind: 'handle' | 'pin' | 'none', idx, sx, sy, moved }
    var lastView = null, lastOwn = null, lastPlan = null, renderedPlan = null;
    var selectedContact = null;
    var sug = { list: [], selectedId: null, key: '', at: 0, logged: false, tookMs: 0 };

    function log(msg) { PS.log('plan', msg); }
    function ownOrReference() {
      var o = PS.readOwn();
      if (o) return { own: o, live: true };
      var t = PS.state.taxi, p = t && t.parking && t.parking.length ? t.parking[0] : null;
      return { own: { lat: p ? p.lat : 51.47, lon: p ? p.lon : -0.4543, hdgDeg: 90, gsKt: 0, altFt: 0 }, live: false };
    }
    function contactsNow() { return PS.airTraffic.contacts || []; }
    function canvasPoint(e) {
      var r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * canvas.width / (r.width || canvas.width), (e.clientY - r.top) * canvas.height / (r.height || canvas.height)];
    }
    function pxDist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }

    // ---------------- diagnostics: what triggers each redraw and whether the plot really changes ----------------
    var lastDrawAt = 0, lastDrawErr = '';
    var diag = { counts: { timer: 0, frame: 0, click: 0, manual: 0, show: 0, action: 0 }, draws: 0, errors: 0, msSum: 0, msMax: 0, gapMax: 0,
      inChanged: 0, pxChanged: 0, sig: '', pix: '', ring: [], timerTicks: 0, timerLast: 0, timerGapMax: 0, frameCalls: 0, clicks: 0, mouse: 0,
      shownAt: 0, shows: 0, hides: 0, lastSummaryDraws: 0, watch: 0 };
    var diagBox = h('pre', { class: 'ps-log', text: '(opens with the page)' });
    var diagTimer = null;
    function pixelSig() {
      try {
        var t0 = Date.now(), g = canvas.getContext('2d'), sum = 0;
        var d = g.getImageData(0, 0, canvas.width, canvas.height).data;
        for (var i = 0; i < d.length; i += 52) sum = (sum * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000003;
        diag.pixMs = (diag.pixMs || 0) + (Date.now() - t0); diag.pixRuns = (diag.pixRuns || 0) + 1;
        return String(sum);
      } catch (e) { return 'n/a'; }
    }
    function inputsSig(own, cs) {
      var s = own.lat.toFixed(6) + ',' + own.lon.toFixed(6) + ',' + Math.round(own.hdgDeg) + '|' + plotRange.get() + '|' + PS.plan.count() + '|' + PS.plan.selected() + '|' + sug.selectedId + '|' + cs.length;
      for (var i = 0; i < cs.length && i < 4; i++) s += '|' + cs[i].lat.toFixed(6) + ',' + cs[i].lon.toFixed(6);
      return s;
    }
    function diagText() {
      var now = Date.now(), T = PS.airTraffic, cs = contactsNow(), o = lastOwn;
      var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { width: 0, height: 0, left: 0, top: 0 };
      var lines = [
        'Refresh diagnostics. Page open for ' + (diag.shownAt ? Math.round((now - diag.shownAt) / 1000) : 0) + ' s (shown ' + diag.shows + 'x, hidden ' + diag.hides + 'x). document.hidden=' + (typeof document !== 'undefined' ? document.hidden : '?') + ', visibility=' + (typeof document !== 'undefined' ? document.visibilityState : '?'),
        'draws: ' + diag.draws + ' (timer ' + diag.counts.timer + ', frame ' + diag.counts.frame + ', click ' + diag.counts.click + ', manual ' + diag.counts.manual + ', show ' + diag.counts.show + ', action ' + diag.counts.action + '); errors ' + diag.errors,
        'draw time: avg ' + (diag.draws ? (diag.msSum / diag.draws).toFixed(1) : '0') + ' ms (of which the canvas pixel check ' + (diag.pixRuns ? (diag.pixMs / diag.pixRuns).toFixed(1) : '0') + ' ms), max ' + diag.msMax + ' ms; longest gap between draws ' + diag.gapMax + ' ms; last draw ' + (lastDrawAt ? ((now - lastDrawAt) / 1000).toFixed(1) + ' s ago' : 'never'),
        'redraw timer: ' + diag.timerTicks + ' ticks (longest gap ' + diag.timerGapMax + ' ms); frame hook calls ' + diag.frameCalls + '; page clicks ' + diag.clicks + '; canvas mouse events ' + diag.mouse,
        'repaint nudge mode: ' + nudgeMode + ' (all = resize + flush + style)',
        'input events on the canvas: ' + (Object.keys(inp.counts).map(function (k) { return k + ' ' + inp.counts[k]; }).join(', ') || 'none yet') + '; presses handled ' + inp.presses,
        'draws where the plot inputs changed: ' + diag.inChanged + ' of ' + diag.draws + '; where the canvas pixels changed: ' + diag.pxChanged + ' of ' + (diag.pxSamples || 0) + ' sampled (every 4th draw, in the all and flush repaint modes only)',
        'canvas ' + canvas.width + 'x' + canvas.height + ', shown ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' at (' + Math.round(r.left) + ', ' + Math.round(r.top) + ')',
        'own ' + (o ? o.lat.toFixed(6) + ', ' + o.lon.toFixed(6) + ', hdg ' + Math.round(o.hdgDeg) : 'unknown') + '; contacts ' + cs.length + '; traffic replies ' + T.calls + ', last reply ' + (T.lastAt ? ((now - T.lastAt) / 1000).toFixed(1) + ' s ago' : 'never') + (T.error ? ', error: ' + T.error : ''),
        'airport ' + (PS.state.taxi ? PS.state.taxi.icao + ' (' + PS.state.taxi.items.length + ' items)' : 'not loaded') + '; suggestions ' + sug.list.length + ' (last run ' + sug.tookMs + ' ms); pins ' + PS.plan.count(),
        'recent draws, newest last (+seconds since page opened):'
      ];
      diag.ring.slice(-25).forEach(function (d) {
        lines.push('  +' + ((d.t - diag.shownAt) / 1000).toFixed(1) + 's ' + d.src + ' gap ' + d.gap + ' ms, ' + d.ms + ' ms, inputs ' + (d.inC ? 'Y' : '-') + ' pixels ' + (d.pxC ? 'Y' : '-') + ' contacts ' + d.n + ' replies ' + d.replies + ' hdg ' + Math.round(d.hdg) + (d.err ? ' ERROR ' + d.err : ''));
      });
      return lines.join('\n');
    }
    // Watchdog, independent of the redraw trigger: every 5 s it reports how many draws happened, and says so loudly when none did.
    function diagTick() {
      diagBox.textContent = diagText();
      diag.watch++;
      if (diag.watch % 5 !== 0) return;
      var since = diag.draws - diag.lastSummaryDraws; diag.lastSummaryDraws = diag.draws;
      log('refresh summary: ' + since + ' draw(s) in the last 5 s' + (since === 0 ? ' - NO REDRAWS' : '') + ' (timer ' + diag.counts.timer + ' frame ' + diag.counts.frame + ' click ' + diag.counts.click + ' total); redraw timer ticks ' + diag.timerTicks + ', frame hook calls ' + diag.frameCalls +
        ', inputs changed ' + diag.inChanged + '/' + diag.draws + ', pixels changed ' + diag.pxChanged + '/' + (diag.pxSamples || 0) + ' sampled, traffic replies ' + PS.airTraffic.calls + ', errors ' + diag.errors + ', hidden=' + (typeof document !== 'undefined' ? document.hidden : '?'));
    }
    // ---- forcing the sim's browser to put the canvas on screen ----
    // The canvas was drawn (the diagnostics say so) but only showed after the page was scrolled away and back: the sim does not repaint a
    // canvas by itself. Three nudges are tried after every draw, and the mode can be switched on the page to find which one is needed:
    //   resize: reassigning canvas.width reallocates the backing store (the whole plot is repainted every draw anyway);
    //   flush:  reading one pixel back forces any queued drawing to complete;
    //   style:  alternating the canvas opacity by 0.1% marks it as changed for the compositor.
    var NUDGE_MODES = ['all', 'resize', 'flush', 'style', 'off'];
    var nudgeMode = 'all', nudgeFlip = false;
    function nudgeBefore() { if (nudgeMode === 'all' || nudgeMode === 'resize') { var w0 = canvas.width; canvas.width = w0; } }
    function nudgeAfter() {
      if (nudgeMode === 'off') return;
      try {
        if (nudgeMode === 'all' || nudgeMode === 'flush') canvas.getContext('2d').getImageData(0, 0, 1, 1);
        if (nudgeMode === 'all' || nudgeMode === 'style') { nudgeFlip = !nudgeFlip; canvas.style.opacity = nudgeFlip ? '0.999' : '1'; }
      } catch (e) { /* a nudge must never break the draw */ }
    }
    // draw() never throws: an error is shown under the plot and logged once, and the redraw triggers keep going.
    function draw(src) {
      src = typeof src === 'string' ? src : 'action';
      var t0 = Date.now(), gap = lastDrawAt ? t0 - lastDrawAt : 0, err = '';
      lastDrawAt = t0;
      try { nudgeBefore(); drawPlot(); nudgeAfter(); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(nudgeAfter); }
      catch (e) {
        err = PS.errText(e);
        infoLine.textContent = 'Plot draw error: ' + err;
        diag.errors++;
        if (err !== lastDrawErr) { lastDrawErr = err; log('plot draw failed: ' + err); }
      }
      try {
        var ms = Date.now() - t0, o = lastOwn || { lat: 0, lon: 0, hdgDeg: 0 }, cs = contactsNow();
        diag.draws++; diag.counts[src] = (diag.counts[src] || 0) + 1;
        diag.msSum += ms; if (ms > diag.msMax) diag.msMax = ms; if (gap > diag.gapMax) diag.gapMax = gap;
        var sig = inputsSig(o, cs), inC = sig !== diag.sig; diag.sig = sig; if (inC) diag.inChanged++;
        // The pixel check reads the whole canvas back, which costs several ms, so it runs on every 4th draw only (changes are counted against those).
        // Only in the modes that read the canvas back anyway: a readback forces a flush, which would hide what 'style', 'resize' and 'off' do.
        var sampled = diag.draws % 4 === 1 && (nudgeMode === 'all' || nudgeMode === 'flush'), pxC = false;
        if (sampled) { var pix = pixelSig(); pxC = pix !== diag.pix; diag.pix = pix; diag.pxSamples = (diag.pxSamples || 0) + 1; if (pxC) diag.pxChanged++; }
        diag.ring.push({ t: t0, src: src, gap: gap, ms: ms, inC: inC, pxC: pxC, n: cs.length, replies: PS.airTraffic.calls, lat: o.lat, lon: o.lon, hdg: o.hdgDeg, err: err });
        if (diag.ring.length > 60) diag.ring.shift();
        if (diag.draws <= 6 || err) log('draw #' + diag.draws + ' (' + src + '): ' + ms + ' ms, ' + gap + ' ms since the last, inputs ' + (inC ? 'changed' : 'same') + ', canvas pixels ' + (sampled ? (pxC ? 'changed' : 'same') : 'not checked') + (err ? ', ERROR ' + err : ''));
      } catch (e2) { log('diagnostics failed: ' + PS.errText(e2)); }
    }

    // ---------------- pins ----------------
    function setAddMode(on) {
      addMode = on;
      if (addBtn) { addBtn.textContent = 'Add pins: ' + (on ? 'ON (tap the plot)' : 'off'); addBtn.className = 'ps-btn' + (on ? ' ps-warn' : ''); }
      canvas.className = 'ps-canvas' + (on ? ' ps-pinmode' : '');
    }
    function planChanged() { renderedPlan = null; draw('action'); }
    // Editing the plan by hand takes over from any suggestion that was being previewed, so its route is taken off the plot.
    function dropSuggestionPreview() { if (sug.selectedId) { sug.selectedId = null; renderSuggestions(); } }
    function addPin(lat, lon) {
      dropSuggestionPreview();
      var i = PS.plan.add(lat, lon);
      log('pin ' + (i + 1) + ' added at ' + lat.toFixed(6) + ', ' + lon.toFixed(6));
      planChanged();
    }
    function deletePin(i) { PS.plan.remove(i); log('pin ' + (i + 1) + ' deleted; ' + PS.plan.count() + ' left'); planChanged(); }
    function pinHeading(i) {
      if (!lastPlan) return null;
      for (var k = 0; k < lastPlan.items.length; k++) { if (lastPlan.items[k].userIndex === i) return lastPlan.items[k].headingDeg; }
      return null;
    }
    // Where the heading handle of pin i sits on the canvas: HANDLE_PX behind the tail of the aircraft drawn there.
    function handlePx(i) {
      var pins = PS.plan.list(), hd = pinHeading(i);
      if (!lastView || !pins[i] || hd === null || hd === undefined) return null;
      var q = lastView.toPx(pins[i].lat, pins[i].lon), a = PS.geo.rad(hd);
      return [q[0] - Math.sin(a) * HANDLE_PX, q[1] + Math.cos(a) * HANDLE_PX];
    }

    function legWord(sign) { return sign < 0 ? 'push back' : 'drive forward'; }
    function renderRoute(plan, own) {
      PS.clear(routeBox);
      if (plan.empty) {
        routeBox.appendChild(ui.note('No route yet. Tap the plot to drop pins (Add pins is on), or pick a suggested push below. The last pin is where the aircraft ends up; rotate it with the handle behind it.'));
        return;
      }
      routeBox.appendChild(h('div', { class: 'ps-result ' + (plan.warnings.length ? 'bad' : 'ok'),
        text: PS.fmt.dist(plan.totalM) + ' in ' + plan.legs.length + ' leg(s)' + (plan.turnaroundAdded ? ', with a turnaround pin added by the planner' : '') + (plan.warnings.length ? '. The tug may not manage it (see below)' : '. Plans without a warning') }));
      plan.legs.forEach(function (l, n) {
        routeBox.appendChild(h('div', { class: 'ps-kv', text: 'Leg ' + (n + 1) + ': ' + legWord(l.sign) + ' ' + PS.fmt.dist(l.lengthM) + ', ends facing ' + Math.round(l.endHdgDeg) + '°' }));
      });
      plan.warnings.forEach(function (w) { routeBox.appendChild(h('div', { class: 'ps-result bad', text: w })); });
    }
    function renderPins(plan, own) {
      PS.clear(pinList);
      var pins = PS.plan.list();
      if (!pins.length) { pinList.appendChild(ui.note('No pins.')); return; }
      var legs = PS.routeLegs(own, pins), sel = PS.plan.selected();
      pins.forEach(function (p, i) {
        var hd = pinHeading(i);
        pinList.appendChild(h('div', { class: 'ps-pinrow' + (i === sel ? ' on' : '') },
          h('span', { text: (i === pins.length - 1 ? 'End' : 'Pin ' + (i + 1)) + ': ' + PS.fmt.dist(legs.legs[i].distM) + ' on a bearing of ' + Math.round(legs.legs[i].bearingDeg) + '°, nose ' + (hd === null ? '?' : Math.round(hd) + '°') + (p.headingUser ? ' (set by you)' : ' (auto)') }),
          ui.button(i === sel ? 'Selected' : 'Select', function () { PS.plan.select(i); planChanged(); }, 'ps-small ps-ghost'),
          p.headingUser ? ui.button('Auto heading', function () { PS.plan.resetHeading(i); log('pin ' + (i + 1) + ' heading back to auto'); planChanged(); }, 'ps-small ps-ghost') : null,
          ui.button('Delete', function () { deletePin(i); }, 'ps-small ps-ghost')));
      });
    }

    // ---------------- input: mouse, touch and pointer events ----------------
    // Which of these the EFB delivers is not known. Touch is handled first (and stops the page scrolling under a drag), the mouse events
    // that follow a touch are ignored, and every event type seen is counted with its first few logged, so the diagnostics show what arrives.
    var inp = { counts: {}, lastTouchAt: 0, lastPoint: null, presses: 0, hits: {} };
    function note(type, p) {
      inp.counts[type] = (inp.counts[type] || 0) + 1;
      if (inp.counts[type] <= 3) log('input event ' + type + ' #' + inp.counts[type] + (p ? ' at canvas ' + Math.round(p[0]) + ', ' + Math.round(p[1]) : ''));
    }
    // Where a tap lands on the canvas, in canvas pixels. Pins were landing about 100 m north of where they were tapped, so the position is
    // worked out two ways and logged: from the event's client position against the canvas rectangle, and (mouse events) from offsetX/offsetY,
    // which is relative to the canvas itself and is not thrown off if the EFB's panel is scaled or shifted. The offset method is used when
    // there is one. A calibration (tap the middle of the green aircraft once) corrects any constant error that is left.
    var cal = { dx: 0, dy: 0 };
    var calibrating = false;
    var lastPress = null;     // { p: [x, y], at } for the marker drawn where the app thinks the tap was
    try { var saved = JSON.parse(window.localStorage.getItem('pushplanner.tapcal') || 'null'); if (saved && isFinite(saved.dx) && isFinite(saved.dy)) cal = { dx: saved.dx, dy: saved.dy }; } catch (e0) { /* storage may be unavailable */ }
    function rawOf(e) {
      var touch = !!((e.changedTouches && e.changedTouches.length) || (e.touches && e.touches.length));
      var t = touch ? (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e.touches[0]) : e;
      var r = canvas.getBoundingClientRect();
      var sx = canvas.width / (r.width || canvas.width), sy = canvas.height / (r.height || canvas.height);
      var rectPt = [(t.clientX - r.left) * sx, (t.clientY - r.top) * sy], offPt = null;
      if (!touch && typeof e.offsetX === 'number' && e.target === canvas) offPt = [e.offsetX * canvas.width / (canvas.clientWidth || canvas.width), e.offsetY * canvas.height / (canvas.clientHeight || canvas.height)];
      return { touch: touch, t: t, r: r, rectPt: rectPt, offPt: offPt, base: offPt || rectPt };
    }
    function pointOf(e) {
      var o = rawOf(e);
      inp.lastRaw = o;
      return [o.base[0] + cal.dx, o.base[1] + cal.dy];
    }
    function logPress(p) {
      var o = inp.lastRaw;
      if (!o || inp.presses > 10) return;
      var b = document.querySelector ? document.querySelector('.ps-body') : null;
      log('press raw: client ' + Math.round(o.t.clientX) + ',' + Math.round(o.t.clientY) + (typeof o.t.pageX === 'number' ? ' page ' + Math.round(o.t.pageX) + ',' + Math.round(o.t.pageY) : '') + (typeof o.t.screenX === 'number' ? ' screen ' + Math.round(o.t.screenX) + ',' + Math.round(o.t.screenY) : '') +
        (o.offPt ? ' offset ' + Math.round(o.t.offsetX) + ',' + Math.round(o.t.offsetY) : '') + ' | canvas rect left ' + Math.round(o.r.left) + ' top ' + Math.round(o.r.top) + ' size ' + Math.round(o.r.width) + 'x' + Math.round(o.r.height) +
        ' (css ' + canvas.clientWidth + 'x' + canvas.clientHeight + ', backing ' + canvas.width + 'x' + canvas.height + ') | window ' + window.innerWidth + 'x' + window.innerHeight + ' dpr ' + window.devicePixelRatio + (b ? ' bodyScrollTop ' + Math.round(b.scrollTop) : '') +
        ' | canvas px by rect ' + Math.round(o.rectPt[0]) + ',' + Math.round(o.rectPt[1]) + (o.offPt ? ' by offset ' + Math.round(o.offPt[0]) + ',' + Math.round(o.offPt[1]) : '') + ' | used ' + Math.round(p[0]) + ',' + Math.round(p[1]) + ' (calibration ' + Math.round(cal.dx) + ',' + Math.round(cal.dy) + ')');
    }
    function setCalibration(dx, dy) {
      cal = { dx: dx, dy: dy };
      try { window.localStorage.setItem('pushplanner.tapcal', JSON.stringify(cal)); } catch (e1) { /* not saved, still applied this session */ }
      calLine.textContent = 'Tap calibration: ' + (dx === 0 && dy === 0 ? 'none' : Math.round(dx) + ' px across, ' + Math.round(dy) + ' px down (canvas pixels)') + '.';
    }
    function recentTouch() { return Date.now() - inp.lastTouchAt < 800; }

    function inputDown(p, touch) {
      diag.mouse++; inp.presses++; inp.lastPoint = p;
      logPress(p);
      lastPress = { p: p, at: Date.now() };
      if (calibrating) {
        // The tap was aimed at the middle of the green aircraft, which is the middle of the canvas: whatever it landed away from that is the error.
        var b = inp.lastRaw ? inp.lastRaw.base : p;
        setCalibration(canvas.width / 2 - b[0], canvas.height / 2 - b[1]);
        calibrating = false; calBtn.textContent = 'Calibrate taps';
        log('tap calibration set: ' + Math.round(cal.dx) + ', ' + Math.round(cal.dy) + ' canvas px (tapped ' + Math.round(b[0]) + ',' + Math.round(b[1]) + ', aimed at ' + canvas.width / 2 + ',' + canvas.height / 2 + ')');
        drag = null; planChanged(); return;
      }
      if (!lastView) { log('press ignored: the plot has not been drawn yet'); return; }
      var sel = PS.plan.selected();
      if (sel >= 0) {
        var hp = handlePx(sel);
        if (hp && pxDist(hp, p) <= (touch ? 26 : 16)) { drag = { kind: 'handle', idx: sel, sx: p[0], sy: p[1], moved: false, touch: touch }; if (inp.presses <= 12) log('press on the heading handle of pin ' + (sel + 1)); return; }
      }
      var hit = PS.nearestPin(lastView, PS.plan.list(), p[0], p[1], touch ? 30 : 22);
      if (hit >= 0) { PS.plan.select(hit); drag = { kind: 'pin', idx: hit, sx: p[0], sy: p[1], moved: false, touch: touch }; if (inp.presses <= 12) log('press on pin ' + (hit + 1)); planChanged(); return; }
      drag = { kind: 'none', idx: -1, sx: p[0], sy: p[1], moved: false, touch: touch };
    }
    function inputMove(p) {
      if (!drag || !lastView) return;
      inp.lastPoint = p;
      var limit = drag.touch ? 14 : 6;
      if (!drag.moved && Math.abs(p[0] - drag.sx) + Math.abs(p[1] - drag.sy) > limit) drag.moved = true;
      if (drag.kind === 'handle') {
        var pins = PS.plan.list(), q = lastView.toPx(pins[drag.idx].lat, pins[drag.idx].lon);
        PS.plan.setHeading(drag.idx, PS.plan.headingFromHandle(q[0], q[1], p[0], p[1]));
        draw('action');
      } else if (drag.kind === 'pin' && drag.moved) {
        var ll = lastView.fromPx(p[0], p[1]);
        PS.plan.move(drag.idx, ll[0], ll[1]);
        draw('action');
      }
    }
    function inputUp(p) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.kind === 'handle') { dropSuggestionPreview(); log('pin ' + (d.idx + 1) + ' rotated to ' + PS.plan.list()[d.idx].headingDeg + '°'); planChanged(); return; }
      if (d.kind === 'pin') { if (d.moved) { dropSuggestionPreview(); log('pin ' + (d.idx + 1) + ' moved'); planChanged(); } return; }
      if (d.moved || !lastView) return;
      if (addMode) { var ll = lastView.fromPx(p[0], p[1]); addPin(ll[0], ll[1]); return; }
      // Add pins off: pick the nearest aircraft to read its details, or clear the selection.
      var best = null, bestD = 16;
      contactsNow().forEach(function (c) {
        var dd = pxDist(lastView.toPx(c.lat, c.lon), p);
        if (dd < bestD) { bestD = dd; best = c; }
      });
      selectedContact = best ? best.id : null;
      PS.plan.select(-1); planChanged();
    }

    // Touch: handled here and the page is stopped from scrolling under the finger.
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
      canvas.addEventListener(type, function (e) {
        inp.lastTouchAt = Date.now();
        var p = pointOf(e);
        note(type, p);
        if (e.preventDefault) e.preventDefault();
        if (type === 'touchstart') inputDown(p, true);
        else if (type === 'touchmove') inputMove(p);
        else if (type === 'touchend') inputUp(p);
        else drag = null;
      }, false);
    });
    // Mouse: the same handlers, ignoring the mouse events a browser emulates after a touch.
    canvas.addEventListener('mousedown', function (e) { var p = pointOf(e); note('mousedown', p); if (recentTouch()) return; inputDown(p, false); });
    canvas.addEventListener('mousemove', function (e) { if (recentTouch()) return; if (drag) note('mousemove', null); inputMove(pointOf(e)); });
    canvas.addEventListener('mouseup', function (e) { var p = pointOf(e); note('mouseup', p); if (recentTouch()) return; inputUp(p); });
    canvas.addEventListener('mouseleave', function () { if (!recentTouch()) drag = null; });
    // Pointer events: counted only, to learn whether the EFB sends them (the mouse and touch handlers above do the work).
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (type) {
      canvas.addEventListener(type, function (e) { if (type === 'pointermove' && !drag) return; note(type, pointOf(e)); }, false);
    });
    canvas.addEventListener('click', function (e) { note('click', pointOf(e)); }, false);

    // ---------------- suggested pushes ----------------
    function selectedSuggestion() {
      for (var i = 0; i < sug.list.length; i++) { if (sug.list[i].id === sug.selectedId) return sug.list[i]; }
      return null;
    }
    function renderSuggestions() {
      PS.clear(sugBox);
      var t = PS.state.taxi;
      if (!t) { sugBox.appendChild(ui.note('No airport data loaded yet.')); return; }
      if (!sug.list.length) {
        sugBox.appendChild(ui.note('No suggestions: no named taxiway, link or lane is within reach where the tail points, or the taxi module supplied no paths (' + t.items.length + ' items loaded). You can still drop pins by hand.'));
        return;
      }
      var cur = selectedSuggestion();
      if (cur) {
        sugBox.appendChild(h('div', { class: 'ps-row' },
          ui.button('Use as my plan', function () {
            PS.plan.setAll(cur.waypoints);
            log('plan set from suggestion "' + cur.title + '" (' + PS.plan.count() + ' pin(s))');
            sug.selectedId = null; renderSuggestions(); planChanged();
          }),
          ui.button('Hide route', function () { sug.selectedId = null; renderSuggestions(); draw('action'); }, 'ps-ghost')));
      }
      sug.list.forEach(function (s, i) {
        sugBox.appendChild(h('button', { type: 'button', class: 'ps-sug' + (s.id === sug.selectedId ? ' on' : ''), onclick: function () {
          sug.selectedId = s.id === sug.selectedId ? null : s.id;
          log('suggestion ' + (i + 1) + (sug.selectedId ? ' shown: ' : ' hidden: ') + s.title + ' (' + Math.round(s.lengthM) + ' m)');
          renderSuggestions(); draw('action');
        } }, h('div', { class: 'ps-sug-title', text: (i + 1) + '. ' + s.title + '  (' + PS.fmt.dist(s.lengthM) + ')' }), h('div', { class: 'ps-sug-detail', text: s.detail })));
      });
    }
    function refreshSuggestions(own) {
      var now = Date.now(), t = PS.state.taxi;
      if (!t || !t.items || !t.items.length) {
        if (sug.list.length || sug.key !== 'none') { sug.list = []; sug.key = 'none'; renderSuggestions(); }
        return;
      }
      var key = [t.icao || '', t.items.length, own.lat.toFixed(5), own.lon.toFixed(5), Math.round(own.hdgDeg)].join('|');
      // Not while the aircraft is moving (a push is under way), and no more often than 10x the time the last run took.
      if (key === sug.key || now - sug.at < Math.max(1500, sug.tookMs * 10)) return;
      if (own.gsKt > 1 && sug.list.length) return;
      sug.key = key; sug.at = now;
      var before = sug.list.length;
      try {
        var t0 = Date.now();
        sug.list = PS.suggest.suggest(t.items, own, t.parking);
        sug.tookMs = Date.now() - t0;
        if (!sug.logged || sug.list.length !== before) { sug.logged = true; log('suggested pushes: ' + sug.list.length + ' option(s) in ' + sug.tookMs + ' ms (heading ' + Math.round(own.hdgDeg) + ')'); }
      } catch (e) { sug.list = []; log('suggestion failed: ' + PS.errText(e)); }
      if (sug.selectedId && !selectedSuggestion()) sug.selectedId = null;
      renderSuggestions();
    }
    function loadAirport(why) {
      airportLoading = true;
      airportLine.textContent = 'Loading airport data' + (why ? ' (' + why + ')' : '') + '...';
      return PS.facility.loadNearestIntoState().then(function (icao) {
        airportLoading = false; sug.key = ''; airportLine.textContent = 'Airport ' + icao + ' loaded: ' + PS.state.taxi.items.length + ' runway/path item(s), ' + PS.state.taxi.parking.length + ' stand(s).';
        renderSuggestions(); draw('action');
      }, function (e) { airportLoading = false; airportLine.textContent = 'Could not load airport data: ' + PS.errText(e); log('could not load airport data: ' + PS.errText(e)); });
    }

    // ---------------- drawing ----------------
    // An aircraft marker (nose up, then rotated): the pin's direction is the way the nose points there.
    function drawAircraftMarker(g, x, y, headingDeg, fill, stroke, scale) {
      g.save(); g.translate(x, y); g.rotate(PS.geo.rad(headingDeg)); g.scale(scale, scale);
      g.beginPath(); g.moveTo(0, -17); g.lineTo(5, -6); g.lineTo(17, 4); g.lineTo(17, 8); g.lineTo(5, 4); g.lineTo(4, 11); g.lineTo(9, 15); g.lineTo(9, 18); g.lineTo(0, 16); g.lineTo(-9, 18); g.lineTo(-9, 15); g.lineTo(-4, 11);
      g.lineTo(-5, 4); g.lineTo(-17, 8); g.lineTo(-17, 4); g.lineTo(-5, -6); g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
      g.restore();
    }
    function labelAt(g, text, x, y) {
      g.font = 'bold 13px Arial'; g.lineWidth = 3; g.strokeStyle = '#0b1116'; g.strokeText(text, x, y); g.fillStyle = '#ffffff'; g.fillText(text, x, y);
    }
    // Direction chevrons along a drawn path every ~46 px, pointing the way the tug travels.
    function chevrons(g, px, color) {
      var acc = 0, next = 30;
      g.fillStyle = color;
      for (var i = 1; i < px.length; i++) {
        var dx = px[i][0] - px[i - 1][0], dy = px[i][1] - px[i - 1][1], len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) continue;
        while (acc + len >= next) {
          var f = (next - acc) / len, x = px[i - 1][0] + dx * f, y = px[i - 1][1] + dy * f, a = Math.atan2(dy, dx);
          g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(5, 0); g.lineTo(-4, -5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.restore();
          next += 46;
        }
        acc += len;
      }
    }
    function strokePath(g, pts, view, color, width) {
      g.strokeStyle = color; g.lineWidth = width; g.beginPath();
      var px = pts.map(function (p) { return view.toPx(p[0], p[1]); });
      px.forEach(function (q, i) { if (i === 0) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); });
      g.stroke(); g.lineWidth = 1;
      return px;
    }

    function drawPlot() {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) { infoLine.textContent = 'Canvas 2D not available.'; return; }
      var c = ownOrReference(), own = c.own;
      lastOwn = own;
      var w = canvas.width, hgt = canvas.height, range = plotRange.get();
      var view = PS.plotView(w, hgt, own, range);
      lastView = view;
      refreshSuggestions(own);
      var plan = PS.plan.evaluate(own);
      lastPlan = plan;
      if (plan !== renderedPlan) { renderedPlan = plan; renderRoute(plan, own); renderPins(plan, own); }

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
            if (mx > 0 && mx < w && my > 0 && my < hgt) labels[nm] = [mx, my];
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

      // Suggested pushes: end markers for all (numbered), the planned route and final nose for the chosen one.
      var chosen = selectedSuggestion();
      g.font = 'bold 11px Arial';
      sug.list.forEach(function (s, i) {
        if (s === chosen) return;
        var e = s.pins[s.pins.length - 1], q = view.toPx(e[0], e[1]);
        g.fillStyle = '#34d2c8'; g.beginPath(); g.arc(q[0], q[1], 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0f171e'; g.fillText(String(i + 1), q[0] - (i > 8 ? 6 : 3), q[1] + 4);
      });
      if (chosen) {
        chevrons(g, strokePath(g, chosen.route, view, '#34d2c8', 4), '#0f171e');
        var ep = chosen.pins[chosen.pins.length - 1], eq = view.toPx(ep[0], ep[1]);
        drawAircraftMarker(g, eq[0], eq[1], chosen.facingDeg, 'rgba(52,210,200,0.35)', '#34d2c8', 1);
      }

      // The plan: planned route by leg (push back = teal, forward = blue, a leg the tug may not manage = red), then directional pins.
      if (!plan.empty) {
        plan.segments.forEach(function (sg, n) {
          var color = plan.legs[n].warning ? '#ff5c6c' : (sg.sign < 0 ? '#ffffff' : '#5aa8ff');
          chevrons(g, strokePath(g, sg.points, view, color, 3), color);
        });
        g.font = 'bold 13px Arial';
        plan.items.forEach(function (it) {
          var q = view.toPx(it.wp.lat, it.wp.lon), isEnd = it.userIndex === PS.plan.count() - 1;
          if (it.turnaround) { drawAircraftMarker(g, q[0], q[1], it.headingDeg === null ? 0 : it.headingDeg, null, '#9fb3c4', 0.8); labelAt(g, 'turn', q[0] + 14, q[1] - 12); return; }
          drawAircraftMarker(g, q[0], q[1], it.headingDeg === null ? 0 : it.headingDeg, isEnd ? '#ff9f43' : '#e8f0f6', '#0b1116', isEnd ? 1.15 : 1);
          labelAt(g, isEnd ? 'End' : String(it.userIndex + 1), q[0] + 16, q[1] - 14);
        });
        var sel = PS.plan.selected();
        if (sel >= 0 && PS.plan.list()[sel]) {
          var sp = PS.plan.list()[sel], sq = view.toPx(sp.lat, sp.lon), hp = handlePx(sel);
          g.strokeStyle = '#ffe14d'; g.lineWidth = 3; g.beginPath(); g.arc(sq[0], sq[1], 25, 0, Math.PI * 2); g.stroke();
          if (hp) {
            g.lineWidth = 2; g.beginPath(); g.moveTo(sq[0], sq[1]); g.lineTo(hp[0], hp[1]); g.stroke();
            g.fillStyle = '#ffe14d'; g.beginPath(); g.arc(hp[0], hp[1], 10, 0, Math.PI * 2); g.fill();
            g.strokeStyle = '#0b1116'; g.lineWidth = 2; g.beginPath(); g.arc(hp[0], hp[1], 10, 0, Math.PI * 2); g.stroke();
          }
          g.lineWidth = 1;
        }
      }

      // AI traffic, read fresh from the sim's listener on every redraw.
      PS.airTraffic.poll();
      var contacts = contactsNow(), inView = 0, T = PS.airTraffic;
      g.font = '11px Arial';
      contacts.forEach(function (ct) {
        var q = view.toPx(ct.lat, ct.lon);
        if (q[0] < -10 || q[0] > w + 10 || q[1] < -10 || q[1] > hgt + 10) return;
        inView++;
        var sel2 = ct.id === selectedContact;
        g.fillStyle = '#ff5c5c';
        g.beginPath(); g.arc(q[0], q[1], sel2 ? 7 : 5, 0, Math.PI * 2); g.fill();
        var trk = typeof ct.trackDeg === 'number' && ct.gsKt > 1 ? ct.trackDeg : (ct.hdgDeg || 0);
        g.strokeStyle = '#ff5c5c'; g.lineWidth = 2; g.beginPath(); g.moveTo(q[0], q[1]);
        g.lineTo(q[0] + Math.sin(PS.geo.rad(trk)) * 16, q[1] - Math.cos(PS.geo.rad(trk)) * 16); g.stroke(); g.lineWidth = 1;
        g.fillStyle = '#e8b4b4'; g.fillText(ct.title || '', q[0] + 8, q[1] + 4);
      });

      // Own aircraft, pointing along its heading.
      drawAircraftMarker(g, view.cx, view.cy, own.hdgDeg, '#4cd18a', '#0b1116', 1.1);
      // Where the app thinks the last tap landed (for a few seconds), so any offset from where it was really tapped is visible.
      if (lastPress && Date.now() - lastPress.at < 5000) {
        g.strokeStyle = '#00e5ff'; g.lineWidth = 2; g.beginPath(); g.arc(lastPress.p[0], lastPress.p[1], 9, 0, Math.PI * 2); g.moveTo(lastPress.p[0] - 14, lastPress.p[1]); g.lineTo(lastPress.p[0] + 14, lastPress.p[1]);
        g.moveTo(lastPress.p[0], lastPress.p[1] - 14); g.lineTo(lastPress.p[0], lastPress.p[1] + 14); g.stroke(); g.lineWidth = 1;
      }
      if (calibrating) { g.fillStyle = '#ffe14d'; g.font = 'bold 15px Arial'; g.fillText('Tap the middle of the green aircraft', view.cx - 110, view.cy - 40); }

      var age = T.lastAt ? ((Date.now() - T.lastAt) / 1000).toFixed(1) + ' s ago' : 'never';
      infoLine.textContent = (c.live ? 'Own position live. ' : 'Own position: reference point (sim not readable). ') + 'Range ' + PS.fmt.dist(range) + '. Taxi items drawn: ' + drawn +
        '. AI aircraft in view: ' + inView + ' of ' + contacts.length + ' (listener updated ' + age + ')' + (taxi && taxi.icao ? '. Airport ' + taxi.icao + '.' : '. No airport data yet.');
      var sc = null;
      for (var k = 0; k < contacts.length; k++) { if (contacts[k].id === selectedContact) sc = contacts[k]; }
      if (sc) {
        var a = PS.traffic.analyse(own, sc);
        contactLine.textContent = (sc.title || sc.id) + ': ' + PS.fmt.dist(a.distM) + ' away on a bearing of ' + Math.round(a.bearingDeg) + '°, ' + PS.fmt.num(sc.gsKt, 0) + ' kt, heading ' + Math.round(sc.hdgDeg || 0) + '°, closing ' + PS.fmt.num(a.closingKt, 1) + ' kt';
      } else {
        contactLine.textContent = contacts.length && !addMode ? 'Tap an aircraft to read its details.' : '';
      }
    }

    // ---------------- page ----------------
    var repaintBtn = ui.button('Repaint: all', function () {
      nudgeMode = NUDGE_MODES[(NUDGE_MODES.indexOf(nudgeMode) + 1) % NUDGE_MODES.length];
      repaintBtn.textContent = 'Repaint: ' + nudgeMode;
      log('repaint nudge mode set to ' + nudgeMode);
      draw('manual');
    }, 'ps-ghost');
    calBtn = ui.button('Calibrate taps', function () {
      calibrating = !calibrating; calBtn.textContent = calibrating ? 'Cancel calibration' : 'Calibrate taps';
      log(calibrating ? 'tap calibration started: tap the middle of the green aircraft' : 'tap calibration cancelled'); draw('action');
    }, 'ps-small ps-ghost');
    setCalibration(cal.dx, cal.dy);
    addBtn = ui.button('Add pins: ON (tap the plot)', function () { setAddMode(!addMode); });
    setAddMode(true);

    var el = h('div', { class: 'ps-page' },
      ui.panel('Plan the push',
        h('div', { class: 'ps-row' }, ui.field('Range', plotRange.stepperEl || plotRange.el), addBtn,
          ui.button('Undo pin', function () { if (PS.plan.count()) deletePin(PS.plan.count() - 1); }, 'ps-ghost'),
          ui.button('Clear pins', function () { PS.plan.clear(); log('pins cleared'); planChanged(); }, 'ps-ghost'),
          ui.button('Refresh', function () { draw('manual'); }, 'ps-ghost'),
          repaintBtn),
        canvas, infoLine, contactLine,
        h('div', { class: 'ps-row' }, calBtn, ui.button('Reset calibration', function () { setCalibration(0, 0); log('tap calibration reset'); draw('action'); }, 'ps-small ps-ghost'), calLine),
        ui.note('North is up, centred on the aircraft. Each pin is drawn as an aircraft pointing the way the nose will be there. Tap a pin to select it: drag it to move it, drag the yellow handle behind it to rotate it. White route = push back, blue = drive forward, red = the tug may not manage that leg. Teal = suggested push.')),
      ui.panel('Route', routeBox),
      ui.panel('Suggested pushes', airportLine, sugBox,
        h('div', { class: 'ps-row' }, ui.button('Reload airport data', function () { loadAirport('asked'); }, 'ps-small ps-ghost')),
        ui.note('From the original app\'s suggester, planned with the same tug turn radius. Only options the tug can make without a warning are offered. Pick one to see it, then use it as your plan.')),
      ui.panel('Pins', pinList),
      ui.panel('Refresh diagnostics (send these back if the plot does not refresh)', diagBox,
        h('div', { class: 'ps-row' }, ui.button('Copy diagnostics', function () {
          var text = diagText(), ok = PS.ui.copyText(text);
          log(ok ? 'diagnostics copied' : 'clipboard copy not available; showing text');
          if (!ok) PS.ui.showText(text, 'Plan diagnostics (select all and copy)');
        }, 'ps-small'))),
      ui.panel('Log', ui.logBox(['plan', 'traffic', 'taxi', 'wasm']))
    );
    el.addEventListener('click', function () { diag.clicks++; setTimeout(function () { draw('click'); }, 0); setTimeout(function () { draw('click'); }, 400); });
    var frameHook = function () { diag.frameCalls++; if (Date.now() - lastDrawAt > 450) draw('frame'); };
    return {
      el: el,
      snapshot: function () { return diagText(); },
      onShow: function () {
        // Redraw triggers: the interval (started first, so a failing first draw cannot stop it), the EFB's per-frame update, and any click.
        if (timer !== null) clearInterval(timer);
        timer = setInterval(function () {
          var n = Date.now(); diag.timerTicks++;
          if (diag.timerLast) { var gp = n - diag.timerLast; if (gp > diag.timerGapMax) diag.timerGapMax = gp; }
          diag.timerLast = n; draw('timer');
        }, 500);
        diag.shownAt = Date.now(); diag.shows++; diag.watch = 0;
        if (diagTimer !== null) clearInterval(diagTimer);
        diagTimer = setInterval(diagTick, 1000);
        if (PS.frameHooks.indexOf(frameHook) < 0) PS.frameHooks.push(frameHook);
        log('plan page shown: canvas ' + canvas.width + 'x' + canvas.height + ', document.hidden=' + (typeof document !== 'undefined' ? document.hidden : '?') + ', setInterval=' + typeof setInterval + ', requestAnimationFrame=' + typeof requestAnimationFrame);
        renderedPlan = null; renderSuggestions();
        draw('show');
        if (!PS.state.taxi && !airportLoading) loadAirport('on opening');
      },
      onHide: function () {
        diag.hides++; log('plan page hidden after ' + diag.draws + ' draw(s)');
        if (diagTimer !== null) { clearInterval(diagTimer); diagTimer = null; }
        var fi = PS.frameHooks.indexOf(frameHook); if (fi >= 0) PS.frameHooks.splice(fi, 1);
        if (timer !== null) { clearInterval(timer); timer = null; }
        drag = null;
      }
    };
  }
});
