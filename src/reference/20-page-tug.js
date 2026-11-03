// Spike 2: can the tug be driven from JS? Per-tick writes of PUSHBACK WAIT / VELOCITY BODY Z / ROTATION VELOCITY BODY Y
// (what the original app does). Moves the aircraft: hard run-time limit, stops on hide, pause and close.
// Steering by the KEY_TUG_HEADING event is offered alongside, because turning by rotation write was not working.

PS.TUG = {
  HEADING_UNITS_PER_DEG: 11930465,   // KEY_TUG_HEADING value = this * degrees, as 32-bit unsigned
  ROT_SCALE: 0.002                   // original app: commanded rotation * 0.002 into ROTATION VELOCITY BODY Y
};

// Turn rate to the value written to ROTATION VELOCITY BODY Y. The original app writes a yaw rate in rad/s
// (rotation x 0.002 x tug speed units, which is about 0.05 rad/s = 2.9 deg/s at rotation 1 and cruise speed).
PS.tugRotValue = function (turnDegPerSec, unit) {
  return unit === 'degrees per second' ? turnDegPerSec : turnDegPerSec * Math.PI / 180;
};

PS.tugHeadingValue = function (deg) {
  var d = PS.geo.normDeg(deg);
  return Math.round(PS.TUG.HEADING_UNITS_PER_DEG * d) % 4294967296;
};

// Ramp limits for the live drive (the original ramps speed to cruise in about 0.35 s and eases the turn in).
var SPEED_RAMP = 14;   // ft/s per second
var TURN_RAMP = 5;     // deg/s per second
function approach(cur, target, maxStep) {
  if (cur < target) return Math.min(target, cur + maxStep);
  if (cur > target) return Math.max(target, cur - maxStep);
  return cur;
}

