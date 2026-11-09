// Plan tab: where the push should go. A north-up plot centred on the aircraft shows runways, taxiways, stands and AI aircraft. Tap to drop
// directional pins (each is drawn as an aircraft pointing the way the nose will be there), drag a pin to move it, drag the handle behind a
// selected pin to rotate it, drag empty map to move the map, or pick a suggested push. The planned route (turn arcs, forward and reverse legs,
// warnings) comes from PS.plan / PS.planner. The plan it leaves is what the Push tab drives.

PS.pages.push({
  id: 'plan',
  title: PS.tt('Plan'),
  create: function (ctx) {
    var ui = PS.ui,
      h = PS.h,
      D = PS.plotDraw;
    var PLOT_STEPS = [100, 200, 300, 500, 1000, 2000, 3000];
    var HANDLE_PX = 58; // how far behind the tail the heading handle sits
    var HANDLE_HIT_PX = 36; // how close a press has to be to the handle (canvas pixels, which are screen pixels: the canvas is not scaled)
    var canvas = h('canvas', { class: 'ps-canvas', width: '900', height: '540' });
    var plotRange = ui.stepper(
      PLOT_STEPS,
      300,
      function () {
        draw();
      },
      'plan',
      null,
      null,
      true
    );
    var infoLine = h('div', { class: 'ps-kv', text: '' });
    var contactLine = h('div', { class: 'ps-kv', text: '' });
    var routeSummary = h('div');
    var pinList = h('div');
    var sugBox = h('div');
    var airportLine = h('div', { class: 'ps-kv', text: '' });
    var timer = null;
    var airportLoading = false;
    var drag = null; // { kind: 'handle' | 'pin' | 'none', idx, sx, sy, moved, touch }
    var lastView = null,
      lastPlan = null,
      renderedPlan = null,
      renderedSig = '',
      lastDrawAt = 0,
      lastDrawErr = '',
      lastTouchAt = 0;
    var selectedContact = null;
    var pan = { x: 0, y: 0 }; // how far the view's centre is from the aircraft, metres east and north (drag empty map to change it)
    var sug = { list: [], selectedId: null, key: '', at: 0, logged: false, tookMs: 0 };

    function log(msg) {
      PS.log('plan', msg);
    }
    function ownOrReference() {
      var o = PS.readOwn();
      if (o) return { own: o, live: true };
      var t = PS.state.taxi,
        p = t && t.parking && t.parking.length ? t.parking[0] : null;
      return { own: { lat: p ? p.lat : 51.47, lon: p ? p.lon : -0.4543, hdgDeg: 90, gsKt: 0, altFt: 0 }, live: false };
    }
    function contactsNow() {
      return PS.airTraffic.contacts || [];
    }
    function pxDist(a, b) {
      var dx = a[0] - b[0],
        dy = a[1] - b[1];
      return Math.sqrt(dx * dx + dy * dy);
    }
    function distToSegment(p, a, b) {
      var dx = b[0] - a[0],
        dy = b[1] - a[1],
        l2 = dx * dx + dy * dy;
      var t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return pxDist(p, [a[0] + t * dx, a[1] + t * dy]);
    }

    // draw() never throws: an error is shown under the plot and logged once, and the redraw triggers keep going. The nudge makes the sim's
    // browser put the canvas on screen (it does not repaint a canvas by itself).
    function draw() {
      lastDrawAt = Date.now();
      try {
        drawPlot();
        D.nudge(canvas);
      } catch (e) {
        var err = PS.errText(e);
        infoLine.textContent = 'Plot draw error: ' + err;
        if (err !== lastDrawErr) {
          lastDrawErr = err;
          log('plot draw failed: ' + err);
        }
      }
    }

    // ---------------- pins ----------------
    // What the route and pin lists show, as one string: the pins, the planner's warnings, the nose at each pin and the length to the nearest 5 m.
    function planSig(plan) {
      return JSON.stringify([
        PS.plan.list().map(function (p) {
          return [p.label, p.headingDeg, p.headingUser, p.snapped, p.snapName];
        }),
        PS.plan.selected(),
        plan.empty,
        plan.warnings,
        Math.round((plan.totalM || 0) / 5),
        (plan.items || []).map(function (it) {
          return Math.round(it.headingDeg);
        })
      ]);
    }
    function planChanged() {
      renderedPlan = null;
      draw();
    }
    // Editing the plan by hand takes over from any suggestion that was highlighted.
    function dropSuggestionHighlight() {
      if (sug.selectedId) {
        sug.selectedId = null;
        renderSuggestions();
      }
    }
    function addPin(lat, lon) {
      if (PS.plan.snapEnabled()) {
        var sn = PS.plan.snapAt(lat, lon, { refDeg: 0 });
        if (sn && sn.point) {
          lat = sn.point[0];
          lon = sn.point[1];
        }
      } // a pin dropped near a taxiway lands on its centreline
      dropSuggestionHighlight();
      showList('pins', 'a pin was added');
      var i = PS.plan.add(lat, lon);
      log('pin ' + (i + 1) + ' added at ' + lat.toFixed(6) + ', ' + lon.toFixed(6));
      snap(i);
      planChanged();
    }
    // New and moved pins take the heading of the taxiway they sit on, until rotated by hand.
    function snap(i) {
      var r = PS.plan.snapPin(i, PS.readOwn() || { hdgDeg: 0 });
      if (!r) {
        var m = PS.plan.snapMiss() || {};
        log(
          'pin ' +
            (i + 1) +
            ' not snapped: ' +
            (m.off
              ? 'snapping is off in Settings'
              : m.noData
                ? 'no airport data loaded'
                : m.nearestM === null || m.nearestM === undefined
                  ? 'no taxiway lines to snap to (' + m.items + ' items, ' + (m.usable || 0) + ' usable)'
                  : 'the nearest taxiway line (' +
                    (m.nearestName || 'unnamed') +
                    ') is ' +
                    Math.round(m.nearestM) +
                    ' m away, over the ' +
                    PS.plan.snapMaxM() +
                    ' m reach')
        );
      }
      if (r)
        log(
          'pin ' +
            (i + 1) +
            ' aligned with ' +
            (r.name ? 'taxiway ' + r.name : 'the taxiway') +
            ' (' +
            Math.round(r.distM) +
            ' m away, taxiway runs ' +
            r.taxiwayDeg +
            ' deg/' +
            ((r.taxiwayDeg + 180) % 360) +
            ' deg): heading ' +
            r.headingDeg +
            ' deg rather than ' +
            r.otherDeg +
            ' deg. ' +
            r.how +
            ' (was pointing ' +
            r.refDeg +
            ' deg). Use Flip if the other way is wanted'
        );
    }
    function deletePin(i) {
      PS.plan.remove(i);
      PS.plan.resnapFrom(i, PS.readOwn() || { hdgDeg: 0 });
      dropSuggestionHighlight();
      log('pin ' + (i + 1) + ' deleted; ' + PS.plan.count() + ' left');
      planChanged();
    }
    function pinHeading(i) {
      if (!lastPlan) return null;
      for (var k = 0; k < lastPlan.items.length; k++) {
        if (lastPlan.items[k].userIndex === i) return lastPlan.items[k].headingDeg;
      }
      return null;
    }
    // Where the heading handle of pin i sits on the canvas: HANDLE_PX behind the tail of the aircraft drawn there.
    function handlePx(i) {
      var pins = PS.plan.list(),
        hd = pinHeading(i);
      if (!lastView || !pins[i] || hd === null || hd === undefined) return null;
      var q = lastView.toPx(pins[i].lat, pins[i].lon),
        a = PS.geo.rad(hd);
      return [q[0] - Math.sin(a) * HANDLE_PX, q[1] + Math.cos(a) * HANDLE_PX];
    }

    // One line on the route, and every warning in full (the Push tab no longer repeats them).
    function renderRoute(plan) {
      PS.clear(routeSummary);
      if (plan.empty) {
        routeSummary.appendChild(ui.note(PS.t('No route yet. Tap the map to drop pins, or pick a suggested push.')));
        return;
      }
      routeSummary.appendChild(
        h('div', {
          class: 'ps-result ' + (plan.warnings.length ? 'bad' : 'ok'),
          text:
            PS.t('Route: {d} in {n} leg|Route: {d} in {n} legs', { d: PS.fmt.dist(plan.totalM), n: plan.legs.length }) +
            (plan.turnaroundAdded ? PS.t(', with a turnaround pin') : '') +
            PS.t(', turn radius {r} m', { r: Math.round(plan.radiusM) }) +
            (plan.warnings.length ? PS.t('. The tug may not manage it:') : PS.t('. No warnings.'))
        })
      );
      plan.warnings.forEach(function (w) {
        routeSummary.appendChild(h('div', { class: 'ps-result bad', text: PS.t(w) }));
      });
    }
    function renderPins(plan, own) {
      PS.clear(pinList);
      var pins = PS.plan.list();
      if (!pins.length) {
        pinList.appendChild(ui.note(PS.t('No pins.')));
        return;
      }
      var legs = PS.routeLegs(own, pins),
        sel = PS.plan.selected();
      pins.forEach(function (p, i) {
        var hd = pinHeading(i),
          auto = !p.headingUser || !!p.snapped;
        pinList.appendChild(
          h(
            'div',
            { class: 'ps-pinrow' + (i === sel ? ' on' : '') },
            h('div', {
              class: 'ps-pindesc',
              text:
                (i === pins.length - 1 ? PS.t('End') : PS.t('Pin {i}', { i: i + 1 })) +
                ': ' +
                PS.t('{d} on a bearing of {b} deg, nose {h}', {
                  d: PS.fmt.dist(legs.legs[i].distM),
                  b: Math.round(legs.legs[i].bearingDeg),
                  h: hd === null ? '?' : Math.round(hd) + ' deg'
                }) +
                (auto ? PS.t(' (auto)') : PS.t(' (set by you)'))
            }),
            h(
              'div',
              { class: 'ps-btnrow ps-pinbtns' },
              ui.radioDot(i === sel, PS.t('Select pin {i}', { i: i + 1 }), function () {
                PS.plan.select(i);
                planChanged();
              }),
              (function () {
                var up = ui.iconButton(
                  'arrowUp',
                  '',
                  function () {
                    if (PS.plan.reorder(i, -1)) {
                      PS.plan.resnapFrom(i - 1, PS.readOwn() || { hdgDeg: 0 });
                      dropSuggestionHighlight();
                      showList('pins', 'pins reordered');
                      log('pin ' + (i + 1) + ' moved earlier, now pin ' + i);
                      planChanged();
                    }
                  },
                  'ps-small ps-ghost'
                );
                var down = ui.iconButton(
                  'arrowDown',
                  '',
                  function () {
                    if (PS.plan.reorder(i, 1)) {
                      PS.plan.resnapFrom(i, PS.readOwn() || { hdgDeg: 0 });
                      dropSuggestionHighlight();
                      showList('pins', 'pins reordered');
                      log('pin ' + (i + 1) + ' moved later, now pin ' + (i + 2));
                      planChanged();
                    }
                  },
                  'ps-small ps-ghost'
                );
                up.title = PS.t('Earlier');
                down.title = PS.t('Later');
                up.disabled = i === 0;
                down.disabled = i === pins.length - 1;
                return h('span', { class: 'ps-pairbtns' }, up, down);
              })(),
              // On for a new pin (and for one snapped to a taxiway: the snap is automatic too). Off once its nose has been set by hand: turning it
              // off keeps the nose where it is, and turning it on again hands the heading back to the planner.
              ui.button(
                PS.t('Auto heading'),
                function () {
                  if (auto) {
                    var cur = pinHeading(i);
                    if (cur === null || cur === undefined) return;
                    PS.plan.setHeading(i, cur);
                    log('pin ' + (i + 1) + ' heading fixed at ' + PS.plan.list()[i].headingDeg + ' deg');
                  } else {
                    PS.plan.resetHeading(i);
                    snap(i);
                    log('pin ' + (i + 1) + ' heading back to auto');
                  }
                  planChanged();
                },
                'ps-small ps-ghost ps-chk' + (auto ? ' on' : '')
              ),
              ui.iconButton(
                'trash',
                PS.t('Delete'),
                function () {
                  deletePin(i);
                },
                'ps-small ps-ghost ps-pindel'
              )
            )
          )
        );
      });
    }

    // ---------------- input ----------------
    // The sim sends mouse events to the canvas (touch is handled too, for other hosts). A tap is placed with offsetX/offsetY where there is
    // one (relative to the canvas itself) and with the canvas rectangle otherwise.
    function pointOf(e) {
      var t = e;
      if (e.changedTouches && e.changedTouches.length) t = e.changedTouches[0];
      else if (e.touches && e.touches.length) t = e.touches[0];
      if (t === e && typeof e.offsetX === 'number' && e.target === canvas) {
        return [
          (e.offsetX * canvas.width) / (canvas.clientWidth || canvas.width),
          (e.offsetY * canvas.height) / (canvas.clientHeight || canvas.height)
        ];
      }
      var r = canvas.getBoundingClientRect();
      return [
        ((t.clientX - r.left) * canvas.width) / (r.width || canvas.width),
        ((t.clientY - r.top) * canvas.height) / (r.height || canvas.height)
      ];
    }
    function recentTouch() {
      return Date.now() - lastTouchAt < 800;
    } // a browser also sends mouse events after a touch: ignore those

    function inputDown(p, touch) {
      if (!lastView) return;
      var sel = PS.plan.selected();
      if (sel >= 0) {
        var hp = handlePx(sel),
          sq0 = lastView.toPx(PS.plan.list()[sel].lat, PS.plan.list()[sel].lon);
        // The heading handle, or the stem joining it to the pin (beyond the pin's own marker), takes the press.
        if (
          hp &&
          (pxDist(hp, p) <= (touch ? HANDLE_HIT_PX + 10 : HANDLE_HIT_PX) || (pxDist(sq0, p) > 26 && distToSegment(p, sq0, hp) <= 14))
        ) {
          drag = { kind: 'handle', idx: sel, sx: p[0], sy: p[1], moved: false, touch: touch };
          return;
        }
      }
      var hit = PS.nearestPin(lastView, PS.plan.list(), p[0], p[1], touch ? 30 : 22);
      if (hit >= 0) {
        PS.plan.select(hit);
        drag = { kind: 'pin', idx: hit, sx: p[0], sy: p[1], moved: false, touch: touch };
        planChanged();
        return;
      }
      drag = { kind: 'none', idx: -1, sx: p[0], sy: p[1], moved: false, touch: touch, panX: pan.x, panY: pan.y, scale: lastView.scale };
    }
    function inputMove(p) {
      if (!drag || !lastView) return;
      var limit = drag.touch ? 14 : 6;
      if (!drag.moved && Math.abs(p[0] - drag.sx) + Math.abs(p[1] - drag.sy) > limit) drag.moved = true;
      if (drag.kind === 'handle') {
        var pins = PS.plan.list(),
          q = lastView.toPx(pins[drag.idx].lat, pins[drag.idx].lon);
        PS.plan.setHeading(drag.idx, PS.plan.headingFromHandle(q[0], q[1], p[0], p[1]));
        draw();
      } else if (drag.kind === 'none' && drag.moved) {
        // Dragging empty map moves the map with the pointer: the view's centre goes the other way.
        pan.x = drag.panX - (p[0] - drag.sx) / drag.scale;
        pan.y = drag.panY + (p[1] - drag.sy) / drag.scale;
        draw();
      } else if (drag.kind === 'pin' && drag.moved) {
        var ll = lastView.fromPx(p[0], p[1]);
        // The taxiway pulls the pin onto its centreline while it is dragged within the snap reach, and holds it there: it has to be dragged
        // 1.5 times the reach away to come free. While held, the pin takes the taxiway's heading too (unless it was rotated by hand).
        if (PS.plan.snapEnabled()) {
          var reach = PS.plan.snapMaxM() * (drag.locked ? 1.5 : 1);
          var sn = PS.plan.snapAt(ll[0], ll[1], { refDeg: 0 }, reach);
          if (sn && sn.point) {
            ll = sn.point;
            if (!drag.locked)
              log(
                'pin ' +
                  (drag.idx + 1) +
                  ' pulled onto ' +
                  (sn.name ? 'taxiway ' + sn.name : 'the taxiway') +
                  ' (' +
                  Math.round(sn.distM) +
                  ' m away); drag more than ' +
                  Math.round(reach * 1.5) +
                  ' m away to free it'
              );
            drag.locked = true;
          } else {
            if (drag.locked) log('pin ' + (drag.idx + 1) + ' pulled free of the taxiway');
            drag.locked = false;
          }
        }
        PS.plan.move(drag.idx, ll[0], ll[1]);
        var dp = PS.plan.list()[drag.idx];
        if (dp && PS.plan.snapEnabled() && (dp.snapped || !dp.headingUser)) PS.plan.snapPin(drag.idx, PS.readOwn() || { hdgDeg: 0 });
        PS.plan.resnapFrom(drag.idx + 1, PS.readOwn() || { hdgDeg: 0 });
        draw();
      }
    }
    function inputUp(p) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.kind === 'handle') {
        dropSuggestionHighlight();
        showList('pins', 'a pin was rotated');
        log('pin ' + (d.idx + 1) + ' rotated to ' + PS.plan.list()[d.idx].headingDeg + ' deg');
        var hs = PS.plan.snapHandle(d.idx);
        if (hs)
          log(
            'pin ' +
              (d.idx + 1) +
              ' nose lined up with ' +
              (hs.name ? 'taxiway ' + hs.name : 'the taxiway') +
              ' (' +
              Math.round(hs.offDeg) +
              ' deg off): heading ' +
              hs.headingDeg +
              ' deg'
          );
        planChanged();
        return;
      }
      if (d.kind === 'pin') {
        if (d.moved) {
          dropSuggestionHighlight();
          showList('pins', 'a pin was moved');
          log('pin ' + (d.idx + 1) + ' moved');
          if (PS.plan.list()[d.idx] && (PS.plan.list()[d.idx].snapped || !PS.plan.list()[d.idx].headingUser)) snap(d.idx);
          planChanged();
        }
        return;
      }
      if (d.moved || !lastView) return;
      // A tap on an AI aircraft reads its details; a tap anywhere else drops a pin.
      var best = null,
        bestD = 14;
      contactsNow().forEach(function (c) {
        var dd = pxDist(lastView.toPx(c.lat, c.lon), p);
        if (dd < bestD) {
          bestD = dd;
          best = c;
        }
      });
      if (best) {
        selectedContact = best.id;
        PS.plan.select(-1);
        planChanged();
        return;
      }
      selectedContact = null;
      var ll = lastView.fromPx(p[0], p[1]);
      addPin(ll[0], ll[1]);
    }
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (type) {
      canvas.addEventListener(
        type,
        function (e) {
          lastTouchAt = Date.now();
          if (e.preventDefault) e.preventDefault(); // stop the page scrolling under a drag on the plot
          var p = pointOf(e);
          if (type === 'touchstart') inputDown(p, true);
          else if (type === 'touchmove') inputMove(p);
          else if (type === 'touchend') inputUp(p);
          else drag = null;
        },
        false
      );
    });
    canvas.addEventListener('mousedown', function (e) {
      if (!recentTouch()) inputDown(pointOf(e), false);
    });
    canvas.addEventListener('mousemove', function (e) {
      if (!recentTouch()) inputMove(pointOf(e));
    });
    canvas.addEventListener('mouseup', function (e) {
      if (!recentTouch()) inputUp(pointOf(e));
    });
    canvas.addEventListener('mouseleave', function (e) {
      if (recentTouch()) return;
      // a pin or handle drag that leaves the canvas ends where it is (with its final snap), a pan just stops
      if (drag && (drag.kind === 'pin' || drag.kind === 'handle')) inputUp(pointOf(e));
      else drag = null;
    });
    // The wheel zooms, keeping the point under the pointer where it is (the view is re-centred by the difference).
    ui.wheelZoom(canvas, function (dir, e) {
      if (!lastView) return;
      var p = pointOf(e),
        before = plotRange.get(),
        under = lastView.fromPx(p[0], p[1]);
      plotRange.zoom(dir, 'mouse wheel');
      if (plotRange.get() === before) return;
      var after = lastView.fromPx(p[0], p[1]); // the plot was redrawn at the new range around the same centre
      var shift = PS.geo.toXY(after[0], after[1], under[0], under[1]);
      pan.x += shift.x;
      pan.y += shift.y;
      draw();
    });

    // ---------------- suggested pushes ----------------
    // The detail's closing ". Tightest arc ..." is added to every suggestion: translated apart, so the patterns need not repeat it.
    function suggestionDetail(d) {
      var at = d.indexOf('. Tightest arc ');
      return at < 0 ? PS.t(d) : PS.t(d.slice(0, at)) + PS.t(d.slice(at));
    }
    function renderSuggestions() {
      PS.clear(sugBox);
      var t = PS.state.taxi;
      if (!t) {
        sugBox.appendChild(ui.note(PS.t('No airport data loaded yet.')));
        return;
      }
      if (!sug.list.length) {
        sugBox.appendChild(
          ui.note(
            PS.t(
              'No suggestions: no named taxiway, link or lane is within reach where the tail points, or the taxi module supplied no paths ({n} items loaded). You can still drop pins by hand.',
              { n: t.items.length }
            )
          )
        );
        return;
      }
      sug.list.forEach(function (s, i) {
        sugBox.appendChild(
          h(
            'button',
            {
              type: 'button',
              class: 'ps-sug' + (s.id === sug.selectedId ? ' on' : ''),
              onclick: function () {
                if (s.id === sug.selectedId) {
                  sug.selectedId = null;
                  log('suggestion ' + (i + 1) + ' deselected (its pins stay in the plan; use Clear pins to remove them)');
                  renderSuggestions();
                  draw();
                  return;
                }
                // Choosing a suggestion makes it the plan: any pins placed by hand that are not part of it are removed.
                var before = PS.plan.count();
                PS.plan.setAll(s.waypoints);
                sug.selectedId = s.id;
                log(
                  'suggestion ' +
                    (i + 1) +
                    ' chosen as the plan: ' +
                    s.title +
                    ' (' +
                    Math.round(s.lengthM) +
                    ' m, ' +
                    PS.plan.count() +
                    ' pin(s)); replaced ' +
                    before +
                    ' earlier pin(s)'
                );
                renderSuggestions();
                showList('suggested', 'a suggestion was chosen');
                planChanged();
              }
            },
            h('div', { class: 'ps-sug-title', text: i + 1 + '. ' + PS.t(s.title) + '  (' + PS.fmt.dist(s.lengthM) + ')' }),
            h('div', { class: 'ps-sug-detail', text: suggestionDetail(s.detail) })
          )
        );
      });
    }
    function refreshSuggestions(own) {
      var now = Date.now(),
        t = PS.state.taxi;
      if (!t || !t.items || !t.items.length) {
        if (sug.list.length || sug.key !== 'none') {
          sug.list = [];
          sug.key = 'none';
          renderSuggestions();
        }
        return;
      }
      var key = [t.icao || '', t.items.length, own.lat.toFixed(5), own.lon.toFixed(5), Math.round(own.hdgDeg)].join('|');
      // Not while the aircraft is moving (a push is under way), and no more often than 10x the time the last run took.
      if (key === sug.key || now - sug.at < Math.max(1500, sug.tookMs * 10)) return;
      if (own.gsKt > 1 && sug.list.length) return;
      sug.key = key;
      sug.at = now;
      var before = sug.list.length;
      try {
        var t0 = Date.now();
        sug.list = PS.suggest.suggest(t.items, own, t.parking);
        sug.tookMs = Date.now() - t0;
        if (!sug.logged || sug.list.length !== before) {
          sug.logged = true;
          log('suggested pushes: ' + sug.list.length + ' option(s) in ' + sug.tookMs + ' ms (heading ' + Math.round(own.hdgDeg) + ')');
        }
        if (sug.list.lastReport && sug.reportKey !== key) {
          sug.reportKey = key;
          var rep = sug.list.lastReport;
          log(
            'suggester found ' +
              rep.found +
              ', offering ' +
              rep.kept.length +
              ' (aircraft ' +
              own.lat.toFixed(5) +
              ', ' +
              own.lon.toFixed(5) +
              ', heading ' +
              Math.round(own.hdgDeg) +
              ')'
          );
          rep.kept.forEach(function (t) {
            log('  offered: ' + t);
          });
          rep.dropped.forEach(function (t) {
            log('  left out: ' + t);
          });
          (rep.diag || []).forEach(function (t) {
            log('  considered: ' + t);
          });
        }
      } catch (e) {
        sug.list = [];
        log('suggestion failed: ' + PS.errText(e));
      }
      if (sug.selectedId) {
        var still = false;
        sug.list.forEach(function (s) {
          if (s.id === sug.selectedId) still = true;
        });
        if (!still) sug.selectedId = null;
      }
      renderSuggestions();
    }
    function loadAirport(why) {
      airportLoading = true;
      airportLine.textContent = why ? PS.t('Loading airport data ({why})...', { why: why }) : PS.t('Loading airport data...');
      return PS.facility.loadNearestIntoState().then(
        function (icao) {
          airportLoading = false;
          sug.key = '';
          airportLine.textContent = '';
          renderSuggestions();
          draw();
        },
        function (e) {
          airportLoading = false;
          airportLine.textContent = PS.t('Could not load airport data: {e}', { e: PS.errText(e) });
          log('could not load airport data: ' + PS.errText(e));
        }
      );
    }

    // ---------------- drawing ----------------
    function drawPlot() {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) {
        infoLine.textContent = PS.t('Canvas 2D not available.');
        return;
      }
      D.fitCanvas(canvas);
      var c = ownOrReference(),
        own = c.own;
      var w = canvas.width,
        hgt = canvas.height,
        range = plotRange.get();
      var centre = pan.x || pan.y ? PS.geo.fromXY(own.lat, own.lon, pan.x, pan.y) : [own.lat, own.lon];
      var view = PS.plotView(w, hgt, { lat: centre[0], lon: centre[1] }, range);
      lastView = view;
      var ownPx = view.toPx(own.lat, own.lon);
      if (c.live && !PS.push.isActive() && PS.plan.dropFarPins(own)) {
        sug.selectedId = null;
        renderedPlan = null; // the lists are rebuilt below
      }
      refreshSuggestions(own);
      if (!PS.plan.count() && sug.selectedId) {
        sug.selectedId = null;
        renderSuggestions();
      } // the pins were cleared (a finished push)
      var plan = PS.plan.evaluate(own);
      lastPlan = plan;
      if (plan !== renderedPlan) {
        // While the aircraft moves a new plan object comes every tick, and rebuilding the lists under the finger loses a tap that straddles it:
        // rebuild only when the lists would read differently (an edit made here always rebuilds: planChanged clears renderedPlan).
        var forced = renderedPlan === null,
          sig = planSig(plan);
        renderedPlan = plan;
        if (forced || sig !== renderedSig) {
          renderedSig = sig;
          renderRoute(plan);
          renderPins(plan, own);
        }
      }

      var taxi = PS.state.taxi;
      var drawn = D.backdrop(g, view, w, hgt, range, ownPx, taxi);

      // Suggested pushes: numbered end markers, and the route and final nose of the chosen one while the plan is empty.
      var chosen = null;
      sug.list.forEach(function (s) {
        if (s.id === sug.selectedId) chosen = s;
      });
      g.font = 'bold 11px Arial';
      sug.list.forEach(function (s, i) {
        if (s === chosen) return;
        var e = s.pins[s.pins.length - 1],
          q = view.toPx(e[0], e[1]);
        g.fillStyle = PS.theme.c('accent2');
        g.beginPath();
        g.arc(q[0], q[1], 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = PS.theme.c('outline');
        g.fillText(String(i + 1), q[0] - (i > 8 ? 6 : 3), q[1] + 4);
      });
      if (chosen && PS.plan.count() === 0) {
        D.chevrons(g, D.strokePath(g, chosen.route, view, PS.theme.c('accent2'), 4), PS.theme.c('outline'));
        var ep = chosen.pins[chosen.pins.length - 1],
          eq = view.toPx(ep[0], ep[1]);
        D.aircraftMarker(
          g,
          eq[0],
          eq[1],
          chosen.facingDeg,
          PS.theme.mix(PS.theme.c('mapBg'), PS.theme.c('accent2'), 0.4),
          PS.theme.c('accent2'),
          1
        );
      }

      // The plan, and the ring and heading handle of the selected pin.
      if (!plan.empty) {
        D.planRoute(g, view, plan, { pinCount: PS.plan.count() });
        var sel = PS.plan.selected();
        if (sel >= 0 && PS.plan.list()[sel]) {
          var sp = PS.plan.list()[sel],
            sq = view.toPx(sp.lat, sp.lon),
            hp = handlePx(sel);
          g.strokeStyle = PS.theme.c('handle');
          g.lineWidth = 3;
          g.beginPath();
          g.arc(sq[0], sq[1], 25, 0, Math.PI * 2);
          g.stroke();
          if (hp) {
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(sq[0], sq[1]);
            g.lineTo(hp[0], hp[1]);
            g.stroke();
            g.fillStyle = PS.theme.c('handle');
            g.beginPath();
            g.arc(hp[0], hp[1], 15, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = PS.theme.c('outline');
            g.lineWidth = 2;
            g.beginPath();
            g.arc(hp[0], hp[1], 15, 0, Math.PI * 2);
            g.stroke();
            g.fillStyle = PS.theme.c('outline');
            g.font = 'bold 11px Arial';
            g.fillText('turn', hp[0] - 12, hp[1] + 4);
          }
          g.lineWidth = 1;
        }
      }

      // AI traffic, read fresh from the sim's listener on every redraw, then the own aircraft.
      PS.airTraffic.poll();
      var contacts = contactsNow(),
        T = PS.airTraffic;
      var inView = D.contacts(g, view, contacts, w, hgt, selectedContact);
      D.aircraftMarker(g, ownPx[0], ownPx[1], own.hdgDeg, PS.theme.c('aircraft'), PS.theme.c('outline'), 1.1);

      var age = T.lastAt ? ((Date.now() - T.lastAt) / 1000).toFixed(1) + ' s ago' : 'never';
      // (the map's range, item and traffic counts used to be written here; they are in the log when something is wrong)
      var sc = null;
      for (var k = 0; k < contacts.length; k++) {
        if (contacts[k].id === selectedContact) sc = contacts[k];
      }
      if (sc) {
        var a = PS.traffic.analyse(own, sc);
        contactLine.textContent =
          (sc.title || sc.id) +
          ': ' +
          PS.fmt.dist(a.distM) +
          ' away on a bearing of ' +
          Math.round(a.bearingDeg) +
          ' deg, ' +
          PS.fmt.num(sc.gsKt, 0) +
          ' kt, heading ' +
          Math.round(sc.hdgDeg || 0) +
          ' deg, closing ' +
          PS.fmt.num(a.closingKt, 1) +
          ' kt';
      } else {
        contactLine.textContent = '';
      }
    }

    // ---------------- page ----------------

    var sugPanel = ui.panel(
      PS.t('Suggested pushes'),
      airportLine,
      sugBox,
      h(
        'div',
        { class: 'ps-row' },
        ui.iconButton(
          'swap',
          PS.t('Reload airport data'),
          function () {
            loadAirport('asked');
          },
          'ps-small ps-ghost'
        )
      ),
      null
    );
    var pinPanel = ui.panel(PS.t('Pins'), pinList);
    // Pins and suggestions are two views of the one plan, so only one is shown: placing or editing a pin shows the pins, choosing a suggestion shows the suggestions.
    var listTabs = h('div', { class: 'ps-row' });
    var tabToggle = ui.toggle(
      [
        { value: 'suggested', label: PS.t('Suggested pushes') },
        { value: 'pins', label: PS.t('Custom pins') }
      ],
      PS.settings.get('planTab'),
      function (v) {
        showList(v, 'tab pressed');
      }
    );
    listTabs.appendChild(tabToggle.el);
    function showList(which, why) {
      sugPanel.style.display = which === 'suggested' ? '' : 'none';
      pinPanel.style.display = which === 'pins' ? '' : 'none';
      if (tabToggle.get() !== which) tabToggle.set(which);
      if (why) log('showing ' + (which === 'pins' ? 'the custom pins' : 'the suggested pushes') + ' (' + why + ')');
    }
    showList(PS.settings.get('planTab'), '');

    var help = ui.help(PS.t('Planning a push'), [
      PS.t(
        'North is up, centred on the aircraft. Tap the map to drop a pin; the last pin is where the aircraft ends up. Drag empty map to move it.'
      ),
      PS.t(
        'Each pin is drawn as an aircraft pointing the way the nose will be there. Tap a pin to select it: drag it to move it, drag the yellow handle behind it to rotate it.'
      ),
      PS.t(
        'Near a taxiway a pin is pulled onto its centreline and takes its heading (Settings: snap). Drag it further than 1.5 times the snap reach to pull it free.'
      ),
      PS.t('White route = push back, blue = drive forward, red = the tug may not manage that leg.'),
      PS.t(
        "Suggested pushes come from the original app's suggester. Pick one and it becomes your plan; adding a pin of your own takes over from it."
      )
    ]);
    var el = h(
      'div',
      { class: 'ps-page ps-plan' },
      h(
        'div',
        { class: 'ps-cols' },
        h(
          'div',
          { class: 'ps-col-main' },
          ui.panel(
            PS.t('Plan the push'),
            h(
              'div',
              { class: 'ps-toprow' },
              ui.iconButton(
                'undo',
                PS.t('Undo pin'),
                function () {
                  if (PS.plan.count()) deletePin(PS.plan.count() - 1);
                },
                'ps-ghost'
              ),
              ui.iconButton(
                'trash',
                PS.t('Clear pins'),
                function () {
                  PS.plan.clear();
                  log('pins cleared');
                  planChanged();
                },
                'ps-ghost'
              ),
              h('div', { class: 'ps-spacer' }),
              h(
                'div',
                { class: 'ps-right' },
                plotRange.el,
                ui.iconButton(
                  'target',
                  PS.t('Recentre'),
                  function () {
                    pan.x = 0;
                    pan.y = 0;
                    log('map recentred on the aircraft');
                    draw();
                  },
                  'ps-ghost'
                ),
                help
              )
            ),
            canvas,
            contactLine
          )
        ),
        h('div', { class: 'ps-col-side' }, routeSummary, listTabs, sugPanel, pinPanel)
      )
    );
    // Redraw triggers: the interval, the EFB's per-frame update (a second chance if timers are throttled), and any click on the page.
    el.addEventListener('click', function () {
      setTimeout(draw, 0);
      setTimeout(draw, 400);
    });
    var frameHook = function () {
      if (Date.now() - lastDrawAt > 450) draw();
    };
    return {
      el: el,
      onShow: function () {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(draw, 500);
        if (PS.frameHooks.indexOf(frameHook) < 0) PS.frameHooks.push(frameHook);
        renderedPlan = null;
        renderSuggestions();
        draw();
        if (!PS.state.taxi && !airportLoading) loadAirport('on opening');
      },
      onHide: function () {
        var fi = PS.frameHooks.indexOf(frameHook);
        if (fi >= 0) PS.frameHooks.splice(fi, 1);
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        drag = null;
      }
    };
  }
});
