// The Diagnostics panel (opened from a button at the foot of the Settings tab): the checks from diag/checks.js, the detailed-logging switch and the log.
// It is built the first time it is opened, so a normal session carries none of it (and the log is not redrawn on every line while it is hidden).

PS.diagPanel = function () {
  var ui = PS.ui,
    h = PS.h;
  var rows = {},
    busy = false,
    visible = false;

  function setBusy(on) {
    busy = on;
    ui.setEnabled(runAll, !on, PS.t('A check is running.'));
    PS.diag.CHECKS.forEach(function (c) {
      ui.setEnabled(rows[c.id].btn, !on, PS.t('A check is running.'));
    });
  }
  function show(id, r) {
    var row = rows[id];
    row.pill.className = 'ps-pill ' + (r.status === 'ok' ? 'ok' : r.status === 'warn' ? 'warn' : 'bad');
    row.pill.textContent = PS.t(PS.diag.STATUS_WORD[r.status]);
    row.text.textContent = r.text;
  }
  function runOne(id) {
    if (busy) return;
    setBusy(true);
    rows[id].pill.className = 'ps-pill';
    rows[id].pill.textContent = PS.t('running');
    PS.diag.run(id).then(function (r) {
      show(id, r);
      setBusy(false);
    });
  }
  function runEvery() {
    if (busy) return;
    setBusy(true);
    PS.diag.CHECKS.forEach(function (c) {
      rows[c.id].pill.className = 'ps-pill';
      rows[c.id].pill.textContent = PS.t('waiting');
      rows[c.id].text.textContent = '';
    });
    PS.diag
      .runAll(function (r) {
        show(r.id, r);
        var next = PS.diag.CHECKS.filter(function (c) {
          return rows[c.id].pill.textContent === PS.t('waiting');
        })[0];
        if (next) rows[next.id].pill.textContent = PS.t('running');
      })
      .then(function () {
        setBusy(false);
      });
  }

  var runAll = ui.button(PS.t('Run all checks'), runEvery);
  var list = h('div');
  PS.diag.CHECKS.forEach(function (c) {
    var pill = h('span', { class: 'ps-pill', text: PS.t('not run') });
    var text = h('div', { class: 'ps-note ps-diagtext', text: '' });
    var btn = ui.button(
      PS.t('Run'),
      function () {
        runOne(c.id);
      },
      'ps-small ps-ghost'
    );
    rows[c.id] = { pill: pill, text: text, btn: btn };
    list.appendChild(
      h(
        'div',
        { class: 'ps-diagrow' },
        h('div', { class: 'ps-diaghead' }, h('b', { text: PS.t(c.title) }), pill, btn),
        h('div', { class: 'ps-note', text: PS.t(c.what) }),
        text
      )
    );
  });

  var detail = ui.toggle(
    [
      { value: 'off', label: PS.t('Normal logging') },
      { value: 'on', label: PS.t('Detailed logging') }
    ],
    PS.detail.on ? 'on' : 'off',
    function (v) {
      PS.detail.on = v === 'on';
      PS.log('diag', 'detailed logging ' + (PS.detail.on ? 'on' : 'off'));
    }
  );
  var log = ui.logBox(null, {
    copy: function () {
      PS.copyAllLogs();
    },
    label: PS.t('Copy all logs'),
    clearable: true,
    buttonsAbove: true,
    active: function () {
      return visible;
    }
  });

  var el = h(
    'div',
    { class: 'ps-panel' },
    h('div', { class: 'ps-panel-title', text: PS.t('Diagnostics') }),
    ui.note(
      PS.t(
      'Each check looks at one part of what the app depends on and logs what it finds. They only read from the sim: nothing is attached, set or sent. Run them, then copy the logs to report a problem.'
      )
    ),
    h('div', { class: 'ps-btnrow' }, runAll),
    list,
    ui.field(PS.t('While nothing is being checked'), detail.el),
    ui.note(
      PS.t(
      'Normal logging keeps what happened and what went wrong. Detailed logging also keeps the fine print (every setting change, the route and pin workings, the airport search, the traffic feed). A check turns it on by itself while it runs.'
      )
    ),
    log
  );

  return {
    el: el,
    show: function () {
      visible = true;
      el.style.display = '';
      log.refresh();
    },
    hide: function () {
      visible = false;
      el.style.display = 'none';
    }
  };
};
