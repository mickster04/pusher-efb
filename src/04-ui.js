// Small UI building blocks shared by the pages (browser only; call from page create functions).

PS.ui = {
  button: function (label, onclick, cls) {
    return PS.h('button', { class: 'ps-btn' + (cls ? ' ' + cls : ''), type: 'button', onclick: onclick, text: label });
  },
  panel: function (title) {
    var kids = Array.prototype.slice.call(arguments, 1);
    return PS.h('div', { class: 'ps-panel' }, title ? PS.h('div', { class: 'ps-panel-title', text: title }) : null, kids);
  },
  note: function (text, cls) { return PS.h('div', { class: 'ps-note' + (cls ? ' ' + cls : ''), text: text }); },
  field: function (label, input) {
    return PS.h('label', { class: 'ps-field' }, PS.h('span', { class: 'ps-field-label', text: label }), input);
  },
  input: function (value, attrs) {
    var a = attrs || {};
    a.class = 'ps-input' + (a.class ? ' ' + a.class : '');
    a.type = a.type || 'text';
    a.value = value;
    var el = PS.h('input', a);
    el.value = value;
    return el;
  },
  select: function (options, value, onchange) {
    var sel = PS.h('select', { class: 'ps-input', onchange: onchange });
    options.forEach(function (o) {
      var opt = PS.h('option', { value: o.value, text: o.label });
      sel.appendChild(opt);
    });
    sel.value = value;
    return sel;
  },
  // Segmented toggle. options: [{value,label}], returns { el, get(), set(v) }
  toggle: function (options, value, onchange) {
    var current = value;
    var wrap = PS.h('div', { class: 'ps-toggle' });
    var btns = {};
    function paint() {
      for (var k in btns) { btns[k].className = 'ps-toggle-btn' + (k === current ? ' on' : ''); }
    }
    options.forEach(function (o) {
      btns[o.value] = PS.h('button', { type: 'button', class: 'ps-toggle-btn', text: o.label, onclick: function () {
        if (current === o.value) return;
        current = o.value; paint(); if (onchange) onchange(current);
      } });
      wrap.appendChild(btns[o.value]);
    });
    paint();
    return { el: wrap, get: function () { return current; }, set: function (v) { current = v; paint(); } };
  },
  // A scrolling log box that shows entries whose channel is in `channels` (all when omitted).
  logBox: function (channels) {
    var box = PS.h('pre', { class: 'ps-log' });
    function match(e) { return !channels || channels.indexOf(e.ch) >= 0; }
    function render() {
      var lines = [];
      for (var i = Math.max(0, PS.logs.length - 150); i < PS.logs.length; i++) {
        if (match(PS.logs[i])) lines.push(PS.fmtLog(PS.logs[i]));
      }
      box.textContent = lines.join('\n');
      box.scrollTop = box.scrollHeight;
    }
    PS.logListeners.push(function (e) { if (match(e)) render(); });
    render();
    var wrap = PS.h('div', { class: 'ps-logwrap' },
      box,
      PS.ui.button('Copy log', function () {
        var text = box.textContent;
        try {
          var ta = PS.h('textarea', { style: 'position:fixed;left:-1000px;top:0' });
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
          PS.log('ui', 'log copied to clipboard');
        } catch (e) { PS.log('ui', 'copy failed: ' + PS.errText(e)); }
      }, 'ps-small')
    );
    return wrap;
  },
  table: function (headers) {
    var thead = PS.h('thead', null, PS.h('tr', null, headers.map(function (t) { return PS.h('th', { text: t }); })));
    var tbody = PS.h('tbody');
    var table = PS.h('table', { class: 'ps-table' }, thead, tbody);
    return { el: PS.h('div', { class: 'ps-tablewrap' }, table), body: tbody };
  }
};
