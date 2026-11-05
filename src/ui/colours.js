// The Colours section of the Settings page: a "Themes" tab (pick a preset from cards that show the colours) and a "My colours" tab (set any colour
// the app uses: tap a swatch for a palette, or type a hex value). Both change the whole app live through PS.theme.

PS.themePreview = function (tokens, w, hgt) {
  w = w || 132; hgt = hgt || 80;
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 132 80'); svg.setAttribute('width', String(w)); svg.setAttribute('height', String(hgt));
  svg.setAttribute('style', 'width:' + w + 'px!important;height:' + hgt + 'px!important;max-width:' + w + 'px!important;max-height:' + hgt + 'px!important;display:block');
  function el(name, attrs) { var e = document.createElementNS(NS, name); for (var k in attrs) e.setAttribute(k, String(attrs[k])); svg.appendChild(e); return e; }
  el('rect', { x: 0, y: 0, width: 132, height: 80, rx: 8, fill: tokens.bg });
  el('rect', { x: 0, y: 0, width: 132, height: 15, rx: 8, fill: tokens.bgDeep }); el('rect', { x: 0, y: 8, width: 132, height: 7, fill: tokens.bgDeep });
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
  el('circle', { cx: 16, cy: 67, r: 2.5, fill: tokens.good }); el('circle', { cx: 24, cy: 67, r: 2.5, fill: tokens.warn }); el('circle', { cx: 32, cy: 67, r: 2.5, fill: tokens.bad });
  // a bit of map with the three kinds of route, a taxiway and the aircraft
  el('rect', { x: 68, y: 21, width: 57, height: 52, rx: 5, fill: tokens.mapBg, stroke: tokens.mapGrid, 'stroke-width': 1 });
  el('path', { d: 'M72 66 L120 36', stroke: tokens.taxiway, 'stroke-width': 2, fill: 'none' });
  el('path', { d: 'M80 70 L80 50 Q80 42 90 42', stroke: tokens.routeBack, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' });
  el('path', { d: 'M90 42 L112 42', stroke: tokens.routeFwd, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' });
  el('path', { d: 'M96 70 L116 62', stroke: tokens.routeBad, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' });
  el('circle', { cx: 80, cy: 70, r: 3.5, fill: tokens.aircraft }); el('circle', { cx: 112, cy: 42, r: 3, fill: tokens.pinEnd });
  return svg;
};

// A grid of colours to pick from: hues across, lightness down, then greys. onPick(hex).
PS.colourGrid = function (onPick) {
  function hsl(hu, sa, li) {
    sa /= 100; li /= 100;
    var c = (1 - Math.abs(2 * li - 1)) * sa, x = c * (1 - Math.abs((hu / 60) % 2 - 1)), m = li - c / 2, r = 0, g = 0, b = 0;
    if (hu < 60) { r = c; g = x; } else if (hu < 120) { r = x; g = c; } else if (hu < 180) { g = c; b = x; } else if (hu < 240) { g = x; b = c; } else if (hu < 300) { r = x; b = c; } else { r = c; b = x; }
    return PS.theme.hex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }
  var grid = PS.h('div', { class: 'ps-cgrid' });
  function swatch(hexv) {
    grid.appendChild(PS.h('button', { type: 'button', class: 'ps-cswatch', style: 'background:' + hexv, title: hexv, onclick: function () { onPick(hexv); } }));
  }
  [18, 30, 42, 55, 68, 80].forEach(function (li) {
    for (var hu = 0; hu < 360; hu += 30) swatch(hsl(hu, 78, li));
  });
  [4, 12, 20, 30, 42, 55, 68, 80, 90, 96, 100].forEach(function (li) { swatch(hsl(0, 0, li)); });
  return grid;
};

PS.colourPanel = function () {
  var ui = PS.ui, h = PS.h, T = PS.theme;
  var tabs = ui.toggle([{ value: 'themes', label: 'Themes' }, { value: 'custom', label: 'My colours' }], 'themes', function (v) { show(v); });
  var themesBox = h('div'), customBox = h('div');
  var editing = false, openRole = null;

  // ---------- Themes ----------
  function renderThemes() {
    PS.clear(themesBox);
    var grid = h('div', { class: 'ps-themegrid' });
    T.THEMES.forEach(function (th) {
      var on = T.selectedId() === th.id;
      var tokens = T.derive(T.fillRoles(th.p));
      var card = h('button', { type: 'button', class: 'ps-themecard' + (on ? ' on' : ''), title: th.note, onclick: function () {
        T.select(th.id); PS.log('settings', 'theme: ' + th.name);
      } }, PS.themePreview(tokens), h('div', { class: 'ps-themename', text: th.name }), h('div', { class: 'ps-themenote', text: (th.fromFile ? 'file: ' : '') + (th.fromSaved ? 'saved: ' : '') + th.note }));
      grid.appendChild(card);
    });
    themesBox.appendChild(grid);
    themesBox.appendChild(ui.note('Airline themes are inspired by those liveries (approximate colours, not official). Pick one, then change any colour on the My colours tab and save it: saved themes show here too, as do the package\'s theme files.'));
    var sv = T.savedStatus();
    themesBox.appendChild(h('div', { class: 'ps-kv', text: sv.state === 'done' ? 'Saved themes: ' + sv.count + ' file(s) in the files module\'s work folder' + (sv.failed.length ? '. Not read: ' + sv.failed.map(function (f) { return f.file + ' (' + f.why + ')'; }).join(', ') : '') : sv.state === 'failed' ? 'Files module not found: saved themes use the app\'s own storage' : sv.state === 'loading' ? 'Reading saved themes...' : '' }));
    // Theme files in the package: what was read, and a button to read them again (after editing them).
    var fs = T.fileStatus();
    var status = fs.state === 'loading' ? 'Reading theme files...'
      : fs.state === 'done' ? 'Theme files: ' + fs.loaded + ' of ' + (fs.listed - fs.empty) + ' read from the package' + (fs.empty ? ', ' + fs.empty + ' free slots (user1.json to user' + fs.empty + '.json)' : '') + (fs.added ? ', ' + fs.added + ' new' : '') + (fs.failed.length ? '. Not read: ' + fs.failed.map(function (f) { return f.file + ' (' + f.why + ')'; }).join(', ') : '')
      : fs.state === 'failed' ? 'Theme files could not be read (' + (fs.failed[0] ? fs.failed[0].file + ' ' + fs.failed[0].why : 'unknown') + '): using the built-in themes'
      : 'Theme files not read yet';
    themesBox.appendChild(h('div', { class: 'ps-btnrow' }, ui.iconButton('swap', 'Reload theme files', function () { T.loadFiles(); }, 'ps-small ps-ghost'), h('div', { class: 'ps-kv', text: status })));
  }

  // ---------- My colours ----------
  var saveMsg = h('div', { class: 'ps-kv', text: '' }), saveName = 'My theme', nameTouched = false;
  function renderCustom() {
    PS.clear(customBox);
    var warns = T.contrastWarnings();
    if (warns.length) customBox.appendChild(h('div', { class: 'ps-result bad', text: 'Hard to read: ' + warns.map(function (w) { return w.name + ' (contrast ' + w.ratio.toFixed(1) + ':1)'; }).join('; ') + '.' }));
    T.ROLE_GROUPS.forEach(function (g) {
      customBox.appendChild(h('div', { class: 'ps-colgroup', text: g.title }));
      g.roles.forEach(function (r) {
        var role = r[0], cur = T.c(role), changed = T.isChanged(role);
        var swatch = h('button', { type: 'button', class: 'ps-colswatch', style: 'background:' + cur, title: 'Pick a colour', onclick: function () { openRole = openRole === role ? null : role; renderCustom(); } });
        var input = h('input', { type: 'text', class: 'ps-input ps-hex', value: cur });
        function commit(final) {
          var v = input.value.trim();
          if (v.charAt(0) !== '#') v = '#' + v;
          if (!T.isHex(v)) { if (final) input.value = T.c(role); return; }
          if (!final && v.length !== 7) return;
          editing = true; T.setColour(role, v); editing = false;
          swatch.style.background = T.c(role);
        }
        input.addEventListener('input', function () { commit(false); });
        input.addEventListener('change', function () { commit(true); renderCustom(); });
        var reset = ui.button('Reset', function () { T.resetColour(role); PS.log('settings', 'colour ' + role + ' reset'); }, 'ps-small ps-ghost');
        reset.disabled = !changed;
        customBox.appendChild(h('div', { class: 'ps-colrow' + (changed ? ' changed' : '') }, h('div', { class: 'ps-collabel', text: r[1] }), swatch, input, reset));
        if (openRole === role) {
          customBox.appendChild(PS.colourGrid(function (hexv) { T.setColour(role, hexv); PS.log('settings', 'colour ' + role + ' = ' + hexv); }));
        }
      });
    });
    // Save the colours in use as a theme: a .json file named after it in the files module's work folder (or the app's own storage if that module is not there).
    var cur = T.byId(T.selectedId());
    if ((cur.fromSlot || cur.fromSaved) && !nameTouched) saveName = cur.name;
    customBox.appendChild(h('div', { class: 'ps-colgroup', text: 'Save these colours as a theme' }));
    var nameInput = h('input', { type: 'text', class: 'ps-input ps-themename-input', value: saveName, placeholder: 'Theme name' });
    nameInput.addEventListener('input', function () { saveName = nameInput.value; nameTouched = true; });
    var saveBtn = ui.iconButton('check', 'Save theme', function () {
      saveMsg.textContent = 'Saving...';
      T.saveTheme(nameInput.value, function (r) {
        nameTouched = false;
        if (!r.ok) { saveMsg.textContent = r.why || 'Could not save.'; return; }
        saveMsg.textContent = r.where === 'file'
          ? 'Saved as ' + r.file + ' in the folder ' + r.folder + ' (a Steam install keeps it elsewhere: search for pusher-probe.txt).'
          : 'The files module is not installed, so the theme was kept in the app\'s own storage (slot ' + r.slot + '). Install PusherFiles.wasm to save real files.';
      });
    }, 'ps-small');
    customBox.appendChild(h('div', { class: 'ps-btnrow' }, nameInput, saveBtn));
    var actions = h('div', { class: 'ps-btnrow' },
      ui.button('Reset all my colours', function () { T.resetAll(); PS.log('settings', 'all custom colours reset'); }, 'ps-small ps-ghost'));
    if (cur.fromSaved) {
      actions.appendChild(ui.iconButton('trash', 'Delete ' + cur.fromSaved, function () {
        saveMsg.textContent = 'Deleting...';
        T.deleteSaved(cur.fromSaved, function (r) { saveMsg.textContent = r.ok ? 'Deleted ' + cur.fromSaved + '.' : 'Could not delete: ' + (r.why || 'unknown'); });
      }, 'ps-small ps-ghost'));
    }
    if (cur.fromSlot) {
      actions.appendChild(ui.button('Clear slot ' + cur.fromSlot, function () { var nn = cur.fromSlot; T.clearSlot(nn); saveMsg.textContent = 'Slot ' + nn + ' cleared.'; PS.log('settings', 'theme slot ' + nn + ' cleared'); }, 'ps-small ps-ghost'));
    }
    customBox.appendChild(actions);
    customBox.appendChild(saveMsg);
    customBox.appendChild(ui.note(T.workFolderNote));
  }

  function show(which) {
    themesBox.style.display = which === 'themes' ? '' : 'none';
    customBox.style.display = which === 'custom' ? '' : 'none';
    if (tabs.get() !== which) tabs.set(which);
  }

  T.onChange(function () { renderThemes(); if (!editing) renderCustom(); });
  renderThemes(); renderCustom(); show('themes');
  return ui.panel('Colours', tabs.el, themesBox, customBox);
};
