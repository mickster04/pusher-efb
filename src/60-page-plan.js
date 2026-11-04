// Plan tab: where the push should go. A north-up plot centred on the aircraft shows runways, taxiways, stands and AI aircraft. Tap to drop
// directional pins (each is drawn as an aircraft pointing the way the nose will be there), drag a pin to move it, drag the handle behind a
// selected pin to rotate it, drag empty map to move the map, or pick a suggested push. The planned route (turn arcs, forward and reverse legs,
// warnings) comes from PS.plan / PS.planner. The plan it leaves is what the Push tab drives.

PS.pages.push({
  id: 'plan',
  title: 'Plan',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h, D = PS.plotDraw;
    var PLOT_STEPS = [100, 200, 300, 500, 1000, 2000, 3000];
    var HANDLE_PX = 58;          // how far behind the tail the heading handle sits
    var HANDLE_HIT_PX = 36;      // how close a press has to be to the handle (canvas pixels, which are screen pixels: the canvas is not scaled)
    var canvas = h('canvas', { class: 'ps-canvas', width: '900', height: '540' });
    var plotRange = ui.stepper(PLOT_STEPS, 300, function () { draw(); }, 'plan');
    var infoLine = h('div', { class: 'ps-kv', text: '' });
    var contactLine = h('div', { class: 'ps-kv', text: '' });
    var routeSummary = h('div', { class: 'ps-note' });
    var pinList = h('div');
    var sugBox = h('div');
    var airportLine = h('div', { class: 'ps-kv', text: '' });
    var addBtn = null;
    var addMode = true;
    var timer = null;
    var airportLoading = false;
    var drag = null;            // { kind: 'handle' | 'pin' | 'none', idx, sx, sy, moved, touch }
    var lastView = null, lastPlan = null, renderedPlan = null, lastDrawAt = 0, lastDrawErr = '', lastTouchAt = 0;
    var selectedContact = null;
    var pan = { x: 0, y: 0 };   // how far the view's centre is from the aircraft, metres east and north (drag empty map to change it)
    var sug = { list: [], selectedId: null, key: '', at: 0, logged: false, tookMs: 0 };

    function log(msg) { PS.log('plan', msg); }
    function ownOrReference() {
      var o = PS.readOwn();
      if (o) return { own: o, live: true };
      var t = PS.state.taxi, p = t && t.parking && t.parking.length ? t.parking[0] : null;
      return { own: { lat: p ? p.lat : 51.47, lon: p ? p.lon : -0.4543, hdgDeg: 90, gsKt: 0, altFt: 0 }, live: false };
    }
    function contactsNow() { return PS.airTraffic.contacts || []; }
    function pxDist(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
    function distToSegment(p, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      var t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return pxDist(p, [a[0] + t * dx, a[1] + t * dy]);
    }

    // draw() never throws: an error is shown under the plot and logged once, and the redraw triggers keep going. The nudge makes the sim's
    // browser put the canvas on screen (it does not repaint a canvas by itself).
    function draw() {
      lastDrawAt = Date.now();
      try { drawPlot(); D.nudge(canvas); }
      catch (e) {
        var err = PS.errText(e);
        infoLine.textContent = 'Plot draw error: ' + err;
        if (err !== lastDrawErr) { lastDrawErr = err; log('plot draw failed: ' + err); }
      }
    }

    // ---------------- pins ----------------
    function setAddMode(on) {
      addMode = on;
      if (addBtn) { addBtn.textContent = 'Add pins: ' + (on ? 'ON (tap the plot)' : 'off'); addBtn.className = 'ps-btn' + (on ? ' ps-warn' : ''); }
      canvas.className = 'ps-canvas' + (on ? ' ps-pinmode' : '');
    }
    function planChanged() { renderedPlan = null; draw(); }
    // Editing the plan by hand takes over from any suggestion that was highlighted.
    function dropSuggestionHighlight() { if (sug.selectedId) { sug.selectedId = null; renderSuggestions(); } }
    function addPin(lat, lon) {
      dropSuggestionHighlight(); showList('pins', 'a pin was added');
      var i = PS.plan.add(lat, lon);
      log('pin ' + (i + 1) + ' added at ' + lat.toFixed(6) + ', ' + lon.toFixed(6));
      snap(i);
      planChanged();
    }
    // New and moved pins take the heading of the taxiway they sit on, until rotated by hand.
    function snap(i) {
      var r = PS.plan.snapPin(i, (PS.readOwn() || { hdgDeg: 0 }).hdgDeg);
      if (r) log('pin ' + (i + 1) + ' aligned with ' + (r.name ? 'taxiway ' + r.name : 'the taxiway') + ' (' + Math.round(r.distM) + ' m away): heading ' + r.headingDeg + '°');
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

    function renderRoute(plan) {
      routeSummary.textContent = plan.empty ? 'No route yet. Tap the plot to drop pins, or pick a suggested push. The last pin is where the aircraft ends up; rotate it with the handle behind it.'
        : 'Route: ' + PS.fmt.dist(plan.totalM) + ' in ' + plan.legs.length + ' leg(s), ' + (plan.warnings.length ? plan.warnings.length + ' WARNING(S): see the Route panel on the Push tab. The tug may not manage it.' : 'no warnings.');
      routeSummary.className = 'ps-note' + (plan.warnings.length ? ' warn' : '');
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

    // ---------------- input ----------------
    // The sim sends mouse events to the canvas (touch is handled too, for other hosts). A tap is placed with offsetX/offsetY where there is
    // one (relative to the canvas itself) and with the canvas rectangle otherwise.
    function pointOf(e) {
      var t = e;
      if (e.changedTouches && e.changedTouches.length) t = e.changedTouches[0]; else if (e.touches && e.touches.length) t = e.touches[0];
      if (t === e && typeof e.offsetX === 'number' && e.target === canvas) {
        return [e.offsetX * canvas.width / (canvas.clientWidth || canvas.width), e.offsetY * canvas.height / (canvas.clientHeight || canvas.height)];
      }
      var r = canvas.getBoundingClientRect();
      return [(t.clientX - r.left) * canvas.width / (r.width || canvas.width), (t.clientY - r.top) * canvas.height / (r.height || canvas.height)];
    }
    function recentTouch() { return Date.now() - lastTouchAt < 800; }   // a browser also sends mouse events after a touch: ignore those

    function inputDown(p, touch) {
      if (!lastView) return;
      var sel = PS.plan.selected();
      if (sel >= 0) {
        var hp = handlePx(sel), sq0 = lastView.toPx(PS.plan.list()[sel].lat, PS.plan.list()[sel].lon);
        // The heading handle, or the stem joining it to the pin (beyond the pin's own marker), takes the press.
        if (hp && (pxDist(hp, p) <= (touch ? HANDLE_HIT_PX + 10 : HANDLE_HIT_PX) || (pxDist(sq0, p) > 26 && distToSegment(p, sq0, hp) <= 14))) {
          drag = { kind: 'handle', idx: sel, sx: p[0], sy: p[1], moved: false, touch: touch }; return;
        }
      }
      var hit = PS.nearestPin(lastView, PS.plan.list(), p[0], p[1], touch ? 30 : 22);
      if (hit >= 0) { PS.plan.select(hit); drag = { kind: 'pin', idx: hit, sx: p[0], sy: p[1], moved: false, touch: touch }; planChanged(); return; }
      drag = { kind: 'none', idx: -1, sx: p[0], sy: p[1], moved: false, touch: touch, panX: pan.x, panY: pan.y, scale: lastView.scale };
    }
    function inputMove(p) {
      if (!drag || !lastView) return;
      var limit = drag.touch ? 14 : 6;
      if (!drag.moved && Math.abs(p[0] - drag.sx) + Math.abs(p[1] - drag.sy) > limit) drag.moved = true;
      if (drag.kind === 'handle') {
        var pins = PS.plan.list(), q = lastView.toPx(pins[drag.idx].lat, pins[drag.idx].lon);
        PS.plan.setHeading(drag.idx, PS.plan.headingFromHandle(q[0], q[1], p[0], p[1]));
        draw();
      } else if (drag.kind === 'none' && drag.moved) {
        // Dragging empty map moves the map with the pointer: the view's centre goes the other way.
        pan.x = drag.panX - (p[0] - drag.sx) / drag.scale;
        pan.y = drag.panY + (p[1] - drag.sy) / drag.scale;
        draw();
      } else if (drag.kind === 'pin' && drag.moved) {
        var ll = lastView.fromPx(p[0], p[1]);
        PS.plan.move(drag.idx, ll[0], ll[1]);
        draw();
      }
    }
    function inputUp(p) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.kind === 'handle') { dropSuggestionHighlight(); showList('pins', 'a pin was rotated'); log('pin ' + (d.idx + 1) + ' rotated to ' + PS.plan.list()[d.idx].headingDeg + '°'); planChanged(); return; }
      if (d.kind === 'pin') { if (d.moved) { dropSuggestionHighlight(); showList('pins', 'a pin was moved'); log('pin ' + (d.idx + 1) + ' moved'); if (PS.plan.list()[d.idx] && (PS.plan.list()[d.idx].snapped || !PS.plan.list()[d.idx].headingUser)) snap(d.idx); planChanged(); } return; }
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
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
      canvas.addEventListener(type, function (e) {
        lastTouchAt = Date.now();
        if (e.preventDefault) e.preventDefault();        // stop the page scrolling under a drag on the plot
        var p = pointOf(e);
        if (type === 'touchstart') inputDown(p, true);
        else if (type === 'touchmove') inputMove(p);
        else if (type === 'touchend') inputUp(p);
        else drag = null;
      }, false);
    });
    canvas.addEventListener('mousedown', function (e) { if (!recentTouch()) inputDown(pointOf(e), false); });
    canvas.addEventListener('mousemove', function (e) { if (!recentTouch()) inputMove(pointOf(e)); });
    canvas.addEventListener('mouseup', function (e) { if (!recentTouch()) inputUp(pointOf(e)); });
    canvas.addEventListener('mouseleave', function () { if (!recentTouch()) drag = null; });

    // ---------------- suggested pushes ----------------
    function renderSuggestions() {
      PS.clear(sugBox);
      var t = PS.state.taxi;
      if (!t) { sugBox.appendChild(ui.note('No airport data loaded yet.')); return; }
      if (!sug.list.length) {
        sugBox.appendChild(ui.note('No suggestions: no named taxiway, link or lane is within reach where the tail points, or the taxi module supplied no paths (' + t.items.length + ' items loaded). You can still drop pins by hand.'));
        return;
      }
      sug.list.forEach(function (s, i) {
        sugBox.appendChild(h('button', { type: 'button', class: 'ps-sug' + (s.id === sug.selectedId ? ' on' : ''), onclick: function () {
          if (s.id === sug.selectedId) { sug.selectedId = null; log('suggestion ' + (i + 1) + ' deselected (its pins stay in the plan; use Clear pins to remove them)'); renderSuggestions(); draw(); return; }
          // Choosing a suggestion makes it the plan: any pins placed by hand that are not part of it are removed.
          var before = PS.plan.count();
          PS.plan.setAll(s.waypoints);
          sug.selectedId = s.id;
          log('suggestion ' + (i + 1) + ' chosen as the plan: ' + s.title + ' (' + Math.round(s.lengthM) + ' m, ' + PS.plan.count() + ' pin(s)); replaced ' + before + ' earlier pin(s)');
          renderSuggestions(); showList('suggested', 'a suggestion was chosen'); planChanged();
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
      if (sug.selectedId) { var still = false; sug.list.forEach(function (s) { if (s.id === sug.selectedId) still = true; }); if (!still) sug.selectedId = null; }
      renderSuggestions();
    }
    function loadAirport(why) {
      airportLoading = true;
      airportLine.textContent = 'Loading airport data' + (why ? ' (' + why + ')' : '') + '...';
      return PS.facility.loadNearestIntoState().then(function (icao) {
        airportLoading = false; sug.key = ''; airportLine.textContent = 'Airport ' + icao + ' loaded: ' + PS.state.taxi.items.length + ' runway/path item(s), ' + PS.state.taxi.parking.length + ' stand(s).';
        renderSuggestions(); draw();
      }, function (e) { airportLoading = false; airportLine.textContent = 'Could not load airport data: ' + PS.errText(e); log('could not load airport data: ' + PS.errText(e)); });
    }

    // ---------------- drawing ----------------
    function drawPlot() {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) { infoLine.textContent = 'Canvas 2D not available.'; return; }
      D.fitCanvas(canvas);
      var c = ownOrReference(), own = c.own;
      var w = canvas.width, hgt = canvas.height, range = plotRange.get();
      var centre = pan.x || pan.y ? PS.geo.fromXY(own.lat, own.lon, pan.x, pan.y) : [own.lat, own.lon];
      var view = PS.plotView(w, hgt, { lat: centre[0], lon: centre[1] }, range);
      lastView = view;
      var ownPx = view.toPx(own.lat, own.lon);
      refreshSuggestions(own);
      if (!PS.plan.count() && sug.selectedId) { sug.selectedId = null; renderSuggestions(); }   // the pins were cleared (a finished push)
      var plan = PS.plan.evaluate(own);
      lastPlan = plan;
      if (plan !== renderedPlan) { renderedPlan = plan; renderRoute(plan); renderPins(plan, own); }

      var taxi = PS.state.taxi;
      var drawn = D.backdrop(g, view, w, hgt, range, ownPx, taxi);

      // Suggested pushes: numbered end markers, and the route and final nose of the chosen one while the plan is empty.
      var chosen = null;
      sug.list.forEach(function (s) { if (s.id === sug.selectedId) chosen = s; });
      g.font = 'bold 11px Arial';
      sug.list.forEach(function (s, i) {
        if (s === chosen) return;
        var e = s.pins[s.pins.length - 1], q = view.toPx(e[0], e[1]);
        g.fillStyle = '#34d2c8'; g.beginPath(); g.arc(q[0], q[1], 7, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#0f171e'; g.fillText(String(i + 1), q[0] - (i > 8 ? 6 : 3), q[1] + 4);
      });
      if (chosen && PS.plan.count() === 0) {
        D.chevrons(g, D.strokePath(g, chosen.route, view, '#34d2c8', 4), '#0f171e');
        var ep = chosen.pins[chosen.pins.length - 1], eq = view.toPx(ep[0], ep[1]);
        D.aircraftMarker(g, eq[0], eq[1], chosen.facingDeg, 'rgba(52,210,200,0.35)', '#34d2c8', 1);
      }

      // The plan, and the ring and heading handle of the selected pin.
      if (!plan.empty) {
        D.planRoute(g, view, plan, { pinCount: PS.plan.count() });
        var sel = PS.plan.selected();
        if (sel >= 0 && PS.plan.list()[sel]) {
          var sp = PS.plan.list()[sel], sq = view.toPx(sp.lat, sp.lon), hp = handlePx(sel);
          g.strokeStyle = '#ffe14d'; g.lineWidth = 3; g.beginPath(); g.arc(sq[0], sq[1], 25, 0, Math.PI * 2); g.stroke();
          if (hp) {
            g.lineWidth = 2; g.beginPath(); g.moveTo(sq[0], sq[1]); g.lineTo(hp[0], hp[1]); g.stroke();
            g.fillStyle = '#ffe14d'; g.beginPath(); g.arc(hp[0], hp[1], 15, 0, Math.PI * 2); g.fill();
            g.strokeStyle = '#0b1116'; g.lineWidth = 2; g.beginPath(); g.arc(hp[0], hp[1], 15, 0, Math.PI * 2); g.stroke();
            g.fillStyle = '#0b1116'; g.font = 'bold 11px Arial'; g.fillText('turn', hp[0] - 12, hp[1] + 4);
          }
          g.lineWidth = 1;
        }
      }

      // AI traffic, read fresh from the sim's listener on every redraw, then the own aircraft.
      PS.airTraffic.poll();
      var contacts = contactsNow(), T = PS.airTraffic;
      var inView = D.contacts(g, view, contacts, w, hgt, selectedContact);
      D.aircraftMarker(g, ownPx[0], ownPx[1], own.hdgDeg, '#4cd18a', '#0b1116', 1.1);

      var age = T.lastAt ? ((Date.now() - T.lastAt) / 1000).toFixed(1) + ' s ago' : 'never';
      infoLine.textContent = (c.live ? 'Own position live. ' : 'Own position: reference point (sim not readable). ') + 'Range ' + PS.fmt.dist(range) +
        (pan.x || pan.y ? '. Map moved ' + PS.fmt.dist(Math.sqrt(pan.x * pan.x + pan.y * pan.y)) + ' from the aircraft (Recentre brings it back)' : '') + '. Taxi items drawn: ' + drawn +
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
    addBtn = ui.button('Add pins: ON (tap the plot)', function () { setAddMode(!addMode); });
    setAddMode(true);

    var sugPanel = ui.panel('Suggested pushes', airportLine, sugBox,
      h('div', { class: 'ps-row' }, ui.button('Reload airport data', function () { loadAirport('asked'); }, 'ps-small ps-ghost')),
      ui.note('From the original app\'s suggester, planned with the same tug turn radius. Only options the tug can make without a warning are offered. Pick one and it becomes your plan; to adjust it, tap the plot to add pins of your own.'));
    var pinPanel = ui.panel('Pins', pinList);
    // Pins and suggestions are two views of the one plan, so only one is shown: placing or editing a pin shows the pins, choosing a suggestion shows the suggestions.
    var listTabs = h('div', { class: 'ps-row' });
    var tabToggle = ui.toggle([{ value: 'suggested', label: 'Suggested pushes' }, { value: 'pins', label: 'Custom pins' }], PS.settings.get('planTab'), function (v) { showList(v, 'tab pressed'); });
    listTabs.appendChild(tabToggle.el);
    function showList(which, why) {
      sugPanel.style.display = which === 'suggested' ? '' : 'none';
      pinPanel.style.display = which === 'pins' ? '' : 'none';
      if (tabToggle.get() !== which) tabToggle.set(which);
      if (why) log('showing ' + (which === 'pins' ? 'the custom pins' : 'the suggested pushes') + ' (' + why + ')');
    }
    showList(PS.settings.get('planTab'), '');

    var el = h('div', { class: 'ps-page' },
      ui.panel('Plan the push',
        h('div', { class: 'ps-row' }, ui.field('Range', plotRange.el), addBtn,
          ui.button('Undo pin', function () { if (PS.plan.count()) deletePin(PS.plan.count() - 1); }, 'ps-ghost'),
          ui.button('Clear pins', function () { PS.plan.clear(); log('pins cleared'); planChanged(); }, 'ps-ghost'),
          ui.button('Recentre', function () { pan.x = 0; pan.y = 0; log('map recentred on the aircraft'); draw(); }, 'ps-ghost')),
        canvas, infoLine, contactLine,
        ui.note('North is up, centred on the aircraft; drag empty map to move it. Each pin is drawn as an aircraft pointing the way the nose will be there. Tap a pin to select it: drag it to move it, drag the yellow handle behind it to rotate it. White route = push back, blue = drive forward, red = the tug may not manage that leg.')),
      routeSummary,
      listTabs,
      sugPanel,
      pinPanel
    );
    // Redraw triggers: the interval, the EFB's per-frame update (a second chance if timers are throttled), and any click on the page.
    el.addEventListener('click', function () { setTimeout(draw, 0); setTimeout(draw, 400); });
    var frameHook = function () { if (Date.now() - lastDrawAt > 450) draw(); };
    return {
      el: el,
      onShow: function () {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(draw, 500);
        if (PS.frameHooks.indexOf(frameHook) < 0) PS.frameHooks.push(frameHook);
        renderedPlan = null; renderSuggestions();
        draw();
        if (!PS.state.taxi && !airportLoading) loadAirport('on opening');
      },
      onHide: function () {
        var fi = PS.frameHooks.indexOf(frameHook); if (fi >= 0) PS.frameHooks.splice(fi, 1);
        if (timer !== null) { clearInterval(timer); timer = null; }
        drag = null;
      }
    };
  }
});
