// Small UI building blocks shared by the pages (browser only; call from page create functions).

PS.ui = {
  button: function (label, onclick, cls) {
    return PS.h('button', { class: 'ps-btn' + (cls ? ' ' + cls : ''), type: 'button', onclick: onclick, text: label });
  },
  // A button with one of our icons (and a label, if given).
  iconButton: function (icon, label, onclick, cls) {
    var b = PS.h('button', { class: 'ps-btn ps-iconbtn' + (cls ? ' ' + cls : ''), type: 'button', onclick: onclick });
    var svg = PS.icon(icon, 18),
      span = PS.h('span', { class: 'ps-iconbtn-label', text: label || '' });
    if (!label) span.style.display = 'none';
    b.appendChild(svg);
    b.appendChild(span);
    // The label and icon can change later (Pause becomes Resume, Call the tug becomes Dismiss the tug).
    b.setLabel = function (text) {
      if (span.textContent !== text) span.textContent = text;
      span.style.display = text ? '' : 'none';
    };
    b.setIcon = function (name) {
      if (b._iconName === name) return;
      var n = PS.icon(name, 18);
      b.replaceChild(n, svg);
      svg = n;
      b._iconName = name;
    };
    b._iconName = icon;
    return b;
  },
  // A round selector (a ring with a dot in it when on), for picking one item in a list. label is its accessible name.
  radioDot: function (on, label, onclick) {
    var b = PS.h('button', { class: 'ps-radio' + (on ? ' on' : ''), type: 'button', onclick: onclick });
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.appendChild(PS.h('span', { class: 'ps-radio-dot' }));
    return b;
  },
  panel: function (title) {
    var kids = Array.prototype.slice.call(arguments, 1);
    return PS.h('div', { class: 'ps-panel' }, title ? PS.h('div', { class: 'ps-panel-title', text: title }) : null, kids);
  },
  note: function (text, cls) {
    return PS.h('div', { class: 'ps-note' + (cls ? ' ' + cls : ''), text: text });
  },
  field: function (label, input) {
    // A div, not a <label>: a label around a group of buttons can forward a click on any of them to the first one
    // (the first button ended up selected whatever was pressed).
    return PS.h('div', { class: 'ps-field' }, PS.h('span', { class: 'ps-field-label', text: label }), input);
  },
  // Zoom control: [-] current range [+] over a list of numeric steps (metres). Not built on ui.select, so it does not depend on
  // highlight state, and each press is logged (tag = log channel) so a session log shows whether presses arrive at all.
  // Steps go up from the left button to the right one, unless `invert` (the map zoom: the right-hand + zooms in, to a smaller range).
  stepper: function (steps, value, onchange, tag, labels, fmt, invert) {
    var zoomIcons = !labels && invert;
    labels = labels || (invert ? [PS.t('Zoom out') + '  -', PS.t('Zoom in') + '  +'] : [PS.t('Zoom in') + '  -', PS.t('Zoom out') + '  +']);
    fmt = fmt || PS.fmt.dist;
    var idx = Math.max(0, steps.indexOf(value));
    var label = PS.h('span', { class: 'ps-step-label', text: fmt(steps[idx]) });
    function go(delta, which, how) {
      var next = Math.max(0, Math.min(steps.length - 1, idx + delta));
      if (tag) PS.logv(tag, (how || 'button pressed (' + labels[which] + ')') + ': ' + fmt(steps[idx]) + ' -> ' + fmt(steps[next]));
      if (next === idx) return;
      idx = next;
      label.textContent = fmt(steps[idx]);
      if (onchange) onchange(steps[idx]);
    }
    var el = PS.h(
      'div',
      { class: 'ps-stepper' },
      zoomIcons
        ? PS.ui.iconButton('zoomOut', '', function () {
            go(1, 0);
          })
        : PS.ui.button(labels[0], function () {
            go(invert ? 1 : -1, 0);
          }),
      label,
      zoomIcons
        ? PS.ui.iconButton('zoomIn', '', function () {
            go(-1, 1);
          })
        : PS.ui.button(labels[1], function () {
            go(invert ? -1 : 1, 1);
          })
    );
    // zoom(+1) zooms in (a smaller range, for a stepper made with `invert`), zoom(-1) zooms out: for the mouse wheel
    return {
      el: el,
      zoom: function (dir, how) {
        go(dir > 0 ? -1 : 1, dir > 0 ? 1 : 0, how);
      },
      get: function () {
        return steps[idx];
      },
      set: function (v2) {
        idx = Math.max(0, steps.indexOf(v2));
        label.textContent = fmt(steps[idx]);
      }
    };
  },
  // Mouse wheel and trackpad scrolling turned into zoom steps: a notch (about 100) is one step, small trackpad deltas add up to one. Returns a function
  // (deltaY, deltaMode) -> -1 (scroll up: zoom in), +1 (scroll down: zoom out) or 0 for no step yet.
  wheelAccum: function () {
    var acc = 0,
      NOTCH = 50;
    return function (deltaY, deltaMode) {
      var d = Number(deltaY) || 0;
      if (deltaMode === 1) d *= 33;
      else if (deltaMode === 2) d *= 400; // lines or pages
      acc += d;
      if (acc <= -NOTCH) {
        acc = 0;
        return -1;
      }
      if (acc >= NOTCH) {
        acc = 0;
        return 1;
      }
      return 0;
    };
  },
  // Zoom with the wheel over `el` (a canvas): cb(dir, event) with dir +1 = zoom in, -1 = zoom out. The page does not scroll while the pointer is over it.
  wheelZoom: function (el, cb) {
    var accum = PS.ui.wheelAccum(),
      sawWheel = false,
      logged = false;
    function handle(e, deltaY, mode) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      if (!logged) {
        logged = true;
        PS.logv('ui', 'map wheel event received (deltaY ' + Math.round(deltaY) + ', mode ' + mode + '): zooming with the wheel works here');
      }
      var step = accum(deltaY, mode);
      if (step) cb(-step, e);
    }
    el.addEventListener(
      'wheel',
      function (e) {
        sawWheel = true;
        handle(e, e.deltaY, e.deltaMode);
      },
      false
    );
    // older engines only send mousewheel (wheelDelta is the other way round and in steps of 120); skip it once real wheel events arrive
    el.addEventListener(
      'mousewheel',
      function (e) {
        if (!sawWheel) handle(e, -(e.wheelDelta || 0) * 0.8, 0);
      },
      false
    );
  },
  // Segmented toggle. options: [{value,label}], returns { el, get(), set(v) }
  toggle: function (options, value, onchange) {
    var current = value;
    var wrap = PS.h('div', { class: 'ps-toggle' });
    var btns = {};
    function paint() {
      for (var k in btns) {
        btns[k].className = 'ps-toggle-btn' + (k === current ? ' on' : '');
      }
    }
    options.forEach(function (o) {
      btns[o.value] = PS.h('button', {
        type: 'button',
        class: 'ps-toggle-btn',
        text: o.label,
        onclick: function () {
          if (current === o.value) return;
          current = o.value;
          paint();
          if (onchange) onchange(current);
        }
      });
      wrap.appendChild(btns[o.value]);
    });
    paint();
    return {
      el: wrap,
      get: function () {
        return current;
      },
      set: function (v) {
        current = v;
        paint();
      }
    };
  },
  // A small "?" that shows `text` in a card while the pointer is over it (or after a tap, for touch). Keeps explanations off the page.
  help: function (title, text) {
    var pop = PS.h('div', { class: 'ps-help-pop' }, PS.h('div', { class: 'ps-help-title', text: title }));
    (Array.isArray(text) ? text : [text]).forEach(function (t) {
      pop.appendChild(PS.h('div', { class: 'ps-help-line', text: t }));
    });
    pop.style.display = 'none';
    function show(on) {
      pop.style.display = on ? 'block' : 'none';
    }
    var icon = PS.h('span', {
      class: 'ps-help',
      text: '?',
      onmouseenter: function () {
        show(true);
      },
      onmouseleave: function () {
        show(false);
      },
      onclick: function () {
        show(true); // a tap arrives as mouse enter then click: toggling here would open it and shut it again
      }
    });
    icon.appendChild(pop);
    return icon;
  },
  // A scrolling log box that shows entries whose channel is in `channels` (all when omitted).
  // opts: { copy: function () (copies something other than the text shown), label: button text }
  logBox: function (channels, opts) {
    opts = opts || {};
    var box = PS.h('pre', { class: 'ps-log' });
    function match(e) {
      return !channels || channels.indexOf(e.ch) >= 0;
    }
    function render() {
      if (opts.active && !opts.active()) return; // hidden (the Diagnostics panel): not worth redrawing on every line
      var lines = [];
      for (var i = Math.max(0, PS.logs.length - 150); i < PS.logs.length; i++) {
        if (match(PS.logs[i])) lines.push(PS.fmtLog(PS.logs[i]));
      }
      box.textContent = lines.join('\n');
      box.scrollTop = box.scrollHeight;
    }
    PS.logListeners.push(function (e) {
      if (match(e)) render();
    });
    render();
    var copyBtn = PS.ui.iconButton(
      'list',
      opts.label || PS.t('Copy log'),
      function () {
        if (opts.copy) {
          opts.copy();
          return;
        }
        var text = box.textContent;
        var ok = PS.ui.copyText(text);
        PS.log('ui', ok ? 'log copied to clipboard' : 'clipboard copy not available; showing text to select');
        if (!ok) PS.ui.showText(text, 'Log (select all and copy)');
      },
      'ps-small'
    );
    var buttons = [copyBtn];
    if (opts.clearable) {
      buttons.push(
        PS.ui.iconButton(
          'trash',
          PS.t('Clear logs'),
          function () {
            var n = PS.logs.length;
            PS.logs.length = 0;
            render();
            PS.log('ui', 'logs cleared (' + n + ' lines)');
          },
          'ps-small ps-ghost'
        )
      );
    }
    var bar = PS.h('div', { class: 'ps-btnrow' }, buttons);
    var wrap = opts.buttonsAbove ? PS.h('div', { class: 'ps-logwrap' }, bar, box) : PS.h('div', { class: 'ps-logwrap' }, box, bar);
    wrap.refresh = render;
    return wrap;
  }
};

