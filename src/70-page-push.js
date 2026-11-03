// Push tab: call the tug, make sure the parking brake is off, then drive the plan made on the Plan tab and watch it go. The drive itself is
// PS.push (11-push.js); this page shows its state and has the controls. The progress popup (distance left, Pause/Resume) is a toast in the app
// shell, so it shows whichever tab is open.

PS.pages.push({
  id: 'push',
  title: 'Push',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h, D = PS.plotDraw;
    var MAP_STEPS = [50, 100, 200, 300];
    var SPEED_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    var canvas = h('canvas', { class: 'ps-canvas', width: '900', height: '540' });
    var mapRange = ui.stepper(MAP_STEPS, 100, function () { paint(); }, 'push');
    var timer = null, lastPaintAt = 0, lastErr = '';

    var statusBig = h('div', { class: 'ps-big', text: '' });
    var statusSub = h('div', { class: 'ps-kv', text: '' });
    var tugPill = h('span', { class: 'ps-pill bad', text: 'TUG OFF' });
    var brakePill = h('span', { class: 'ps-pill', text: 'BRAKE ?' });
    var planLine = h('div', { class: 'ps-kv', text: '' });
    var whyLine = h('div', { class: 'ps-kv', text: '' });
    var remainBig = h('div', { class: 'ps-big', text: '-' });
    var barFill = h('div', { style: 'width:0%' });
    var bar = h('div', { class: 'ps-bar' }, barFill);
    var legLine = h('div', { class: 'ps-kv', text: '' });
    var motionLine = h('div', { class: 'ps-kv', text: '' });
    var infoLine = h('div', { class: 'ps-kv', text: '' });

    function say(msg) { PS.log('push', msg); }
    var tugBtn = ui.button('Call the tug', function () { PS.push.toggleTug(); paint(); });
    var startBtn = ui.button('Start push', function () { PS.push.requestStart(); paint(); }, 'ps-warn');
    var pauseBtn = ui.button('Pause', function () {
      var s = PS.push.view().status;
      if (s === 'paused' || (s === 'stopping' && PS.push.view().reason === 'paused')) PS.push.resume(); else PS.push.pause();
      paint();
    });
    var stopBtn = ui.button('STOP', function () { PS.push.stop('stopped by you'); paint(); }, 'ps-danger');
    var releaseBtn = ui.button('Release the brake for me', function () { PS.push.releaseBrake(); });
    var setBrakeBtn = ui.button('Set the brake', function () { PS.push.setBrake(); }, 'ps-small');
    var dismissBtn = ui.button('Dismiss the tug', function () { PS.push.dismissTug(); paint(); }, 'ps-small ps-ghost');
    var speed = ui.stepper(SPEED_STEPS, PS.push.view().speedPercent, function (v) { PS.push.setSpeedPercent(v); }, 'push', ['Slower  -', 'Faster  +'], function (v) { return v + '%'; });

    var STATUS_TEXT = {
      idle: 'Tug not on', ready: 'Tug on, ready to push', attaching: 'Calling the tug...', waitBrake: 'Release the parking brake', settling: 'Starting...',
      driving: 'Pushing', stopping: 'Stopping...', paused: 'Paused', brakeHold: 'Held: parking brake set', done: 'Push finished'
    };

    function paintState(v) {
      statusBig.textContent = STATUS_TEXT[v.status] || v.status;
      statusSub.textContent = v.reason || '';
      tugPill.className = 'ps-pill ' + (v.attached ? 'ok' : 'bad'); tugPill.textContent = v.attached ? 'TUG ON' : 'TUG OFF';
      var b = v.brake;
      if (!b || !b.ok) { brakePill.className = 'ps-pill'; brakePill.textContent = 'BRAKE ?'; }
      else { brakePill.className = 'ps-pill ' + (b.set ? 'bad' : 'ok'); brakePill.textContent = b.set ? 'PARKING BRAKE SET' : 'PARKING BRAKE OFF'; }
      var running = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 }[v.status], waiting = v.status === 'waitBrake' || v.status === 'attaching';
      tugBtn.textContent = v.attached ? 'Dismiss the tug' : 'Call the tug';
      tugBtn.disabled = !!running || v.status === 'attaching';
      var c = PS.push.canStart();
      startBtn.disabled = !c.ok;
      pauseBtn.textContent = (v.status === 'paused' || (v.status === 'stopping' && v.reason === 'paused')) ? 'Resume' : 'Pause';
      pauseBtn.disabled = !(v.status === 'driving' || v.status === 'paused' || (v.status === 'stopping' && v.reason === 'paused'));
      stopBtn.disabled = !(running || waiting);
      releaseBtn.style.display = v.attached && v.brake && v.brake.set && !running ? '' : 'none';
      setBrakeBtn.style.display = v.status === 'done' ? '' : 'none';
      dismissBtn.style.display = v.status === 'done' || v.status === 'ready' ? '' : 'none';
      whyLine.textContent = !c.ok && !running && v.status !== 'waitBrake' ? c.why : '';
      var plan = PS.plan.evaluate(PS.readOwn() || { lat: 0, lon: 0, hdgDeg: 0 });
      planLine.textContent = plan.empty ? 'No plan yet: make one on the Plan tab.' : 'Plan: ' + PS.fmt.dist(plan.totalM) + ' in ' + plan.legs.length + ' leg(s)' + (plan.warnings.length ? ', WITH WARNINGS (see the Plan tab): the tug may not manage it' : ', no warnings') + '. Turn radius ' + Math.round(plan.radiusM) + ' m.';
    }

    function paintProgress(v) {
      var active = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, done: 1 }[v.status];
      remainBig.textContent = active ? (v.status === 'done' ? 'Arrived' : PS.fmt.dist(v.remainingM) + ' left') : '-';
      barFill.style.width = Math.round((v.status === 'done' ? 1 : v.progress) * 100) + '%';
      legLine.textContent = active && v.legCount ? 'Leg ' + Math.min(v.leg + 1, v.legCount) + ' of ' + v.legCount + (v.direction ? ': ' + v.direction : '') + (v.phase && v.phase !== 'run' ? ' (' + v.phase + ')' : '') : '';
      var kt = Math.abs(v.speedFtS) * 0.5925;
      motionLine.textContent = active ? 'Speed ' + PS.fmt.num(kt, 1) + ' kt, turning ' + PS.fmt.num(v.yawDegS, 1) + ' deg/s (measured ' + PS.fmt.num(v.measuredYaw, 1) + '), ' + PS.fmt.num(Math.abs(v.cte), 1) + ' m off the path, elapsed ' + PS.fmt.seconds(v.elapsedS) +
        (v.failures ? ', ' + v.failures + ' failed write(s): ' + v.lastError : '') + (v.note ? '. ' + v.note : '') : 'Cruise speed ' + v.speedPercent + '% (speed factor ' + v.cruiseUnits + ').';
    }

    function paintMap(v) {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) return;
      D.fitCanvas(canvas, 120);
      var own = PS.readOwn() || { lat: 0, lon: 0, hdgDeg: 0 }, w = canvas.width, hgt = canvas.height, range = mapRange.get();
      var view = PS.plotView(w, hgt, own, range), cx = view.cx, cy = view.cy;
      var running = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, done: 1 }[v.status];
      var plan = running && v.plan ? v.plan : PS.plan.evaluate(own);
      var drawn = D.backdrop(g, view, w, hgt, range, [cx, cy], PS.state.taxi);
      if (!plan.empty) D.planRoute(g, view, plan, { pinCount: PS.plan.count(), doneLegs: running ? v.leg : 0 });
      PS.airTraffic.poll();
      D.contacts(g, view, PS.airTraffic.contacts || [], w, hgt, null);
      D.aircraftMarker(g, cx, cy, own.hdgDeg, '#4cd18a', '#0b1116', 1.1);
      infoLine.textContent = 'Centred on the aircraft, range ' + PS.fmt.dist(range) + '. White = push back, blue = forward, grey = done.';
    }

    function paint() {
      lastPaintAt = Date.now();
      try {
        var v = PS.push.view();
        paintState(v); paintProgress(v); paintMap(v);
        D.nudge(canvas);
      } catch (e) {
        var m = PS.errText(e);
        if (m !== lastErr) { lastErr = m; say('push page paint failed: ' + m); }
        infoLine.textContent = 'Page error: ' + m;
      }
    }

    var el = h('div', { class: 'ps-page' },
      ui.panel('Push',
        statusBig, statusSub,
        h('div', { class: 'ps-row' }, tugPill, brakePill),
        planLine, whyLine,
        h('div', { class: 'ps-row' }, tugBtn, startBtn, pauseBtn, stopBtn),
        h('div', { class: 'ps-row' }, releaseBtn, setBrakeBtn, dismissBtn),
        h('div', { class: 'ps-row' }, ui.field('Cruise speed (percent of the tug\'s top speed)', speed.el)),
        ui.note('Start does it all in one press: it calls the tug if it is not on, waits for the parking brake to be off (the app can release it for you), then drives the plan. It moves the aircraft, so only use it on the ground with the way clear. The push stops at once if you press STOP, the sim takes the tug away, the brake is set, or this app is paused or closed.', 'warn')),
      ui.panel('Progress', remainBig, bar, legLine, motionLine),
      ui.panel('Map', h('div', { class: 'ps-row' }, ui.field('Range', mapRange.el)), canvas, infoLine),
      ui.panel('Log', ui.logBox(['push', 'tug', 'key', 'set']))
    );
    var frameHook = function () { if (Date.now() - lastPaintAt > 450) paint(); };
    return {
      el: el,
      onShow: function () {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(paint, 250);
        if (PS.frameHooks.indexOf(frameHook) < 0) PS.frameHooks.push(frameHook);
        paint();
      },
      onHide: function () {
        var fi = PS.frameHooks.indexOf(frameHook); if (fi >= 0) PS.frameHooks.splice(fi, 1);
        if (timer !== null) { clearInterval(timer); timer = null; }
      }
    };
  }
});
