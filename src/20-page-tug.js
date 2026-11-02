// Spike 2: can the tug be driven from JS? Per-tick writes of PUSHBACK WAIT / VELOCITY BODY Z / ROTATION VELOCITY BODY Y
// (what the original app does). Moves the aircraft: hard run-time limit, stops on hide, pause and close.
// A native-events mode (KEY_TUG_HEADING) was tried and dropped: the direct writes worked.

PS.TUG = {
  HEADING_UNITS_PER_DEG: 11930465,   // KEY_TUG_HEADING value = this * degrees, as 32-bit unsigned
  ROT_SCALE: 0.002                   // original app: commanded rotation * 0.002 into ROTATION VELOCITY BODY Y
};

PS.tugHeadingValue = function (deg) {
  var d = PS.geo.normDeg(deg);
  return Math.round(PS.TUG.HEADING_UNITS_PER_DEG * d) % 4294967296;
};

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
      if (drive) stopDrive('detach');
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
    var scaleChk = h('input', { type: 'checkbox', checked: true });
    scaleChk.checked = true;
    var rotUnitTog = ui.toggle([
      { value: 'feet per second', label: 'ft/s (original hack)' },
      { value: 'radians per second', label: 'rad/s' },
      { value: 'degrees per second', label: 'deg/s' }
    ], 'feet per second');
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

    function stopDrive(reason) {
      if (!drive) return;
      clearInterval(drive.timer);
      var d = drive;
      drive = null;
      PS.setVar('VELOCITY BODY Z', 'feet per second', 0);
      PS.setVar('ROTATION VELOCITY BODY Y', rotUnitTog.get(), 0);
      PS.setVar('PUSHBACK WAIT', 'bool', 1);
      armed.className = 'ps-pill bad';
      armed.textContent = 'NOT RUNNING';
      say('direct drive stopped (' + reason + '): ' + d.writes + ' tick writes, ' + d.failures + ' failed ticks');
      paintStats(d, true);
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
        'Ground speed ' + PS.fmt.num(rb.gs, 2) + ' kt, ROT VEL Y read back ' + PS.fmt.num(rb.rotY, 4)
      ];
      stats.textContent = lines.join('\n');
    }
    function verdict(cmd, read) {
      if (typeof read !== 'number') return 'no readback';
      if (Math.abs(cmd) < 0.01) return Math.abs(read) < 0.2 ? 'at rest, as commanded' : 'not at rest';
      return Math.abs(read - cmd) < Math.max(0.3, Math.abs(cmd) * 0.2) ? 'MATCHES (writes are taking effect)' : 'DOES NOT MATCH (writes ignored, overridden or clamped)';
    }

    function startDrive() {
      if (drive) return;
      if (!paintAttached() && !allowFreeChk.checked) {
        say('refusing to drive: no tug is attached. Press Attach tug first, or tick "drive without a tug" to test raw velocity writes.', true);
        stats.textContent = 'Not started: no tug attached. Press "Attach tug (original sequence)" and wait for TUG ATTACHED.';
        return;
      }
      var speed = Number(speedIn.value) || 0;
      var rot = Number(rotIn.value) || 0;
      var scale = scaleChk.checked ? PS.TUG.ROT_SCALE : 1;
      var rotUnit = rotUnitTog.get();
      var intervalMs = Number(intervalTog.get());
      var maxMs = Math.max(1, Math.min(30, Number(maxSecIn.value) || 10)) * 1000;
      drive = { startedAt: Date.now(), maxMs: maxMs, writes: 0, failures: 0, dts: [], lastTick: Date.now(), lastError: '',
        intervalMs: intervalMs, cmdSpeed: speed, lastReadback: null };
      armed.className = 'ps-pill ok';
      armed.textContent = 'RUNNING (auto-stop in ' + (maxMs / 1000) + ' s)';
      say('direct drive started: velZ=' + speed + ' ft/s, rot=' + rot + ' x' + scale + ' [' + rotUnit + '], every ' + intervalMs + ' ms, max ' + (maxMs / 1000) + ' s');
      drive.timer = setInterval(function () {
        var d = drive;
        if (!d) return;
        var now = Date.now();
        if (now - d.startedAt >= d.maxMs) { stopDrive('time limit'); return; }
        d.dts.push(now - d.lastTick);
        if (d.dts.length > 200) d.dts.shift();
        d.lastTick = now;
        // The same set the original app writes every tick.
        var results = [
          PS.setVar('PUSHBACK WAIT', 'bool', 0),
          PS.setVar('VELOCITY BODY Y', 'feet per second', 0),
          PS.setVar('ROTATION VELOCITY BODY X', 'feet per second', 0),
          PS.setVar('VELOCITY BODY Z', 'feet per second', speed),
          PS.setVar('ROTATION VELOCITY BODY Y', rotUnit, rot * scale)
        ];
        var failed = false;
        for (var i = 0; i < results.length; i++) { if (!results[i].ok) { failed = true; d.lastError = results[i].error; } }
        d.writes++;
        if (failed) d.failures++;
        if (d.writes % 5 === 0) {
          var vz = PS.getVar('VELOCITY BODY Z', 'feet per second');
          var ry = PS.getVar('ROTATION VELOCITY BODY Y', rotUnit);
          var gs = PS.getVar('GROUND VELOCITY', 'knots');
          d.lastReadback = { velZ: vz.ok ? vz.value : null, rotY: ry.ok ? ry.value : null, gs: gs.ok ? gs.value : null };
          paintStats(d, false);
        }
      }, intervalMs);
    }

    var directPanel = ui.panel('Per-tick velocity writes',
      ui.note('Moves the aircraft. Only use parked on the ground with the tug attached and the brake released. Stops by itself at the time limit, and when this page is hidden or the app is paused or closed.', 'warn'),
      h('div', { class: 'ps-row' }, ui.field('Speed (ft/s, + forward, - reverse)', speedIn), ui.field('Max run (s)', maxSecIn)),
      presets(speedIn, [-5, -2, -1, 0, 1, 2, 5]),
      h('div', { class: 'ps-row' }, ui.field('Rotation (original units)', rotIn)),
      presets(rotIn, [-2, -1, -0.5, 0, 0.5, 1, 2]),
      h('div', { class: 'ps-row' }, ui.field('Rotation unit', rotUnitTog.el), ui.field('Update interval', intervalTog.el)),
      h('div', { class: 'ps-row' },
        h('label', { class: 'ps-check' }, scaleChk, ' scale rotation by 0.002 (original app)'),
        h('label', { class: 'ps-check' }, allowFreeChk, ' drive without a tug (raw velocity test, can misbehave)'),
        armed),
      h('div', { class: 'ps-row' },
        ui.button('Start drive', startDrive, 'ps-warn'),
        ui.button('STOP (write 0)', function () { if (drive) stopDrive('stop button'); else { PS.setVar('VELOCITY BODY Z', 'feet per second', 0); say('stop pressed (no run active); wrote 0'); } }, 'ps-danger')),
      stats
    );

    var el = h('div', { class: 'ps-page' },
      shared,
      directPanel,
      ui.panel('Live readouts', readTable.el),
      ui.panel('Log', ui.logBox(['tug', 'key', 'set']))
    );

    // Safety: stop the drive whenever the app is paused or closed.
    PS.closeHooks.push(function () { stopDrive('app paused or closed'); });

    return {
      el: el,
      snapshot: function () {
        var lines = readVars.map(function (v) { return v[0] + ' = ' + readCells[v[0]].textContent; });
        lines.push('', 'Last drive stats:', stats.textContent);
        return lines.join('\n');
      },
      onShow: function () { refreshReadouts(); readTimer = setInterval(refreshReadouts, 250); },
      onHide: function () { if (readTimer !== null) { clearInterval(readTimer); readTimer = null; } stopDrive('page hidden'); }
    };
  }
});
