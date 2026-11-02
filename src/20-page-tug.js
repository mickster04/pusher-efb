// Spike 2: can the tug be driven from JS? Two modes behind a toggle:
//  - Direct: per-tick writes of PUSHBACK WAIT / VELOCITY BODY Z / ROTATION VELOCITY BODY Y (what the original app does).
//  - Native: the sim's own tug events (TOGGLE_PUSHBACK, KEY_TUG_HEADING, PUSHBACK WAIT) - the fallback.
// Direct mode moves the aircraft. It has a hard run-time limit and stops on hide, pause and close.

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
    var mode = 'direct';
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
      readVars.forEach(function (v) {
        var r = PS.getVar(v[0], v[1]);
        var c = readCells[v[0]];
        c.textContent = r.ok ? PS.fmt.value(r.value) : 'ERR ' + r.error;
        c.className = 'ps-val' + (r.ok ? '' : ' bad');
      });
    }

    // ---- shared controls ----
    var methodSel = ui.select([{ value: 'simvar', label: 'K: via SimVar' }, { value: 'coherent', label: 'TRIGGER_KEY_EVENT' }], 'simvar');
    function say(text, bad) { PS.log('tug', text); return bad; }
    function key(name, value) {
      var r = PS.keyEvent(name, value, methodSel.value);
      say('key ' + name + '=' + value + ' via ' + methodSel.value + ': ' + (r.ok ? 'sent' : 'FAILED ' + r.error));
      return r;
    }
    function setWait(on) {
      var r = PS.setVar('PUSHBACK WAIT', 'bool', on ? 1 : 0);
      say('PUSHBACK WAIT=' + (on ? 1 : 0) + ': ' + (r.ok ? 'sent' : 'FAILED ' + r.error));
      return r;
    }
    var shared = ui.panel('Tug (both modes)',
      h('div', { class: 'ps-row' },
        ui.button('Call / toggle tug (TOGGLE_PUSHBACK)', function () { key('TOGGLE_PUSHBACK', 1); }),
        ui.button('Hold tug (WAIT on)', function () { setWait(true); }),
        ui.button('Go (WAIT off)', function () { setWait(false); }),
        ui.field('Key event method', methodSel)
      ),
      ui.note('The original app sets PUSHBACK WAIT to 1 before TOGGLE_PUSHBACK, otherwise the sim tug starts reversing on its own.')
    );

    // ---- direct mode ----
    var speedIn = ui.input('1', { type: 'number', step: '0.5', min: '-5', max: '5' });
    var rotIn = ui.input('0', { type: 'number', step: '0.1', min: '-3', max: '3' });
    var scaleChk = h('input', { type: 'checkbox', checked: true });
    scaleChk.checked = true;
    var rotUnitSel = ui.select([
      { value: 'feet per second', label: 'feet per second (original hack)' },
      { value: 'radians per second', label: 'radians per second' },
      { value: 'degrees per second', label: 'degrees per second' }
    ], 'feet per second');
    var intervalSel = ui.select([{ value: '20', label: '20 ms' }, { value: '50', label: '50 ms' }, { value: '100', label: '100 ms' }], '50');
    var maxSecIn = ui.input('10', { type: 'number', min: '1', max: '30', step: '1' });
    var armed = h('span', { class: 'ps-pill bad', text: 'NOT RUNNING' });
    var stats = h('div', { class: 'ps-kv', text: 'No run yet.' });

    function stopDrive(reason) {
      if (!drive) return;
      clearInterval(drive.timer);
      var d = drive;
      drive = null;
      PS.setVar('VELOCITY BODY Z', 'feet per second', 0);
      PS.setVar('ROTATION VELOCITY BODY Y', rotUnitSel.value, 0);
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
      var speed = Number(speedIn.value) || 0;
      var rot = Number(rotIn.value) || 0;
      var scale = scaleChk.checked ? PS.TUG.ROT_SCALE : 1;
      var rotUnit = rotUnitSel.value;
      var intervalMs = Number(intervalSel.value);
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

    var directPanel = ui.panel('Direct mode: per-tick velocity writes',
      ui.note('Moves the aircraft. Only use parked on the ground with the tug attached and the brake released. Stops by itself at the time limit, and when this page is hidden or the app is paused or closed.', 'warn'),
      h('div', { class: 'ps-row' },
        ui.field('Speed (ft/s, + forward, - reverse)', speedIn), ui.field('Rotation (original units)', rotIn),
        ui.field('Rotation unit', rotUnitSel), ui.field('Update interval', intervalSel), ui.field('Max run (s)', maxSecIn)),
      h('div', { class: 'ps-row' },
        h('label', { class: 'ps-check' }, scaleChk, ' scale rotation by 0.002 (original app)'),
        armed),
      h('div', { class: 'ps-row' },
        ui.button('Start drive', startDrive, 'ps-warn'),
        ui.button('STOP (write 0)', function () { if (drive) stopDrive('stop button'); else { PS.setVar('VELOCITY BODY Z', 'feet per second', 0); say('stop pressed (no run active); wrote 0'); } }, 'ps-danger')),
      stats
    );

    // ---- native mode ----
    var hdgIn = ui.input('0', { type: 'number', min: '0', max: '360', step: '1' });
    var evtName = ui.input('', { placeholder: 'Key event name (unverified names only)' });
    var evtVal = ui.input('0', { placeholder: 'Value' });
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
    var nativePanel = ui.panel('Native mode: the sim\'s own tug events',
      ui.note('Fallback for steering without per-tick velocity writes: KEY_TUG_HEADING gives a left/right target. Whether speed can be shaped in this mode is unproven; try the custom event row.'),
      h('div', { class: 'ps-row' },
        ui.button('\u25C0 Left 15\u00B0', function () { nudge(-15); }),
        ui.button('\u25C0 Left 5\u00B0', function () { nudge(-5); }),
        ui.button('Right 5\u00B0 \u25B6', function () { nudge(5); }),
        ui.button('Right 15\u00B0 \u25B6', function () { nudge(15); })),
      h('div', { class: 'ps-row' },
        ui.field('Absolute heading (true)', hdgIn),
        ui.button('Send heading', function () { sendHeading(Number(hdgIn.value) || 0); }),
        ui.button('Use current', function () { var c = curHeading(); if (c !== null) hdgIn.value = Math.round(c); })),
      h('div', { class: 'ps-row' },
        ui.field('Custom key event', evtName), ui.field('Value', evtVal),
        ui.button('Send', function () { key(evtName.value.replace(/^K:/, ''), Number(evtVal.value) || 0); }, 'ps-warn'))
    );

    var toggle = ui.toggle([{ value: 'direct', label: 'Direct (velocity writes)' }, { value: 'native', label: 'Native (tug events)' }], 'direct', function (m) {
      mode = m; paintMode();
    });
    function paintMode() {
      directPanel.style.display = mode === 'direct' ? '' : 'none';
      nativePanel.style.display = mode === 'native' ? '' : 'none';
      if (mode === 'native' && drive) stopDrive('mode switched');
    }

    var el = h('div', { class: 'ps-page' },
      ui.panel('Mode', toggle.el),
      shared,
      directPanel,
      nativePanel,
      ui.panel('Live readouts', readTable.el),
      ui.panel('Log', ui.logBox(['tug', 'key', 'set']))
    );
    paintMode();

    // Safety: stop the drive whenever the app is paused or closed.
    PS.closeHooks.push(function () { stopDrive('app paused or closed'); });

    return {
      el: el,
      onShow: function () { refreshReadouts(); readTimer = setInterval(refreshReadouts, 250); },
      onHide: function () { if (readTimer !== null) { clearInterval(readTimer); readTimer = null; } stopDrive('page hidden'); }
    };
  }
});
