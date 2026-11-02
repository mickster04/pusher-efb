// Spike 1: which variables can an EFB app read, how fast, and does anything keep ticking while hidden?

PS.pages.push({
  id: 'telemetry',
  title: '1 Telemetry',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var vars = PS.DEFAULT_VARS.map(function (v) { return { group: v.group, name: v.name, unit: v.unit, custom: false }; });
    var timer = null;
    var rateMs = 250;
    var cycles = 0;
    var lastCycleMs = 0;
    var cells = [];

    // ---- status / heartbeat ----
    var envLine = h('div', { class: 'ps-kv' });
    var hbLine = h('div', { class: 'ps-kv' });
    var cycleLine = h('div', { class: 'ps-kv' });

    function paintStatus() {
      var env = PS.env();
      PS.clear(envLine);
      ['simVar', 'coherent', 'efb', 'sdk', 'notificationManager'].forEach(function (k) {
        envLine.appendChild(h('span', { class: 'ps-pill ' + (env[k] ? 'ok' : 'bad'), text: k + ': ' + (env[k] ? 'yes' : 'no') }));
      });
      var hb = PS.hb;
      var up = (Date.now() - hb.startedAt) / 1000;
      var parts = [
        'own timer ticks: ' + hb.ticks + ' (expected about ' + Math.floor(up / 0.5) + ')',
        'EFB onUpdate frames: ' + hb.frames,
        'browser animation frames: ' + hb.raf,
        'largest timer gap: ' + hb.maxGapMs + ' ms',
        'app state: ' + (hb.paused ? 'PAUSED (hidden)' : 'visible')
      ];
      if (hb.lastPause) {
        parts.push('last hidden period: ' + Math.round(hb.lastPause.ms / 1000) + ' s, ' + hb.lastPause.ticks +
          ' timer ticks, ' + hb.lastPause.frames + ' onUpdate frames and ' + hb.lastPause.raf + ' animation frames while hidden');
      }
      var hookNames = Object.keys(hb.hooks);
      parts.push('EFB hooks called: ' + (hookNames.length ? hookNames.map(function (n) { return n + ' x' + hb.hooks[n]; }).join(', ') : 'none yet'));
      hbLine.textContent = parts.join('   |   ');
      cycleLine.textContent = 'read cycles: ' + cycles + '   |   last cycle: ' + vars.length + ' vars in ' + PS.fmt.num(lastCycleMs, 1) + ' ms   |   poll every ' + rateMs + ' ms';
    }

    // ---- variable table ----
    var tbl = ui.table(['Group', 'Variable', 'Unit', 'Value', '']);
    function buildRows() {
      PS.clear(tbl.body);
      cells = [];
      vars.forEach(function (v, i) {
        var valueCell = h('td', { class: 'ps-val' });
        var del = v.custom ? ui.button('x', function () { vars.splice(i, 1); buildRows(); }, 'ps-small') : null;
        tbl.body.appendChild(h('tr', null,
          h('td', { text: v.group }), h('td', { class: 'ps-mono', text: v.name }), h('td', { text: v.unit }), valueCell, h('td', null, del)));
        cells.push(valueCell);
      });
    }
    function cycle() {
      var t0 = Date.now();
      for (var i = 0; i < vars.length; i++) {
        var r = PS.getVar(vars[i].name, vars[i].unit);
        var cell = cells[i];
        if (!cell) continue;
        if (r.ok) { cell.textContent = PS.fmt.value(r.value); cell.className = 'ps-val'; }
        else { cell.textContent = 'ERR ' + r.error; cell.className = 'ps-val bad'; }
      }
      lastCycleMs = Date.now() - t0;
      cycles++;
      paintStatus();
    }
    function start() {
      if (timer !== null) clearInterval(timer);
      timer = setInterval(cycle, rateMs);
    }
    function stop() { if (timer !== null) { clearInterval(timer); timer = null; } }

    // ---- input row ----
    var nameIn = ui.input('PLANE HEADING DEGREES MAGNETIC', { placeholder: 'Variable, e.g. A:... or L:... or K:... event' });
    var unitIn = ui.input('degrees', { placeholder: 'Unit' });
    var valueIn = ui.input('0', { placeholder: 'Value to set' });
    var methodSel = ui.select([{ value: 'simvar', label: 'K: via SimVar' }, { value: 'coherent', label: 'TRIGGER_KEY_EVENT' }], 'simvar');
    var result = h('div', { class: 'ps-result', text: 'Enter a variable and press a button.' });

    function say(text, bad) { result.textContent = text; result.className = 'ps-result' + (bad ? ' bad' : ' ok'); PS.log('telemetry', text); }
    function parseValue() {
      var raw = valueIn.value;
      var n = Number(raw);
      return raw !== '' && isFinite(n) ? n : raw;
    }

    var input = ui.panel('Test a variable',
      h('div', { class: 'ps-row' }, ui.field('Name', nameIn), ui.field('Unit', unitIn), ui.field('Value', valueIn), ui.field('Key event method', methodSel.el || methodSel)),
      h('div', { class: 'ps-row' },
        ui.button('Read once', function () {
          var r = PS.getVar(nameIn.value, unitIn.value);
          say(r.ok ? nameIn.value + ' [' + unitIn.value + '] = ' + PS.fmt.value(r.value) : 'read failed: ' + r.error, !r.ok);
        }),
        ui.button('Add to table', function () {
          vars.push({ group: 'Custom', name: nameIn.value, unit: unitIn.value, custom: true });
          buildRows(); say('added ' + nameIn.value);
        }),
        ui.button('Set value (SetSimVarValue)', function () {
          var before = PS.getVar(nameIn.value, unitIn.value);
          var r = PS.setVar(nameIn.value, unitIn.value, parseValue());
          if (!r.ok) { say('set failed: ' + r.error, true); return; }
          setTimeout(function () {
            var after = PS.getVar(nameIn.value, unitIn.value);
            var changed = before.ok && after.ok && before.value !== after.value;
            say('set ' + nameIn.value + ' = ' + parseValue() + ' sent. Before: ' + (before.ok ? PS.fmt.value(before.value) : 'n/a') +
              ', after: ' + (after.ok ? PS.fmt.value(after.value) : 'n/a') + (changed ? ' (changed)' : ' (unchanged: not writable, or applied later)'), !changed);
          }, 300);
        }, 'ps-warn'),
        ui.button('Send as key event', function () {
          var key = nameIn.value.replace(/^K:/, '');
          var r = PS.keyEvent(key, parseValue(), methodSel.value);
          say(r.ok ? 'key event ' + key + ' (' + methodSel.value + ') sent with ' + parseValue() : 'key event failed: ' + r.error, !r.ok);
        }, 'ps-warn')
      ),
      result,
      ui.note('Set value and key events change the sim. A silent no-change after Set usually means the variable is read-only from JS.')
    );

    var rateSel = ui.select([{ value: '100', label: '100 ms' }, { value: '250', label: '250 ms' }, { value: '500', label: '500 ms' }, { value: '1000', label: '1 s' }], '250',
      function () { rateMs = Number(rateSel.value); if (timer !== null) start(); });

    var el = h('div', { class: 'ps-page' },
      ui.panel('Environment and tick behaviour', envLine, hbLine, cycleLine,
        h('div', { class: 'ps-row' }, ui.field('Poll interval', rateSel)),
        ui.note('To test ticking while hidden: leave this page open, switch to another EFB app for 30 s, come back, and read "last hidden period".')),
      input,
      ui.panel('Polled variables', tbl.el),
      ui.panel('Log', ui.logBox(['telemetry', 'heartbeat']))
    );

    buildRows();
    paintStatus();
    return {
      el: el,
      snapshot: function () {
        return vars.map(function (v, i) { return v.name + ' [' + v.unit + '] = ' + (cells[i] ? cells[i].textContent : ''); }).join('\n');
      },
      onShow: function () { cycle(); start(); },
      onHide: function () { stop(); }
    };
  }
});