PS.pages.push({
  id: 'tug',
  title: '2 Tug',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var drive = null;      // { timer, startedAt, maxMs, writes, failures, dts[], lastTick, lastError }
    var readTimer = null;

    // ---- live readouts ----
    var readVars = [
      ['PUSHBACK ATTACHED', 'bool'], ['PUSHBACK STATE', 'enum'], ['PUSHBACK WAIT', 'bool'],
      ['BRAKE PARKING POSITION', 'percent over 100'], ['SIM ON GROUND', 'bool'],
      ['GROUND VELOCITY', 'knots'], ['PLANE HEADING DEGREES TRUE', 'degrees'],
      ['VELOCITY BODY Z', 'feet per second'], ['ROTATION VELOCITY BODY Y', 'feet per second']
    ];
    var readCells = {};
    var readTable = ui.table(['Variable', 'Value']);
    readVars.forEach(function (v) {
      var c = h('td', { class: 'ps-val' });
      readCells[v[0]] = c;
      readTable.body.appendChild(h('tr', null, h('td', { class: 'ps-mono', text: v[0] }), c));
    });
    function refreshReadouts() {
      if (typeof paintAttached === 'function') paintAttached();
      readVars.forEach(function (v) {
        var r = PS.getVar(v[0], v[1]);
        var c = readCells[v[0]];
        c.textContent = r.ok ? PS.fmt.value(r.value) : 'ERR ' + r.error;
        c.className = 'ps-val' + (r.ok ? '' : ' bad');
      });
    }

    // ---- shared controls ----
    // Toggle buttons rather than <select>: the sim's dropdown could not be changed in the EFB.
    var methodTog = ui.toggle([{ value: 'simvar', label: 'K: via SimVar' }, { value: 'coherent', label: 'TRIGGER_KEY_EVENT' }], 'simvar');
    var attachedPill = h('span', { class: 'ps-pill bad', text: 'TUG NOT ATTACHED' });
    function say(text, bad) { PS.log('tug', text); return bad; }
    function key(name, value) {
      var r = PS.keyEvent(name, value, methodTog.get());
      say('key ' + name + '=' + value + ' via ' + methodTog.get() + ': ' + (r.ok ? 'sent' : 'FAILED ' + r.error));
      return r;
    }
    function setWait(on) {
      if (!on) stopHoldGuard();
      var r = PS.setVar('PUSHBACK WAIT', 'bool', on ? 1 : 0);
      say('PUSHBACK WAIT=' + (on ? 1 : 0) + ': ' + (r.ok ? 'sent' : 'FAILED ' + r.error));
      return r;
    }
    function isAttached() {
      var r = PS.getVar('PUSHBACK ATTACHED', 'bool');
      return r.ok && Number(r.value) > 0;
    }
    function paintAttached() {
      var a = isAttached();
      attachedPill.className = 'ps-pill ' + (a ? 'ok' : 'bad');
      attachedPill.textContent = a ? 'TUG ATTACHED' : 'TUG NOT ATTACHED';
      return a;
    }
    // The original app's sequence: hold the tug (WAIT on), send TOGGLE_PUSHBACK, then wait for PUSHBACK ATTACHED.
    var attachTimer = null;
    function attachTug() {
      if (attachTimer !== null) { clearInterval(attachTimer); attachTimer = null; }
      if (isAttached()) { say('tug is already attached'); paintAttached(); return; }
      setWait(true);
      key('TOGGLE_PUSHBACK', 1);
      var t0 = Date.now();
      say('waiting for PUSHBACK ATTACHED (up to 15 s)...');
      attachTimer = setInterval(function () {
        if (paintAttached()) {
          say('tug attached after ' + (Date.now() - t0) + ' ms');
          clearInterval(attachTimer); attachTimer = null;
        } else if (Date.now() - t0 > 15000) {
          say('PUSHBACK ATTACHED never became true in 15 s (the aircraft may use its own pushback system)', true);
          clearInterval(attachTimer); attachTimer = null;
        }
      }, 250);
    }
    function detachTug() {
      if (!isAttached()) { say('no tug attached to detach'); return; }
      stopHoldGuard();
      if (drive) stopDrive('detach', true);
      key('TOGGLE_PUSHBACK', 1);
      say('detach requested');
    }
    var shared = ui.panel('Tug',
      h('div', { class: 'ps-row' }, attachedPill),
      h('div', { class: 'ps-row' },
        ui.button('Attach tug (original sequence)', attachTug),
        ui.button('Detach tug', detachTug, 'ps-ghost'),
        ui.button('Hold tug (WAIT on)', function () { setWait(true); }),
        ui.button('Go (WAIT off)', function () { setWait(false); }),
        ui.field('Key event method', methodTog.el)
      ),
      ui.note('Attach the tug first. Without a tug, writing velocity just shoves a free aircraft around (it can lift or skid), so Start drive refuses unless a tug is attached. The original app sets PUSHBACK WAIT to 1 before TOGGLE_PUSHBACK, then waits for PUSHBACK ATTACHED.')
    );

    // ---- direct mode ----
    var speedIn = ui.input('1', { type: 'number', step: '0.5', min: '-5', max: '5' });
    var rotIn = ui.input('0', { type: 'number', step: '0.1', min: '-3', max: '3' });
    var rotUnitTog = ui.toggle([
      { value: 'radians per second', label: 'rad/s' },
      { value: 'degrees per second', label: 'deg/s' },
      { value: 'feet per second', label: 'ft/s (original hack)' }
    ], 'radians per second');
    var intervalTog = ui.toggle([{ value: '20', label: '20 ms' }, { value: '50', label: '50 ms' }, { value: '100', label: '100 ms' }], '50');
    var allowFreeChk = h('input', { type: 'checkbox' });
    function presets(input, values) {
      var row = h('div', { class: 'ps-row' });
      values.forEach(function (v) { row.appendChild(ui.button(String(v), function () { input.value = String(v); }, 'ps-small')); });
      return row;
    }
    var maxSecIn = ui.input('10', { type: 'number', min: '1', max: '30', step: '1' });
    var armed = h('span', { class: 'ps-pill bad', text: 'NOT RUNNING' });
    var stats = h('div', { class: 'ps-kv', text: 'No run yet.' });

    // Stopping: by default the drive eases speed and turn to zero while still writing every tick (as the original app does),
    // then holds. `immediate` (page hidden, app paused or closed, detach) zeroes at once for safety.
    function zeroAndHold() {
      PS.setVar('VELOCITY BODY Z', 'feet per second', 0);
      PS.setVar('ROTATION VELOCITY BODY Y', rotUnitTog.get(), 0);
      PS.setVar('PUSHBACK WAIT', 'bool', 1);
    }
    function stopDrive(reason, immediate) {
      if (!drive) return;
      var d = drive;
      if (!immediate) {
        if (d.stopping) return;
        d.stopping = true; d.stopReason = reason; d.stopHoldTicks = 0;
        say('stopping (' + reason + '): easing to zero');
        return;
      }
      finalizeStop(d, reason);
    }
    function finalizeStop(d, reason) {
      clearInterval(d.timer);
      drive = null;
      zeroAndHold();
      armed.className = 'ps-pill bad';
      armed.textContent = 'NOT RUNNING';
      say('direct drive stopped (' + reason + '): ' + d.writes + ' tick writes, ' + d.failures + ' failed ticks');
      paintStats(d, true);
      stats.textContent.split('\n').forEach(function (l) { PS.log('tug', 'final ' + l); });
      startHoldGuard();
    }

    // After a stop, keep telling the sim to hold still for a few seconds and log what it does (is the tug still attached,
    // is the aircraft rolling?). A new drive, or the Go button, cancels it.
    var HOLD_MS = 5000;
    var holdTimer = null;
    function stopHoldGuard() {
      if (holdTimer !== null) { clearInterval(holdTimer); holdTimer = null; }
    }
    function startHoldGuard() {
      stopHoldGuard();
      var t0 = Date.now(), lastLog = 0;
      holdTimer = setInterval(function () {
        var now = Date.now();
        if (drive || now - t0 > HOLD_MS) {
          stopHoldGuard();
          if (!drive) say('hold after stop finished');
          return;
        }
        var attached = isAttached();
        if (attached) zeroAndHold();
        if (now - lastLog >= 500) {
          lastLog = now;
          var st = PS.getVar('PUSHBACK STATE', 'enum'), w = PS.getVar('PUSHBACK WAIT', 'bool'), gs = PS.getVar('GROUND VELOCITY', 'knots'),
            vz = PS.getVar('VELOCITY BODY Z', 'feet per second'), br = PS.getVar('BRAKE PARKING POSITION', 'percent over 100');
          PS.log('tug', 'after stop +' + PS.fmt.num((now - t0) / 1000, 1) + 's | attached=' + (attached ? 1 : 0) + ' state=' + PS.fmt.value(st.value) +
            ' wait=' + PS.fmt.value(w.value) + ' | GS ' + PS.fmt.num(gs.value, 2) + ' kt, velZ ' + PS.fmt.num(vz.value, 2) + ' ft/s | brake ' + PS.fmt.num(br.value, 2));
        }
      }, 100);
    }
    function meanDt(d) {
      var m = 0, i;
      for (i = 0; i < d.dts.length; i++) m += d.dts[i];
      return d.dts.length ? m / d.dts.length : 0;
    }
    function paintStats(d, final) {
      var dts = d.dts;
      var mean = 0, max = 0, i;
      for (i = 0; i < dts.length; i++) { mean += dts[i]; if (dts[i] > max) max = dts[i]; }
      mean = dts.length ? mean / dts.length : 0;
      var rb = d.lastReadback || {};
      var lines = [
        (final ? 'Last run: ' : 'Running: ') + d.writes + ' ticks, ' + d.failures + ' with a failed write' + (d.lastError ? ' (last error: ' + d.lastError + ')' : ''),
        'Requested interval ' + d.intervalMs + ' ms; actual mean ' + PS.fmt.num(mean, 1) + ' ms, worst ' + PS.fmt.num(max, 1) + ' ms (' + PS.fmt.num(mean ? 1000 / mean : 0, 1) + ' Hz)',
        'Commanded VEL Z ' + PS.fmt.num(d.cmdSpeed, 2) + ' ft/s, read back ' + PS.fmt.num(rb.velZ, 2) + ' ft/s -> ' + verdict(d.cmdSpeed, rb.velZ),
        'Ground speed ' + PS.fmt.num(rb.gs, 2) + ' kt, ROT VEL Y read back ' + PS.fmt.num(rb.rotY, 4),
        turnLine(d, rb)
      ];
      stats.textContent = lines.join('\n');
    }
    function turnLine(d, rb) {
      if (d.hdg0 === null || typeof rb.hdg !== 'number') return 'Turn: no heading readback';
      var secs = (Date.now() - d.measureStart) / 1000;
      var diff = PS.geo.angleDiff(d.hdg0, rb.hdg);
      var rate = secs > 0.5 ? diff / secs : 0;
      var verdictText = Math.abs(d.cmdTurn) < 0.01 ? 'straight commanded' : (Math.abs(rate) < Math.abs(d.cmdTurn) * 0.25 ? 'NOT TURNING (well below command)' : 'TURNING');
      return 'Turn: heading changed ' + PS.fmt.num(diff, 1) + ' deg in ' + PS.fmt.num(secs, 1) + ' s = ' + PS.fmt.num(rate, 2) + ' deg/s (commanded ' + PS.fmt.num(d.cmdTurn, 2) + ' deg/s) -> ' + verdictText;
    }
    function verdict(cmd, read) {
      if (typeof read !== 'number') return 'no readback';
      if (Math.abs(cmd) < 0.01) return Math.abs(read) < 0.2 ? 'at rest, as commanded' : 'not at rest';
      return Math.abs(read - cmd) < Math.max(0.3, Math.abs(cmd) * 0.2) ? 'MATCHES (writes are taking effect)' : 'DOES NOT MATCH (writes ignored, overridden or clamped)';
    }

    function startDrive() {
      if (drive) return;
      stopHoldGuard();
      if (!paintAttached() && !allowFreeChk.checked) {
        say('refusing to drive: no tug is attached. Press Attach tug first, or tick "drive without a tug" to test raw velocity writes.', true);
        stats.textContent = 'Not started: no tug attached. Press "Attach tug (original sequence)" and wait for TUG ATTACHED.';
        return;
      }
      var speed = Number(speedIn.value) || 0;
      var rot = Number(rotIn.value) || 0;
      var rotUnit = rotUnitTog.get();
      var intervalMs = Number(intervalTog.get());
      var maxMs = Math.max(1, Math.min(30, Number(maxSecIn.value) || 10)) * 1000;
      var h0 = PS.getVar('PLANE HEADING DEGREES TRUE', 'degrees');
      var rotWritten = PS.tugRotValue(rot, rotUnit);
      drive = { startedAt: Date.now(), maxMs: maxMs, writes: 0, failures: 0, dts: [], lastTick: Date.now(), lastError: '',
        intervalMs: intervalMs, cmdSpeed: speed, cmdTurn: rot, curSpeed: 0, curTurn: 0, measureStart: Date.now(), hdg0: h0.ok ? h0.value : null, lastReadback: null };
      armed.className = 'ps-pill ok';
      armed.textContent = 'RUNNING (auto-stop in ' + (maxMs / 1000) + ' s)';
      say('direct drive started: velZ=' + speed + ' ft/s, turn=' + rot + ' deg/s -> writing ' + PS.fmt.num(rotWritten, 5) + ' [' + rotUnit + '], every ' + intervalMs + ' ms, max ' + (maxMs / 1000) + ' s');
      drive.timer = setInterval(function () {
        var d = drive;
        if (!d) return;
        var now = Date.now();
        if (!d.stopping && now - d.startedAt >= d.maxMs) stopDrive('time limit');
        d.dts.push(now - d.lastTick);
        if (d.dts.length > 200) d.dts.shift();
        d.lastTick = now;
        // Read the inputs live every tick so changes (typed or from the preset buttons) take effect immediately.
        var tgtSpeed = d.stopping ? 0 : (Number(speedIn.value) || 0);
        var tgtTurn = d.stopping ? 0 : (Number(rotIn.value) || 0);
        var unitNow = rotUnitTog.get();
        var dt = Math.min(0.2, d.dts[d.dts.length - 1] / 1000);
        d.curSpeed = approach(d.curSpeed, tgtSpeed, SPEED_RAMP * dt);
        d.curTurn = approach(d.curTurn, tgtTurn, TURN_RAMP * dt);
        if (!d.stopping && (tgtSpeed !== d.cmdSpeed || tgtTurn !== d.cmdTurn)) {
          d.cmdSpeed = tgtSpeed; d.cmdTurn = tgtTurn;
          var hh = PS.getVar('PLANE HEADING DEGREES TRUE', 'degrees');
          d.hdg0 = hh.ok ? hh.value : null; d.measureStart = now;
          say('command changed live: speed ' + tgtSpeed + ' ft/s, turn ' + tgtTurn + ' deg/s');
        }
        // The same set the original app writes every tick.
        var results = [
          PS.setVar('PUSHBACK WAIT', 'bool', 0),
          PS.setVar('VELOCITY BODY Y', 'feet per second', 0),
          PS.setVar('ROTATION VELOCITY BODY X', 'feet per second', 0),
          PS.setVar('VELOCITY BODY Z', 'feet per second', d.curSpeed),
          PS.setVar('ROTATION VELOCITY BODY Y', unitNow, PS.tugRotValue(d.curTurn, unitNow))
        ];
        var failed = false;
        for (var i = 0; i < results.length; i++) { if (!results[i].ok) { failed = true; d.lastError = results[i].error; } }
        d.writes++;
        if (failed) d.failures++;
        if (d.stopping && d.curSpeed === 0 && d.curTurn === 0) {
          d.stopHoldTicks++;
          if (d.stopHoldTicks * d.intervalMs >= 600) { finalizeStop(d, d.stopReason); return; }
        }
        if (d.writes % 5 === 0) {
          var vz = PS.getVar('VELOCITY BODY Z', 'feet per second');
          var ry = PS.getVar('ROTATION VELOCITY BODY Y', rotUnitTog.get());
          var gs = PS.getVar('GROUND VELOCITY', 'knots');
          var hd = PS.getVar('PLANE HEADING DEGREES TRUE', 'degrees');
          d.lastReadback = { velZ: vz.ok ? vz.value : null, rotY: ry.ok ? ry.value : null, gs: gs.ok ? gs.value : null, hdg: hd.ok ? hd.value : null };
          paintStats(d, false);
          if (!d.lastLogAt || now - d.lastLogAt >= 1000) {
            var rb2 = d.lastReadback;
            var inst = null;
            if (d.lastLogAt && typeof rb2.hdg === 'number' && typeof d.lastLogHdg === 'number') {
              inst = PS.geo.angleDiff(d.lastLogHdg, rb2.hdg) / ((now - d.lastLogAt) / 1000);
            }
            var avgTurn = (d.hdg0 !== null && typeof rb2.hdg === 'number' && now - d.measureStart > 500)
              ? PS.geo.angleDiff(d.hdg0, rb2.hdg) / ((now - d.measureStart) / 1000) : null;
            PS.log('tug', 'drive t=' + PS.fmt.num((now - d.startedAt) / 1000, 1) + 's unit=' + unitNow +
              ' | speed cmd ' + PS.fmt.num(d.cmdSpeed, 2) + ' ramped ' + PS.fmt.num(d.curSpeed, 2) + ' read ' + PS.fmt.num(rb2.velZ, 2) + ' ft/s, GS ' + PS.fmt.num(rb2.gs, 2) + ' kt' +
              ' | turn cmd ' + PS.fmt.num(d.cmdTurn, 2) + ' ramped ' + PS.fmt.num(d.curTurn, 2) + ' deg/s, wrote ' + PS.fmt.num(PS.tugRotValue(d.curTurn, unitNow), 5) + ' [' + unitNow + ']' +
              ' | heading ' + PS.fmt.num(rb2.hdg, 1) + ', measured turn ' + PS.fmt.num(inst, 2) + ' deg/s now, ' + PS.fmt.num(avgTurn, 2) + ' deg/s since last change' +
              ' | ROT VEL Y read ' + PS.fmt.num(rb2.rotY, 4) + ' | interval mean ' + PS.fmt.num(meanDt(d), 1) + ' ms');
            d.lastLogAt = now; d.lastLogHdg = rb2.hdg;
          }
        }
      }, intervalMs);
    }

    var directPanel = ui.panel('Per-tick velocity writes',
      ui.note('Moves the aircraft. Only use parked on the ground with the tug attached and the brake released. Speed and turn are read every tick, so you can change them while it runs. Stops by itself at the time limit, and when this page is hidden or the app is paused or closed.', 'warn'),
      h('div', { class: 'ps-row' }, ui.field('Speed (ft/s, + forward, - reverse)', speedIn), ui.field('Max run (s)', maxSecIn)),
      presets(speedIn, [-5, -2, -1, 0, 1, 2, 5]),
      h('div', { class: 'ps-row' }, ui.field('Turn rate (deg/s, + = nose right)', rotIn)),
      presets(rotIn, [-6, -3, -1.5, 0, 1.5, 3, 6]),
      h('div', { class: 'ps-row' }, ui.field('Rotation unit', rotUnitTog.el), ui.field('Update interval', intervalTog.el)),
      h('div', { class: 'ps-row' },
        h('label', { class: 'ps-check' }, allowFreeChk, ' drive without a tug (raw velocity test, can misbehave)'),
        armed),
      h('div', { class: 'ps-row' },
        ui.button('Start drive', startDrive, 'ps-warn'),
        ui.button('Straight (turn 0)', function () { rotIn.value = '0'; }, 'ps-small'),
        ui.button('STOP (write 0)', function () { if (drive) stopDrive('stop button'); else { PS.setVar('VELOCITY BODY Z', 'feet per second', 0); say('stop pressed (no run active); wrote 0'); } }, 'ps-danger')),
      stats
    );

    // ---- steering by the tug heading event (retry now that the tug is attached) ----
    var hdgIn = ui.input('0', { type: 'number', min: '0', max: '360', step: '1' });
    function curHeading() {
      var r = PS.getVar('PLANE HEADING DEGREES TRUE', 'degrees');
      return r.ok && typeof r.value === 'number' ? r.value : null;
    }
    function sendHeading(deg) {
      var v = PS.tugHeadingValue(deg);
      key('KEY_TUG_HEADING', v);
      say('tug heading target ' + PS.fmt.num(PS.geo.normDeg(deg), 1) + ' deg (event value ' + v + ')');
    }
    function nudge(delta) {
      var cur = curHeading();
      if (cur === null) { say('cannot read PLANE HEADING DEGREES TRUE', true); return; }
      sendHeading(cur + delta);
    }
    var steerPanel = ui.panel('Steering by tug heading event (KEY_TUG_HEADING)',
      ui.note('Tests turning without the rotation write. Attach the tug, start a drive (or leave the tug held and press Go), then press a button and watch the heading in the readouts. Each press sets a target relative to the current heading.'),
      h('div', { class: 'ps-row' },
        ui.button('Left 15', function () { nudge(-15); }), ui.button('Left 5', function () { nudge(-5); }),
        ui.button('Right 5', function () { nudge(5); }), ui.button('Right 15', function () { nudge(15); })),
      h('div', { class: 'ps-row' },
        ui.field('Absolute heading (true)', hdgIn),
        ui.button('Send heading', function () { sendHeading(Number(hdgIn.value) || 0); }),
        ui.button('Use current', function () { var c = curHeading(); if (c !== null) hdgIn.value = String(Math.round(c)); }))
    );

    var el = h('div', { class: 'ps-page' },
      shared,
      directPanel,
      steerPanel,
      ui.panel('Live readouts', readTable.el),
      ui.panel('Log', ui.logBox(['tug', 'key', 'set']))
    );

    // Safety: stop the drive whenever the app is paused or closed.
    PS.closeHooks.push(function () { stopDrive('app paused or closed', true); });

    return {
      el: el,
      snapshot: function () {
        var lines = readVars.map(function (v) { return v[0] + ' = ' + readCells[v[0]].textContent; });
        lines.push('', 'Last drive stats:', stats.textContent);
        return lines.join('\n');
      },
      onShow: function () { refreshReadouts(); readTimer = setInterval(refreshReadouts, 250); },
      onHide: function () { if (readTimer !== null) { clearInterval(readTimer); readTimer = null; } stopDrive('page hidden', true); }
    };
  }
});
