// The Colours section of the Settings page: a PS.t("Themes") tab (pick a preset from cards that show the colours) and a PS.t("My colours") tab (set any colour
// the app uses: tap a swatch for a palette, or type a hex value). Both change the whole app live through PS.theme.

PS.themePreview = function (tokens, w, hgt) {
  w = w || 132;
  hgt = hgt || 80;
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 132 80');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(hgt));
  svg.setAttribute(
    'style',
    'width:' +
      w +
      'px!important;height:' +
      hgt +
      'px!important;max-width:' +
      w +
      'px!important;max-height:' +
      hgt +
      'px!important;display:block'
  );
  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, String(attrs[k]));
    svg.appendChild(e);
    return e;
  }
  el('rect', { x: 0, y: 0, width: 132, height: 80, rx: 8, fill: tokens.bg });
  el('rect', { x: 0, y: 0, width: 132, height: 15, rx: 8, fill: tokens.bgDeep });
  el('rect', { x: 0, y: 8, width: 132, height: 7, fill: tokens.bgDeep });
  el('rect', { x: 8, y: 4, width: 20, height: 8, rx: 3, fill: tokens.accent });
  el('rect', { x: 32, y: 4, width: 18, height: 8, rx: 3, fill: tokens.button });
  el('rect', { x: 54, y: 4, width: 18, height: 8, rx: 3, fill: tokens.button });
  // a panel with a title, text and a button
  el('rect', { x: 7, y: 21, width: 56, height: 52, rx: 5, fill: tokens.panel, stroke: tokens.border, 'stroke-width': 1 });
  el('rect', { x: 12, y: 26, width: 26, height: 4, rx: 2, fill: tokens.accent });
  el('rect', { x: 12, y: 35, width: 44, height: 3, rx: 1.5, fill: tokens.text });
  el('rect', { x: 12, y: 42, width: 34, height: 3, rx: 1.5, fill: tokens.textDim });
  el('rect', { x: 12, y: 51, width: 22, height: 9, rx: 3, fill: tokens.button });
  el('rect', { x: 37, y: 51, width: 20, height: 9, rx: 3, fill: tokens.accent });
  el('circle', { cx: 16, cy: 67, r: 2.5, fill: tokens.good });
  el('circle', { cx: 24, cy: 67, r: 2.5, fill: tokens.warn });
  el('circle', { cx: 32, cy: 67, r: 2.5, fill: tokens.bad });
  // a bit of map with the three kinds of route, a taxiway and the aircraft
  el('rect', { x: 68, y: 21, width: 57, height: 52, rx: 5, fill: tokens.mapBg, stroke: tokens.mapGrid, 'stroke-width': 1 });
  el('path', { d: 'M72 66 L120 36', stroke: tokens.taxiway, 'stroke-width': 2, fill: 'none' });
  el('path', { d: 'M80 70 L80 50 Q80 42 90 42', stroke: tokens.routeBack, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' });
  el('path', { d: 'M90 42 L112 42', stroke: tokens.routeFwd, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' });
  el('path', { d: 'M96 70 L116 62', stroke: tokens.routeBad, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' });
  el('circle', { cx: 80, cy: 70, r: 3.5, fill: tokens.aircraft });
  el('circle', { cx: 112, cy: 42, r: 3, fill: tokens.pinEnd });
  return svg;
};

// A grid of colours to pick from: hues across, lightness down, then greys. onPick(hex).
PS.colourGrid = function (onPick) {
  function hsl(hu, sa, li) {
    sa /= 100;
    li /= 100;
    var c = (1 - Math.abs(2 * li - 1)) * sa,
      x = c * (1 - Math.abs(((hu / 60) % 2) - 1)),
      m = li - c / 2,
      r = 0,
      g = 0,
      b = 0;
    if (hu < 60) {
      r = c;
      g = x;
    } else if (hu < 120) {
      r = x;
      g = c;
    } else if (hu < 180) {
      g = c;
      b = x;
    } else if (hu < 240) {
      g = x;
      b = c;
    } else if (hu < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return PS.theme.hex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }
  var grid = PS.h('div', { class: 'ps-cgrid' });
  function swatch(hexv) {
    grid.appendChild(
      PS.h('button', {
        type: 'button',
        class: 'ps-cswatch',
        style: 'background:' + hexv,
        title: hexv,
        onclick: function () {
          onPick(hexv);
        }
      })
    );
  }
  [18, 30, 42, 55, 68, 80].forEach(function (li) {
    for (var hu = 0; hu < 360; hu += 30) swatch(hsl(hu, 78, li));
  });
  [4, 12, 20, 30, 42, 55, 68, 80, 90, 96, 100].forEach(function (li) {
    swatch(hsl(0, 0, li));
  });
  return grid;
};

PS.colourPanel = function () {
  var ui = PS.ui,
    h = PS.h,
    T = PS.theme;
  var tabs = ui.toggle(
    [
      { value: 'themes', label: PS.t('Themes') },
      { value: 'custom', label: PS.t('My colours') }
    ],
    'themes',
    function (v) {
      show(v);
    }
  );
  var themesBox = h('div'),
    customBox = h('div');
  var editing = false,
    openRole = null,
    switchWarned = null, // the theme card whose switch was warned about (unsaved colours)
    deleteArmed = null; // the saved file whose Delete was tapped once

  // ---------- Themes ----------
  function renderThemes() {
    PS.clear(themesBox);
    themesBox.appendChild(
      ui.note(
        PS.t(
          "Airline themes are inspired by those liveries: the colours are approximate, and Push Planner is not affiliated with or endorsed by any airline. Pick one, then change any colour on the My colours tab and save it: saved themes show here too, as do the package's theme files."
        )
      )
    );
    var grid = h('div', { class: 'ps-themegrid' });
    T.THEMES.forEach(function (th) {
      var on = T.selectedId() === th.id;
      var tokens = T.derive(T.fillRoles(th.p));
      var card = h(
        'button',
        {
          type: 'button',
          class: 'ps-themecard' + (on ? ' on' : ''),
          title: th.note,
          onclick: function () {
            // Choosing a theme throws away colours changed by hand and not saved: the first tap warns, a second tap on the same card goes ahead.
            if (T.hasUnsaved() && switchWarned !== th.id) {
              switchWarned = th.id;
              PS.toasts.show({
                kind: 'info',
                title: PS.t('Unsaved colours'),
                message: PS.t(
                  'Switching to {name} discards the colours you changed. Tap it again to switch, or save them first on My colours.',
                  {
                    name: th.name
                  }
                ),
                ttlMs: 5000
              });
              return;
            }
            switchWarned = null;
            T.select(th.id);
            PS.logv('settings', 'theme: ' + th.name);
          }
        },
        PS.themePreview(tokens),
        h('div', { class: 'ps-themename', text: th.name }),
        h('div', { class: 'ps-themenote', text: (th.fromFile ? PS.t('file: ') : '') + (th.fromSaved ? PS.t('saved: ') : '') + th.note })
      );
      grid.appendChild(card);
    });
    themesBox.appendChild(grid);
    var sv = T.savedStatus();
    themesBox.appendChild(
      h('div', {
        class: 'ps-kv',
        text:
          sv.state === 'done'
            ? PS.t("Saved themes: {n} file(s) in the files module's work folder", { n: sv.count }) +
              (sv.failed.length
                ? PS.t('. Not read: {list}', {
                    list: sv.failed
                      .map(function (f) {
                        return f.file + ' (' + f.why + ')';
                      })
                      .join(', ')
                  })
                : '')
            : sv.state === 'failed'
              ? PS.t("Files module not found: saved themes use the app's own storage")
              : sv.state === 'loading'
                ? PS.t('Reading saved themes...')
                : ''
      })
    );
  }

  // ---------- My colours ----------
  var saveMsg = h('div', { class: 'ps-kv', text: '' }),
    saveName = 'My theme',
    nameTouched = false;
  function renderCustom() {
    PS.clear(customBox);
    var warns = T.contrastWarnings();
    if (warns.length)
      customBox.appendChild(
        h('div', {
          class: 'ps-result bad',
          text: PS.t('Hard to read: {list}.', {
            list: warns
              .map(function (w) {
                return PS.t('{name} (contrast {r}:1)', { name: PS.t(w.name), r: w.ratio.toFixed(1) });
              })
              .join('; ')
          })
        })
      );
    T.ROLE_GROUPS.forEach(function (g) {
      customBox.appendChild(h('div', { class: 'ps-colgroup', text: PS.t(g.title) }));
      g.roles.forEach(function (r) {
        var role = r[0],
          cur = T.c(role),
          changed = T.isChanged(role);
        var swatch = h('button', {
          type: 'button',
          class: 'ps-colswatch',
          style: 'background:' + cur,
          title: PS.t('Pick a colour'),
          onclick: function () {
            openRole = openRole === role ? null : role;
            renderCustom();
          }
        });
        var input = h('input', { type: 'text', class: 'ps-input ps-hex', value: cur });
        function commit(final) {
          var v = input.value.trim();
          if (v.charAt(0) !== '#') v = '#' + v;
          if (!T.isHex(v)) {
            if (final) input.value = T.c(role);
            return;
          }
          if (!final && v.length !== 7) return;
          editing = true;
          T.setColour(role, v);
          editing = false;
          swatch.style.background = T.c(role);
        }
        input.addEventListener('input', function () {
          commit(false);
        });
        input.addEventListener('change', function () {
          commit(true);
          renderCustom();
        });
        var reset = ui.button(
          PS.t('Reset'),
          function () {
            T.resetColour(role);
            PS.logv('settings', 'colour ' + role + ' reset');
          },
          'ps-small ps-ghost'
        );
        reset.disabled = !changed;
        customBox.appendChild(
          h(
            'div',
            { class: 'ps-colrow' + (changed ? ' changed' : '') },
            h('div', { class: 'ps-collabel', text: PS.t(r[1]) }),
            swatch,
            input,
            reset
          )
        );
        if (openRole === role) {
          customBox.appendChild(
            PS.colourGrid(function (hexv) {
              T.setColour(role, hexv);
              PS.logv('settings', 'colour ' + role + ' = ' + hexv);
            })
          );
        }
      });
    });
    // The map's line widths and label size, in pixels: part of the theme, set here and saved with it.
    customBox.appendChild(h('div', { class: 'ps-colgroup', text: PS.t('Map lines (pixels)') }));
    var range = function (a, b, s) {
      var o = [];
      for (var i = a; i <= b; i += s) o.push(i);
      return o;
    };
    [
      ['unnamed', PS.tt('Unnamed paths'), range(1, 10, 1)],
      ['named', PS.tt('Named taxiways'), range(2, 20, 1)],
      ['runway', PS.tt('Runways'), range(4, 60, 2)],
      ['label', PS.tt('Label size'), range(10, 26, 1)],
      ['gap', PS.tt('Gap round labels'), range(0, 20, 1)]
    ].forEach(function (m) {
      var st = ui.stepper(
        m[2],
        T.mapStyle()[m[0]],
        function (v) {
          T.setMapValue(m[0], v);
        },
        null,
        ['-', '+'],
        function (v) {
          return v + ' px';
        }
      );
      customBox.appendChild(h('div', { class: 'ps-colrow' }, h('div', { class: 'ps-collabel', text: PS.t(m[1]) }), st.el));
    });
    customBox.appendChild(
      ui.button(
        PS.t('Reset map lines'),
        function () {
          T.resetMap();
        },
        'ps-small ps-ghost'
      )
    );
    // Save the colours in use as a theme: a .json file named after it in the files module's work folder (or the app's own storage if that module is not there).
    var cur = T.byId(T.selectedId());
    if ((cur.fromSlot || cur.fromSaved) && !nameTouched) saveName = cur.name;
    customBox.appendChild(h('div', { class: 'ps-colgroup', text: PS.t('Save these colours as a theme') }));
    var nameInput = h('input', { type: 'text', class: 'ps-input ps-themename-input', value: saveName, placeholder: PS.t('Theme name') });
    nameInput.addEventListener('input', function () {
      saveName = nameInput.value;
      nameTouched = true;
    });
    var saveBtn = ui.iconButton(
      'check',
      PS.t('Save theme'),
      function () {
        saveMsg.textContent = PS.t('Saving...');
        T.saveTheme(nameInput.value, function (r) {
          nameTouched = false;
          if (!r.ok) {
            saveMsg.textContent = r.why || PS.t('Could not save.');
            return;
          }
          saveMsg.textContent = '';
          PS.toasts.show({
            kind: 'info',
            title: PS.t('Theme saved'),
            ttlMs: 3000,
            message:
              r.where === 'file'
                ? PS.t('{file} is in the push-planner work folder.', { file: r.file })
                : PS.t("Kept in the app's own storage (slot {n}); install PusherFiles.wasm to save real files.", { n: r.slot })
          });
        });
      },
      'ps-small'
    );
    customBox.appendChild(h('div', { class: 'ps-btnrow' }, nameInput, saveBtn));
    var actions = h(
      'div',
      { class: 'ps-btnrow' },
      ui.button(
        PS.t('Reset all my colours'),
        function () {
          T.resetAll();
          PS.logv('settings', 'all custom colours reset');
        },
        'ps-small ps-ghost'
      )
    );
    if (cur.fromSaved) {
      actions.appendChild(
        ui.iconButton(
          'trash',
          PS.t('Delete {name}', { name: cur.fromSaved }),
          function () {
            if (deleteArmed !== cur.fromSaved) {
              // a file cannot be got back: the first tap asks, a second tap on the same file deletes it
              deleteArmed = cur.fromSaved;
              saveMsg.textContent = PS.t('Tap Delete again to remove {name} for good.', { name: cur.fromSaved });
              setTimeout(function () {
                if (deleteArmed === cur.fromSaved) {
                  deleteArmed = null;
                  saveMsg.textContent = '';
                }
              }, 4000);
              return;
            }
            deleteArmed = null;
            saveMsg.textContent = PS.t('Deleting...');
            T.deleteSaved(cur.fromSaved, function (r) {
              if (r.ok) {
                saveMsg.textContent = '';
                PS.toasts.show({
                  kind: 'info',
                  title: PS.t('Theme deleted'),
                  message: PS.t('{name} was removed.', { name: cur.fromSaved }),
                  ttlMs: 3000
                });
              } else saveMsg.textContent = PS.t('Could not delete: {why}', { why: r.why || PS.t('unknown') });
            });
          },
          'ps-small ps-ghost'
        )
      );
    }
    if (cur.fromSlot) {
      actions.appendChild(
        ui.button(
          PS.t('Clear slot {n}', { n: cur.fromSlot }),
          function () {
            var nn = cur.fromSlot;
            T.clearSlot(nn);
            saveMsg.textContent = PS.t('Slot {n} cleared.', { n: nn });
            PS.logv('settings', 'theme slot ' + nn + ' cleared');
          },
          'ps-small ps-ghost'
        )
      );
    }
    customBox.appendChild(actions);
    customBox.appendChild(saveMsg);
    customBox.appendChild(
      h(
        'div',
        { class: 'ps-btnrow' },
        h('span', { class: 'ps-note', text: PS.t('Where saved themes are kept') }),
        ui.help(PS.t('Saved themes'), T.workFolderLines)
      )
    );
  }

  function show(which) {
    themesBox.style.display = which === 'themes' ? '' : 'none';
    customBox.style.display = which === 'custom' ? '' : 'none';
    if (tabs.get() !== which) tabs.set(which);
  }

  T.onChange(function () {
    renderThemes();
    if (!editing) renderCustom();
  });
  renderThemes();
  renderCustom();
  show('themes');
  return ui.panel(PS.t('Colours'), tabs.el, themesBox, customBox);
};
