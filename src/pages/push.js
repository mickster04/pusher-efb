// Push tab: start the push (it calls the tug and releases the parking brake itself if they are not ready), watch it go, then Finish (parking brake on,
// tug dismissed) or Return to gate. The drive itself is PS.push (11-push.js); this page shows its state and has the controls. The progress popup
// (distance left, Pause/Resume) is a toast shown when this app is not on screen. Every button is always shown: disabled when it cannot be used now.

PS.pages.push({
  id: 'push',
  title: PS.tt('Push'),
  create: function (ctx) {
    var ui = PS.ui,
      h = PS.h,
      D = PS.plotDraw;
    var MAP_STEPS = [50, 100, 200, 300];
    var canvas = h('canvas', { class: 'ps-canvas', width: '900', height: '540' });
    var mapRange = ui.stepper(
      MAP_STEPS,
      100,
      function () {
        paint();
      },
      'push',
      null,
      null,
      true
    );
    var timer = null,
      lastPaintAt = 0,
      lastErr = '';
    ui.wheelZoom(canvas, function (dir) {
      mapRange.zoom(dir, 'mouse wheel');
    });

    var statusBig = h('div', { class: 'ps-big', text: '' });
    var statusSub = h('div', { class: 'ps-kv', text: '' });
    var tugPill = h('span', { class: 'ps-pill bad', text: PS.t('TUG OFF') });
    var brakePill = h('span', { class: 'ps-pill', text: PS.t('BRAKE ?') });
    var beaconPill = h('span', { class: 'ps-pill', text: PS.t('BEACON ?') });
    var gatePill = h('span', { class: 'ps-pill', text: PS.t('GATE ?') });
    var engineLine = h('div', { class: 'ps-kv', text: '' });
    var whyLine = h('div', { class: 'ps-kv', text: '' });
    var remainBig = h('div', { class: 'ps-big', text: '-' });
    var barFill = h('div', { style: 'width:0%' });
    var bar = h('div', { class: 'ps-bar' }, barFill);
    var legLine = h('div', { class: 'ps-kv', text: '' });
    var motionLine = h('div', { class: 'ps-kv', text: '' });

    function say(msg) {
      PS.log('push', msg);
    }
    // The main button is the next step: call the tug, release the brake, beacon light on (each read from the sim, so one done by hand or in the cockpit
    // moves it on); with all done the push starts by itself. After a push it is Finish push. The smaller Start push below does every step in one go.
    var stepBtn = ui.iconButton(
      'tug',
      PS.t('Call the tug'),
      function () {
        PS.push.doNextStep();
        paint();
      },
      'ps-warn'
    );
    var autoBtn = ui.iconButton(
      'play',
      PS.t('Start push'),
      function () {
        PS.push.requestStart();
        paint();
      },
      'ps-small ps-ghost'
    );
    var returnBtn = ui.iconButton(
      'home',
      PS.t('Return to gate'),
      function () {
        PS.push.requestStart({ returnToGate: true });
        paint();
      },
      'ps-warn'
    );
    var pauseBtn = ui.iconButton('pause', PS.t('Pause'), function () {
      var s = PS.push.view().status;
      if (s === 'paused' || (s === 'stopping' && PS.push.view().reason === 'paused')) PS.push.resume();
      else PS.push.pause();
      paint();
    });
    var stopBtn = ui.iconButton(
      'stop',
      PS.t('Stop').toUpperCase(),
      function () {
        PS.push.stop('stopped by you');
        paint();
      },
      'ps-danger'
    );
    // Only to take the tug away again without a push (Finish push does it after one)
    var tugBtn = ui.iconButton(
      'tug',
      PS.t('Dismiss the tug'),
      function () {
        PS.push.toggleTug();
        paint();
      },
      'ps-small ps-ghost'
    );
    // Ground services (key events: the sim does not say whether they happened)
    var serviceBtns = {};
    PS.services.LIST.forEach(function (sv) {
      serviceBtns[sv.id] = ui.iconButton(
        sv.icon,
        PS.t(sv.label),
        function () {
          PS.services.request(sv.id);
          paint();
        },
        'ps-small ps-ghost'
      );
    });

    var STATUS_TEXT = {
      idle: PS.t('Tug not on'),
      ready: PS.t('Tug on, ready to push'),
      waitBeacon: PS.t('Waiting for the beacon: turn it on'),
      reattach: PS.t('Calling the tug again...'),
      attaching: PS.t('Calling the tug...'),
      waitBrake: PS.t('Releasing the parking brake'),
      settling: PS.t('Starting...'),
      driving: PS.t('Pushing'),
      stopping: PS.t('Stopping...'),
      paused: PS.t('Paused'),
      brakeHold: PS.t('Held: parking brake set'),
      done: PS.t('Push finished')
    };
    var RUNNING = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, reattach: 1 };

    function paintState(v) {
      statusBig.textContent = STATUS_TEXT[v.status] || v.status;
      statusSub.textContent = v.reason ? PS.t(v.reason) : '';
      tugPill.className = 'ps-pill ' + (v.attached ? 'ok' : 'bad');
      tugPill.textContent = v.attached ? PS.t('TUG ON') : PS.t('TUG OFF');
      var b = v.brake,
        brakeKnown = !!(b && b.ok);
      if (!brakeKnown) {
        brakePill.className = 'ps-pill';
        brakePill.textContent = PS.t('BRAKE ?');
      } else {
        brakePill.className = 'ps-pill ' + (b.set ? 'bad' : 'ok');
        brakePill.textContent = b.set ? PS.t('PARKING BRAKE SET') : PS.t('PARKING BRAKE OFF');
      }
      beaconPill.style.display = v.beacon && v.beacon.hidden ? 'none' : '';
      if (!v.beacon || !v.beacon.ok) {
        beaconPill.className = 'ps-pill';
        beaconPill.textContent = PS.t('BEACON ?');
      } else {
        beaconPill.className = 'ps-pill ' + (v.beacon.on ? 'ok' : 'bad');
        beaconPill.textContent = v.beacon.on ? PS.t('BEACON ON') : PS.t('BEACON OFF');
      }
      if (!v.gate || !v.gate.known) {
        gatePill.className = 'ps-pill';
        gatePill.textContent = PS.t('GATE ?');
        gatePill.title = PS.t('No stand data for this airport yet');
      } else if (v.gate.at) {
        gatePill.className = 'ps-pill ok';
        gatePill.textContent = PS.t('AT GATE {name}', { name: v.gate.name });
        gatePill.title = PS.gate.describe(v.gate);
      } else {
        gatePill.className = 'ps-pill';
        gatePill.textContent = PS.t('NOT AT A GATE');
        gatePill.title = PS.gate.describe(v.gate);
      }
      var eng = v.engines;
      engineLine.textContent =
        eng && eng.known
          ? PS.t(eng.textKey, eng.textParams) + (eng.n > 1 ? PS.t(' ({r} of {n} running)', { r: eng.running, n: eng.n }) : '')
          : '';
      engineLine.style.color = eng && eng.known && eng.ok ? PS.theme.c('good') : '';
      var running = !!RUNNING[v.status],
        waiting = v.status === 'waitBrake' || v.status === 'attaching' || v.status === 'waitBeacon' || v.status === 'reattach';
      var paused = v.status === 'paused' || (v.status === 'stopping' && v.reason === 'paused');
      var c = PS.push.canStart();
      var step = v.step;
      var finishMode = step === 'finish';
      var STEP = {
        tug: ['tug', PS.t('Call the tug'), true, ''],
        tugWait: ['tug', PS.t('Calling the tug...'), false, PS.t('The tug is being called: wait for it.')],
        brake: ['brake', PS.t('Release the brake'), true, ''],
        brakeBusy: ['brake', PS.t('Releasing the parking brake'), false, PS.t('The brake is being released: wait for it.')],
        beacon: ['beacon', PS.t('Beacon light on'), true, ''],
        beaconBusy: ['beacon', PS.t('Turning the beacon on...'), false, PS.t('The beacon is being turned on: wait for it.')],
        go: ['play', PS.t('Starting...'), false, PS.t(c.why)],
        noPlan: ['pin', PS.t('Plan the push first'), false, PS.t('There is no plan yet: make one on the Plan tab.')],
        running: ['play', STATUS_TEXT[v.status] || v.status, false, PS.t('A push is under way: stop it first.')],
        finish: ['flag', PS.t('Finish push'), v.canFinish, PS.t(v.finishWhy)]
      }[step] || ['play', PS.t('Start push'), false, ''];
      stepBtn.setIcon(STEP[0]);
      stepBtn.setLabel(STEP[1]);
      ui.setEnabled(stepBtn, STEP[2], STEP[3]);
      ui.setEnabled(
        autoBtn,
        c.ok && !running && !waiting && step !== 'finish',
        running || waiting ? PS.t('A push is already under way.') : PS.t(c.why)
      );
      autoBtn.style.display = finishMode ? 'none' : '';
      ui.setEnabled(returnBtn, v.canReturn.ok, PS.t(v.canReturn.why));
      pauseBtn.setLabel(paused ? PS.t('Resume') : PS.t('Pause'));
      pauseBtn.setIcon(paused ? 'play' : 'pause');
      ui.setEnabled(pauseBtn, v.status === 'driving' || paused, PS.t('Pause is available while the tug is driving.'));
      ui.setEnabled(stopBtn, running || waiting || v.attached, PS.t('Nothing is running to stop.')); // (with the tug on there is always something to stop)
      var holdTug = v.attached && !v.engineGate.ok;
      tugBtn.style.display = v.attached && !running && !waiting ? '' : 'none';
      ui.setEnabled(tugBtn, !holdTug, PS.t(v.engineGate.why));
      var svc = PS.services.can();
      PS.services.LIST.forEach(function (sv) {
        var b = serviceBtns[sv.id];
        ui.setEnabled(b, svc.ok, PS.t(svc.why));
        b.className = 'ps-btn ps-iconbtn ps-small ps-ghost' + (PS.services.recently(sv.id) ? ' ps-requested' : '');
      });
      whyLine.textContent =
        v.attached && !v.engineGate.ok && !running
          ? PS.t(v.engineGate.why)
          : v.canReturn.ok && !running
            ? PS.t('Return to gate retraces the push back to where it started ({d}).', { d: PS.fmt.dist(v.returnM) })
            : step !== 'finish' && !c.ok && !running && !waiting
              ? PS.t(c.why)
              : '';
    }

    function paintProgress(v) {
      var active = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, done: 1 }[v.status];
      remainBig.textContent = active ? (v.status === 'done' ? PS.t('Arrived') : PS.t('{d} left', { d: PS.fmt.dist(v.remainingM) })) : '-';
      barFill.style.width = Math.round((v.status === 'done' ? 1 : v.progress) * 100) + '%';
      legLine.textContent =
        active && v.legCount
          ? PS.t('Leg {i} of {n}', { i: Math.min(v.leg + 1, v.legCount), n: v.legCount }) +
            (v.direction ? ': ' + PS.t(v.direction) : '') +
            (v.phase && v.phase !== 'run' ? ' (' + v.phase + ')' : '')
          : '';
      var kt = Math.abs(v.speedFtS) * 0.5925;
      motionLine.textContent = active
        ? PS.fmt.num(kt, 1) +
          ' kt' +
          (v.why ? ': ' + PS.t(v.why) : '') +
          (v.failures ? '. ' + v.failures + ' failed write(s): ' + v.lastError : '') +
          (v.note ? '. ' + PS.t(v.note) : '')
        : '';
    }

    function paintMap(v) {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) return;
      D.fitCanvas(canvas, 120);
      var ownRead = PS.readOwn(),
        own = ownRead || { lat: 0, lon: 0, hdgDeg: 0 }, // (no reading: nothing is planned from here, a route from 0,0 would be nonsense)
        w = canvas.width,
        hgt = canvas.height,
        range = mapRange.get();
      var view = PS.plotView(w, hgt, own, range),
        cx = view.cx,
        cy = view.cy;
      if (ownRead && !PS.push.isActive()) PS.plan.dropFarPins(ownRead);
      var running = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, done: 1 }[v.status];
      // While pushing, the route drawn is the one the push is driving (not re-planned as the aircraft moves, so no warnings come and go).
      var plan = running && v.plan ? v.plan : ownRead ? PS.plan.evaluate(own) : { empty: true };
      D.backdrop(g, view, w, hgt, range, [cx, cy], PS.state.taxi);
      if (!plan.empty) D.planRoute(g, view, plan, { pinCount: PS.plan.count(), doneLegs: running ? v.leg : 0 });
      PS.airTraffic.poll();
      D.contacts(g, view, PS.airTraffic.contacts || [], w, hgt, null);
      D.aircraftMarker(g, cx, cy, own.hdgDeg, PS.theme.c('aircraft'), PS.theme.c('outline'), 1.1);
    }

    function paint() {
      lastPaintAt = Date.now();
      try {
        PS.push.watchSteps();
        var v = PS.push.view();
        paintState(v);
        paintProgress(v);
        paintMap(v);
        D.nudge(canvas);
      } catch (e) {
        var m = PS.errText(e);
        if (m !== lastErr) {
          lastErr = m;
          say('push page paint failed: ' + m);
        }
      }
    }

    var help = ui.help(PS.t('Pushing'), [
      PS.t(
        'The big button is the next step: Call the tug, then Release the brake, then Beacon light on. Do any of them yourself (in the cockpit, or in the sim) and it moves on to the next. When the last one is done and there is a plan, the push starts by itself.'
      ),
      PS.t(
        'Start push, the smaller button, does every step for you in one press, then drives the plan made on the Plan tab.'
      ),
      PS.t(
        'When the push is done the big button becomes Finish push: it sets the parking brake if it is not set and dismisses the tug if it is on. Return to gate retraces the push (or as far as it got) back to where it started.'
      ),
      PS.t(
        'It moves the aircraft, so only use it on the ground with the way clear. The push stops at once if you press STOP, the sim takes the tug away, the brake is set, or this app is closed. The tug picks its own speed along the route, up to the maximum in Settings: slower for curves and near the end.'
      ),
      PS.t('On the map: white = push back, blue = drive forward, grey = done.')
    ]);

    var el = h(
      'div',
      { class: 'ps-page ps-pushpage' },
      h(
        'div',
        { class: 'ps-cols' },
        h(
          'div',
          { class: 'ps-col-side' },
          ui.panel(
            PS.t('Push'),
            h('div', { class: 'ps-toprow' }, statusBig, h('div', { class: 'ps-spacer' }), h('div', { class: 'ps-right' }, help)),
            statusSub,
            h('div', { class: 'ps-row' }, tugPill, brakePill, beaconPill, gatePill),
            engineLine,
            whyLine,
            h('div', { class: 'ps-btnrow' }, stepBtn, returnBtn, pauseBtn, stopBtn),
            h('div', { class: 'ps-btnrow' }, autoBtn, tugBtn),
            h(
              'div',
              { class: 'ps-btnrow' },
              PS.services.LIST.map(function (sv) {
                return serviceBtns[sv.id];
              })
            )
          ),
          ui.panel(PS.t('Progress'), remainBig, bar, legLine, motionLine)
        ),
        h(
          'div',
          { class: 'ps-col-main ps-col-first' },
          ui.panel(
            PS.t('Map'),
            h('div', { class: 'ps-toprow' }, h('div', { class: 'ps-spacer' }), h('div', { class: 'ps-right' }, mapRange.el)),
            canvas
          )
        )
      )
    );
    var frameHook = function () {
      if (Date.now() - lastPaintAt > 450) paint();
    };
    return {
      el: el,
      onShow: function () {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(paint, 250);
        if (PS.frameHooks.indexOf(frameHook) < 0) PS.frameHooks.push(frameHook);
        paint();
      },
      onHide: function () {
        var fi = PS.frameHooks.indexOf(frameHook);
        if (fi >= 0) PS.frameHooks.splice(fi, 1);
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      }
    };
  }
});