// Copies text to the clipboard. Returns true only if the browser says it worked.

// Our own icons: inline SVG drawn with the current text colour, so they do not depend on any font in the sim. The shapes live as real SVG files in
// src/icons/ (kebab-case file name, e.g. arrow-up.svg -> 'arrowUp'); build.mjs puts them into PS.ICONS as lists of path strings on a 24 x 24 grid,
// where a path starting with '#' is filled and the others are stroked lines.
// Size: the sim's own stylesheet can stretch an <svg> to fill its container (it did: the icons filled the buttons), so the size is also set in the
// element's style with !important. Colour: not 'currentColor' (it came out black or white in the sim whatever the button's colour was) but the
// theme's button text colour, set by the stylesheet (.ps-ip / .ps-ipf, which follow the theme) and, as a fallback, on the element.
PS.icon = function (name, size, color) {
  var NS = 'http://www.w3.org/2000/svg',
    paths = PS.ICONS[name] || [],
    px = size || 18;
  var col = color || (PS.theme ? PS.theme.c('buttonText') : '#ffffff');
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'ps-icon');
  svg.setAttribute(
    'style',
    'width:' +
      px +
      'px!important;height:' +
      px +
      'px!important;min-width:' +
      px +
      'px!important;max-width:' +
      px +
      'px!important;min-height:' +
      px +
      'px!important;max-height:' +
      px +
      'px!important;flex:none;display:inline-block'
  );
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  paths.forEach(function (d) {
    var el = document.createElementNS(NS, 'path'),
      filled = d.charAt(0) === '#';
    el.setAttribute('d', filled ? d.slice(1) : d);
    if (filled) {
      el.setAttribute('class', color ? '' : 'ps-ipf');
      el.setAttribute('fill', col);
      el.setAttribute('stroke', 'none');
    } else {
      el.setAttribute('class', color ? '' : 'ps-ip');
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', col);
    }
    svg.appendChild(el);
  });
  return svg;
};

PS.ui.copyText = function (text) {
  try {
    var ta = PS.h('textarea', { style: 'position:fixed;left:-1000px;top:0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
};

// Fallback when the clipboard is blocked: a full-screen overlay with the text selected, ready for manual copy.
PS.ui.showText = function (text, title) {
  var host = PS.rootEl || document.body;
  var ta = PS.h('textarea', { class: 'ps-overlay-text', readonly: true });
  ta.value = text;
  var overlay = PS.h(
    'div',
    { class: 'ps-overlay' },
    PS.h(
      'div',
      { class: 'ps-overlay-bar' },
      PS.h('span', { class: 'ps-panel-title', text: title || 'Text' }),
      PS.ui.button(
        PS.t('Select all'),
        function () {
          ta.focus();
          ta.select();
        },
        'ps-small'
      ),
      PS.ui.button(
        PS.t('Close'),
        function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        },
        'ps-small ps-ghost'
      )
    ),
    ta
  );
  host.appendChild(overlay);
  ta.focus();
  ta.select();
};
