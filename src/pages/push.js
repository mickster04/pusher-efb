// Push tab: start the push (it calls the tug and releases the parking brake itself if they are not ready), watch it go, then Finish (parking brake on,
// tug dismissed) or Return to gate. The drive itself is PS.push (11-push.js); this page shows its state and has the controls. The progress popup
// (distance left, Pause/Resume) is a toast shown when this app is not on screen. Every button is always shown: disabled when it cannot be used now.

PS.pages.push({
  id: 'push',
  title: 'Push',
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
    var tugPill = h('span', { class: 'ps-pill bad', text: 'TUG OFF' });
    var brakePill = h('span', { class: 'ps-pill', text: 'BRAKE ?' });
    var gatePill = h('span', { class: 'ps-pill', text: 'GATE ?' });
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
    // One main button: Start push, which becomes Finish push once the push is done (they never apply together).
    var finishMode = false;
    var startBtn = ui.iconButton(
      'play',
      'Start push',
      function () {
        if (finishMode) PS.push.finish();
        else PS.push.requestStart();
        paint();
      },
      'ps-warn'
    );
    var returnBtn = ui.iconButton(
      'home',
      'Return to gate',
      function () {
        PS.push.requestStart({ returnToGate: true });
        paint();
      },
      'ps-warn'
    );
    var pauseBtn = ui.iconButton('pause', 'Pause', function () {
      var s = PS.push.view().status;
      if (s === 'paused' || (s === 'stopping' && PS.push.view().reason === 'paused')) PS.push.resume();
      else PS.push.pause();
      paint();
    });
    var stopBtn = ui.iconButton(
      'stop',
      'STOP',
      function () {
        PS.push.stop('stopped by you');
        paint();
      },
      'ps-danger'
    );
    // The lesser options, on their own row: the tug and the parking brake by hand.
    var tugBtn = ui.iconButton(
      'tug',
      'Call the tug',
      function () {
        PS.push.toggleTug();
        paint();
      },
      'ps-small ps-ghost'
    );
    var brakeBtn = ui.iconButton(
      'brake',
      'Set the brake',
      function () {
        PS.push.toggleBrake();
        paint();
      },
      'ps-small ps-ghost'
    );
    // Ground services (key events: the sim does not say whether they happened)
    var serviceBtns = {};
    PS.services.LIST.forEach(function (sv) {
      serviceBtns[sv.id] = ui.iconButton(
        sv.icon,
        sv.label,
        function () {
          PS.services.request(sv.id);
          paint();
        },
        'ps-small ps-ghost'
      );
    });

    var STATUS_TEXT = {
      idle: 'Tug not on',
      ready: 'Tug on, ready to push',
      attaching: 'Calling the tug...',
      waitBrake: 'Releasing the parking brake',
      settling: 'Starting...',
      driving: 'Pushing',
      stopping: 'Stopping...',
      paused: 'Paused',
      brakeHold: 'Held: parking brake set',
      done: 'Push finished'
    };
    var RUNNING = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 };

    function paintState(v) {
      statusBig.textContent = STATUS_TEXT[v.status] || v.status;
      statusSub.textContent = v.reason || '';
      tugPill.className = 'ps-pill ' + (v.attached ? 'ok' : 'bad');
      tugPill.textContent = v.attached ? 'TUG ON' : 'TUG OFF';
      var b = v.brake,
        brakeKnown = !!(b && b.ok);
      if (!brakeKnown) {
        brakePill.className = 'ps-pill';
        brakePill.textContent = 'BRAKE ?';
      } else {
        brakePill.className = 'ps-pill ' + (b.set ? 'bad' : 'ok');
        brakePill.textContent = b.set ? 'PARKING BRAKE SET' : 'PARKING BRAKE OFF';
      }
      if (!v.gate || !v.gate.known) {
        gatePill.className = 'ps-pill';
        gatePill.textContent = 'GATE ?';
        gatePill.title = 'No stand data for this airport yet';
      } else if (v.gate.at) {
        gatePill.className = 'ps-pill ok';
        gatePill.textContent = 'AT GATE ' + v.gate.name;
        gatePill.title = PS.gate.describe(v.gate);
      } else {
        gatePill.className = 'ps-pill';
        gatePill.textContent = 'NOT AT A GATE';
        gatePill.title = PS.gate.describe(v.gate);
      }
      var eng = v.engines;
      engineLine.textContent = eng && eng.known ? eng.text + (eng.n > 1 ? ' (' + eng.running + ' of ' + eng.n + ' running)' : '') : '';
      engineLine.style.color = eng && eng.known && eng.ok ? PS.theme.c('good') : '';
      var running = !!RUNNING[v.status],
        waiting = v.status === 'waitBrake' || v.status === 'attaching';
      var paused = v.status === 'paused' || (v.status === 'stopping' && v.reason === 'paused');
      var c = PS.push.canStart();
      finishMode = PS.push.finishMode(v.status, PS.plan.count());
      startBtn.setLabel(finishMode ? 'Finish push' : 'Start push');
      startBtn.setIcon(finishMode ? 'flag' : 'play');
      startBtn.disabled = finishMode ? !v.canFinish : !c.ok;
      returnBtn.disabled = !v.canReturn.ok;
      returnBtn.title = v.canReturn.ok ? '' : v.canReturn.why;
      pauseBtn.setLabel(paused ? 'Resume' : 'Pause');
      pauseBtn.setIcon(paused ? 'play' : 'pause');
      pauseBtn.disabled = !(v.status === 'driving' || paused);
      stopBtn.disabled = !(running || waiting);
      tugBtn.setLabel(v.attached ? 'Dismiss the tug' : 'Call the tug');
      var holdTug = v.attached && !v.engineGate.ok;
      tugBtn.disabled = running || v.status === 'attaching' || v.status === 'waitBrake' || holdTug;
      tugBtn.title = holdTug ? v.engineGate.why : '';
      var svc = PS.services.can();
      PS.services.LIST.forEach(function (sv) {
        var b = serviceBtns[sv.id];
        b.disabled = !svc.ok;
        b.title = svc.ok ? '' : svc.why;
        b.className = 'ps-btn ps-iconbtn ps-small ps-ghost' + (PS.services.recently(sv.id) ? ' ps-requested' : '');
      });
      brakeBtn.setLabel(brakeKnown && b.set ? 'Release the brake' : 'Set the brake');
      brakeBtn.disabled = !brakeKnown || (running && v.status !== 'brakeHold') || v.status === 'attaching';
      whyLine.textContent =
        v.attached && !v.engineGate.ok && !running
          ? v.engineGate.why
          : v.canReturn.ok && !running
            ? 'Return to gate retraces the push back to where it started (' + PS.fmt.dist(v.returnM) + ').'
            : !finishMode && !c.ok && !running && !waiting
              ? c.why
              : '';
    }

    function paintProgress(v) {
      var active = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, done: 1 }[v.status];
      remainBig.textContent = active ? (v.status === 'done' ? 'Arrived' : PS.fmt.dist(v.remainingM) + ' left') : '-';
      barFill.style.width = Math.round((v.status === 'done' ? 1 : v.progress) * 100) + '%';
      legLine.textContent =
        active && v.legCount
          ? 'Leg ' +
            Math.min(v.leg + 1, v.legCount) +
            ' of ' +
            v.legCount +
            (v.direction ? ': ' + v.direction : '') +
            (v.phase && v.phase !== 'run' ? ' (' + v.phase + ')' : '')
          : '';
      var kt = Math.abs(v.speedFtS) * 0.5925;
      motionLine.textContent = active
        ? PS.fmt.num(kt, 1) +
          ' kt' +
          (v.why ? ': ' + v.why : '') +
          (v.failures ? '. ' + v.failures + ' failed write(s): ' + v.lastError : '') +
          (v.note ? '. ' + v.note : '')
        : '';
    }

    function paintMap(v) {
      var g = canvas.getContext && canvas.getContext('2d');
      if (!g) return;
      D.fitCanvas(canvas, 120);
      var own = PS.readOwn() || { lat: 0, lon: 0, hdgDeg: 0 },
        w = canvas.width,
        hgt = canvas.height,
        range = mapRange.get();
      var view = PS.plotView(w, hgt, own, range),
        cx = view.cx,
        cy = view.cy;
      var running = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, done: 1 }[v.status];
      // While pushing, the route drawn is the one the push is driving (not re-planned as the aircraft moves, so no warnings come and go).
      var plan = running && v.plan ? v.plan : PS.plan.evaluate(own);
      D.backdrop(g, view, w, hgt, range, [cx, cy], PS.state.taxi);
      if (!plan.empty) D.planRoute(g, view, plan, { pinCount: PS.plan.count(), doneLegs: running ? v.leg : 0 });
      PS.airTraffic.poll();
      D.contacts(g, view, PS.airTraffic.contacts || [], w, hgt, null);
      D.aircraftMarker(g, cx, cy, own.hdgDeg, PS.theme.c('aircraft'), PS.theme.c('outline'), 1.1);
    }

    function paint() {
      lastPaintAt = Date.now();
      try {
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

    var help = ui.help('Pushing', [
      'Start push does it all: it calls the tug if it is not on, releases the parking brake if it is set (do either yourself first and it carries on from there), then drives the plan made on the Plan tab.',
      'When the push is done the Start button becomes Finish push: it sets the parking brake if it is not set and dismisses the tug if it is on. Return to gate retraces the push (or as far as it got) back to where it started.',
      'It moves the aircraft, so only use it on the ground with the way clear. The push stops at once if you press STOP, the sim takes the tug away, the brake is set, or this app is closed. The tug picks its own speed along the route, up to the maximum in Settings: slower for curves and near the end.',
      'On the map: white = push back, blue = drive forward, grey = done.'
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
            'Push',
            h('div', { class: 'ps-toprow' }, statusBig, h('div', { class: 'ps-spacer' }), h('div', { class: 'ps-right' }, help)),
            statusSub,
            h('div', { class: 'ps-row' }, tugPill, brakePill, gatePill),
            engineLine,
            whyLine,
            h('div', { class: 'ps-btnrow' }, startBtn, returnBtn, pauseBtn, stopBtn),
            h('div', { class: 'ps-btnrow' }, tugBtn, brakeBtn),
            h(
              'div',
              { class: 'ps-btnrow' },
              PS.services.LIST.map(function (sv) {
                return serviceBtns[sv.id];
              })
            )
          ),
          ui.panel('Progress', remainBig, bar, legLine, motionLine)
        ),
        h(
          'div',
          { class: 'ps-col-main ps-col-first' },
          ui.panel(
            'Map',
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
