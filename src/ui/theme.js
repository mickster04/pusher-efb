// Colour themes. A theme is a palette of named colours ("roles"); the stylesheet (styles.css) is a template with @role@ tokens and the map drawing asks
// PS.theme.c('role'), so changing the palette recolours the whole app. The sim's browser has no CSS variables, so the CSS text is rebuilt and swapped.
//
// A palette lists only the roles that matter; the rest are filled in from them (fillRoles) and the many shades the stylesheet uses are mixed from
// the roles (derive), so a theme or a custom colour set stays consistent. The airline themes are "inspired by" those liveries: approximate colours.

PS.theme = (function () {
  var KEY = 'pushplanner.theme';

  // Everything a user can set, in the order the Custom tab shows it.
  var ROLE_GROUPS = [
    { title: 'Page', roles: [
      ['bg', 'Page background'], ['bgDeep', 'Header, tabs and footer'], ['panel', 'Panels'], ['border', 'Borders'], ['text', 'Main text'], ['textDim', 'Secondary text'],
      ['accent', 'Accent (titles, selected tab)'], ['accentText', 'Text on the accent'], ['button', 'Button face'], ['buttonText', 'Button text'], ['input', 'Fields and map background'],
      ['good', 'Good / on'], ['warn', 'Caution'], ['bad', 'Warning / stop'], ['accent2', 'Highlight (progress bar, chosen suggestion)'] ] },
    { title: 'Map', roles: [
      ['mapBg', 'Map background'], ['mapGrid', 'Range rings'], ['mapText', 'Map labels'], ['taxiway', 'Taxiways'], ['runway', 'Runways'], ['pathOther', 'Other paths'],
      ['routeBack', 'Push-back route'], ['routeFwd', 'Forward route'], ['routeBad', 'Route the tug may not manage'], ['routeDone', 'Route already driven'],
      ['aircraft', 'Your aircraft'], ['pin', 'Pins'], ['pinEnd', 'End pin'], ['traffic', 'AI aircraft'], ['handle', 'Heading handle'], ['outline', 'Outlines'] ] }
  ];

  var ALL_ROLES = [];
  ROLE_GROUPS.forEach(function (g) { g.roles.forEach(function (r) { ALL_ROLES.push(r[0]); }); });

  // ---- colour maths ----
  function parse(hex) {
    var h = String(hex || '').replace(/^#/, '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function hex(rgb) {
    return '#' + rgb.map(function (v) { var n = Math.max(0, Math.min(255, Math.round(v))).toString(16); return n.length < 2 ? '0' + n : n; }).join('');
  }
  function isHex(v) { return parse(v) !== null; }
  function normalise(v) { var p = parse(v); return p ? hex(p) : null; }
  // t = 0 is a, 1 is b
  function mix(a, b, t) {
    var pa = parse(a) || [0, 0, 0], pb = parse(b) || [0, 0, 0];
    return hex([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]);
  }
  function luminance(v) {
    var p = parse(v) || [0, 0, 0];
    function ch(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2]);
  }
  function contrast(a, b) { var la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

  // ---- the themes ----
  // Page roles are required; map roles are optional (filled from the page roles).
  var THEMES = [
    { id: 'default', name: 'Push Planner', note: 'The original dark theme with amber', p: {
      bg: '#131c24', bgDeep: '#0e151b', panel: '#1b2630', border: '#2a3a47', text: '#dfe7ee', textDim: '#8aa0b2', accent: '#f0a830', accentText: '#131c24',
      button: '#2a3a47', buttonText: '#eef4f8', input: '#0f171e', good: '#4cd18a', warn: '#ffd37a', bad: '#ff5c6c', accent2: '#34d2c8',
      runway: '#8aa3b8', pathOther: '#4d6275', routeBack: '#ffffff', routeFwd: '#5aa8ff', routeDone: '#4d6275', pin: '#e8f0f6', pinEnd: '#ff9f43', traffic: '#ff5c5c', handle: '#ffe14d', outline: '#0b1116', mapText: '#6f8294' } },
    { id: 'contrast', name: 'High contrast', note: 'Black and white with strong colours', p: {
      bg: '#000000', bgDeep: '#000000', panel: '#0c0c0c', border: '#8a8a8a', text: '#ffffff', textDim: '#d2d2d2', accent: '#ffd400', accentText: '#000000',
      button: '#262626', buttonText: '#ffffff', input: '#000000', good: '#00ff7f', warn: '#ffd400', bad: '#ff4545', accent2: '#00e5ff', routeFwd: '#4da6ff', mapGrid: '#6a6a6a', mapText: '#d2d2d2', outline: '#000000' } },
    { id: 'night', name: 'Night (red)', note: 'Dim reds that keep night vision', p: {
      bg: '#0c0202', bgDeep: '#070101', panel: '#170505', border: '#421212', text: '#e8665a', textDim: '#b04a40', accent: '#ff3b2f', accentText: '#120000',
      button: '#2b0c0c', buttonText: '#ff8a7a', input: '#080101', good: '#d9803a', warn: '#ffa060', bad: '#ff2a2a', accent2: '#c0392b',
      routeBack: '#ff9a8a', routeFwd: '#c0392b', routeDone: '#5a2420', runway: '#b4574c', pathOther: '#5a2420', pin: '#ff8a7a', pinEnd: '#ffa060', traffic: '#ff6a5a', handle: '#ffa060', outline: '#060000' } },
    { id: 'day', name: 'Daylight', note: 'Light, for a bright cockpit', p: {
      bg: '#eef2f6', bgDeep: '#d9e1e8', panel: '#ffffff', border: '#c0ccd6', text: '#1b2630', textDim: '#566678', accent: '#c46a00', accentText: '#ffffff',
      button: '#e1e8ee', buttonText: '#1b2630', input: '#f7f9fb', good: '#17854e', warn: '#8f6200', bad: '#c62f3d', accent2: '#0e8f89',
      mapBg: '#f7f9fb', mapGrid: '#c0ccd6', mapText: '#566678', taxiway: '#c46a00', runway: '#566678', pathOther: '#9aa8b4', routeBack: '#1b2630', routeFwd: '#1565c0', routeBad: '#c62f3d',
      routeDone: '#a3b0bb', aircraft: '#17854e', pin: '#1b2630', pinEnd: '#e06a00', traffic: '#c62f3d', handle: '#b8860b', outline: '#ffffff' } },

    { id: 'delta', name: 'Delta', note: 'Navy and red', p: {
      bg: '#0a1f3c', bgDeep: '#06142a', panel: '#0f2b52', border: '#1d4580', text: '#f2f5f9', textDim: '#9db2cf', accent: '#e01933', accentText: '#ffffff',
      button: '#16376a', buttonText: '#ffffff', input: '#081a33', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6677', accent2: '#7fb6ff', routeFwd: '#6fb0ff', taxiway: '#e01933' } },
    { id: 'ba', name: 'British Airways', note: 'Speedbird navy, red and silver', p: {
      bg: '#06132e', bgDeep: '#040d20', panel: '#0c2152', border: '#1f4290', text: '#f4f6fb', textDim: '#a7b6d4', accent: '#eb2226', accentText: '#ffffff',
      button: '#12306b', buttonText: '#ffffff', input: '#050f26', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6a6e', accent2: '#c8ccd4', taxiway: '#d6d9e0', routeFwd: '#7aa8ff' } },
    { id: 'lufthansa', name: 'Lufthansa', note: 'Deep blue with the crane yellow', p: {
      bg: '#0a1544', bgDeep: '#060e30', panel: '#102060', border: '#263d8c', text: '#f5f6fb', textDim: '#a6b0d8', accent: '#ffad00', accentText: '#05164d',
      button: '#1a2c7c', buttonText: '#ffffff', input: '#080f36', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6677', accent2: '#ffad00', routeFwd: '#7fb0ff' } },
    { id: 'airnz', name: 'Air New Zealand', note: 'Black and white with koru teal', p: {
      bg: '#0d0d0d', bgDeep: '#000000', panel: '#1a1a1a', border: '#3c3c3c', text: '#ffffff', textDim: '#a8a8a8', accent: '#1fb5ac', accentText: '#000000',
      button: '#2a2a2a', buttonText: '#ffffff', input: '#080808', good: '#4cd18a', warn: '#ffd37a', bad: '#ff5c6c', accent2: '#8be0da', taxiway: '#1fb5ac', routeFwd: '#6fc4ff' } },
    { id: 'eurowings', name: 'Eurowings', note: 'Aubergine and magenta', p: {
      bg: '#1d0a2e', bgDeep: '#14061f', panel: '#2b1243', border: '#4b2472', text: '#fbf4fa', textDim: '#c4a4d0', accent: '#e6007e', accentText: '#ffffff',
      button: '#3e1b5e', buttonText: '#ffffff', input: '#120519', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6a8a', accent2: '#ff7ac0', taxiway: '#ff7ac0', routeFwd: '#8fb4ff' } },

    { id: 'qantas', name: 'Qantas', note: 'Kangaroo red on black', p: {
      bg: '#0e0e10', bgDeep: '#070708', panel: '#1b1b1f', border: '#3d2c2f', text: '#ffffff', textDim: '#b3a9aa', accent: '#e40000', accentText: '#ffffff',
      button: '#2b2224', buttonText: '#ffffff', input: '#09090a', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6a5a', accent2: '#ffffff', taxiway: '#ff5a4a', routeFwd: '#6fb0ff' } },
    { id: 'emirates', name: 'Emirates', note: 'Charcoal, red and gold', p: {
      bg: '#1a1614', bgDeep: '#100d0c', panel: '#272120', border: '#4d4136', text: '#f6f1ea', textDim: '#b9ab98', accent: '#d71921', accentText: '#ffffff',
      button: '#372e2b', buttonText: '#ffffff', input: '#120f0e', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6a6e', accent2: '#c9a56a', taxiway: '#c9a56a', routeFwd: '#7ab6ff' } },
    { id: 'klm', name: 'KLM', note: 'Royal blue and sky blue', p: {
      bg: '#04204a', bgDeep: '#021632', panel: '#0a3068', border: '#1b5aa8', text: '#ffffff', textDim: '#a9c7e8', accent: '#00a1de', accentText: '#00203f',
      button: '#14407f', buttonText: '#ffffff', input: '#031a3c', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6677', accent2: '#7fd6ff', taxiway: '#00a1de', routeFwd: '#9ad4ff' } },
    { id: 'sia', name: 'Singapore Airlines', note: 'Navy and gold', p: {
      bg: '#031637', bgDeep: '#020e24', panel: '#072a63', border: '#1a4690', text: '#ffffff', textDim: '#a8b9d8', accent: '#f99f1c', accentText: '#031637',
      button: '#10388a', buttonText: '#ffffff', input: '#02112b', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6677', accent2: '#f9c46a', routeFwd: '#7fb6ff' } },
    { id: 'airfrance', name: 'Air France', note: 'Navy with the tricolour red', p: {
      bg: '#00163d', bgDeep: '#000e29', panel: '#00255a', border: '#143f82', text: '#ffffff', textDim: '#a9b9d8', accent: '#e1000f', accentText: '#ffffff',
      button: '#0c3478', buttonText: '#ffffff', input: '#00112f', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6a74', accent2: '#6aa0ff', taxiway: '#ff4a55', routeFwd: '#7fb0ff' } },
    { id: 'ryanair', name: 'Ryanair', note: 'Bright blue and yellow', p: {
      bg: '#05205f', bgDeep: '#031542', panel: '#0a3180', border: '#2050b4', text: '#ffffff', textDim: '#b3c4ee', accent: '#f1c933', accentText: '#05205f',
      button: '#144098', buttonText: '#ffffff', input: '#041a50', good: '#4cd18a', warn: '#f1c933', bad: '#ff6677', accent2: '#f1c933', routeFwd: '#8dc0ff' } },
    { id: 'easyjet', name: 'easyJet', note: 'Charcoal and orange', p: {
      bg: '#1c1c1c', bgDeep: '#111111', panel: '#2a2a2a', border: '#474747', text: '#ffffff', textDim: '#b5b5b5', accent: '#ff6600', accentText: '#111111',
      button: '#3a3a3a', buttonText: '#ffffff', input: '#131313', good: '#4cd18a', warn: '#ffd37a', bad: '#ff5c6c', accent2: '#ffa466', taxiway: '#ff6600', routeFwd: '#6fb0ff' } },
    { id: 'qatar', name: 'Qatar Airways', note: 'Burgundy and muted gold', p: {
      bg: '#2a0415', bgDeep: '#1c020e', panel: '#3d0a24', border: '#6b1a3f', text: '#f7eef2', textDim: '#c9a5b5', accent: '#c8a165', accentText: '#2a0415',
      button: '#541030', buttonText: '#ffffff', input: '#1f030f', good: '#4cd18a', warn: '#ffd37a', bad: '#ff6a8a', accent2: '#e6c991', taxiway: '#c8a165', routeFwd: '#8fb4ff' } }
  ];

  // Fill in the roles a theme left out, from the ones it set.
  function fillRoles(p) {
    var r = {}, k;
    for (k in p) { if (Object.prototype.hasOwnProperty.call(p, k) && isHex(p[k])) r[k] = normalise(p[k]); }
    function d(role, value) { if (!r[role]) r[role] = value; }
    d('bg', '#131c24'); d('text', '#dfe7ee');
    d('bgDeep', mix(r.bg, '#000000', 0.25)); d('panel', mix(r.bg, r.text, 0.07)); d('border', mix(r.bg, r.text, 0.18)); d('textDim', mix(r.text, r.bg, 0.45));
    d('accent', '#f0a830'); d('accentText', luminance(r.accent) > 0.4 ? '#000000' : '#ffffff'); d('button', r.border); d('buttonText', r.text); d('input', mix(r.bg, '#000000', 0.2));
    d('good', '#4cd18a'); d('warn', '#ffd37a'); d('bad', '#ff5c6c'); d('accent2', '#34d2c8');
    d('mapBg', r.input); d('mapGrid', r.border); d('mapText', r.textDim); d('taxiway', r.accent); d('runway', mix(r.textDim, r.text, 0.3)); d('pathOther', mix(r.textDim, r.bg, 0.5));
    d('routeBack', mix(r.text, '#ffffff', 0.6)); d('routeFwd', '#5aa8ff'); d('routeBad', r.bad); d('routeDone', r.pathOther); d('aircraft', r.good); d('pin', r.text);
    d('pinEnd', r.warn); d('traffic', r.bad); d('handle', r.warn); d('outline', mix(r.bgDeep, '#000000', 0.3));
    return r;
  }
  // Every token the stylesheet uses: the roles themselves plus shades mixed from them.
  function derive(r) {
    var t = {}, k;
    for (k in r) t[k] = r[k];
    t.bgDeeper = mix(r.bgDeep, '#000000', 0.3); t.border2 = mix(r.border, r.text, 0.15); t.borderSoft = mix(r.panel, r.border, 0.55); t.panelHi = mix(r.panel, r.text, 0.06);
    t.text2 = mix(r.text, r.bg, 0.12); t.textBright = mix(r.text, '#ffffff', 0.6);
    t.dim2 = mix(r.textDim, r.text, 0.15); t.dim3 = mix(r.textDim, r.text, 0.55); t.dim4 = mix(r.textDim, r.bg, 0.2); t.dim5 = mix(r.textDim, r.bg, 0.5);
    t.accentDeep = mix(r.accent, r.bg, 0.6); t.accentDeeper = mix(r.accent, r.bg, 0.8); t.accentFaint = mix(r.accent, r.bg, 0.88);
    t.badSoft = mix(r.bad, r.text, 0.5); t.badDeep = mix(r.bad, r.bg, 0.55); t.badDeeper = mix(r.bad, r.bg, 0.75);
    t.goodSoft = mix(r.good, r.text, 0.6); t.goodDeep = mix(r.good, r.bg, 0.6); t.accent2Deep = mix(r.accent2, r.bg, 0.75);
    return t;
  }

  function byId(id) { for (var i = 0; i < THEMES.length; i++) { if (THEMES[i].id === id) return THEMES[i]; } return THEMES[0]; }

  // ---- the chosen theme and the user's own colours on top of it ----
  var state = { id: 'default', custom: {} };
  var current = null;      // the resolved tokens
  var listeners = [];
  var styleEl = null;

  function load() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (typeof saved.id === 'string') state.id = byId(saved.id).id;
        if (saved.custom && typeof saved.custom === 'object') { for (var k in saved.custom) { if (ALL_ROLES.indexOf(k) >= 0 && isHex(saved.custom[k])) state.custom[k] = normalise(saved.custom[k]); } }
      }
    } catch (e) { /* defaults */ }
  }
  function save() { try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* not saved */ } }

  // The palette (all roles) of the chosen theme with the user's colours over it.
  function palette(id, custom) {
    var base = {}, k, theme = byId(id === undefined ? state.id : id), over = custom === undefined ? state.custom : custom;
    for (k in theme.p) base[k] = theme.p[k];
    for (k in over) base[k] = over[k];
    return fillRoles(base);
  }
  function resolve() { current = derive(palette()); return current; }
  function cssText() {
    var t = current || resolve();
    return String(PS.CSS || '').replace(/@(\w+)@/g, function (m, name) { return t[name] !== undefined ? t[name] : m; });
  }
  function apply() {
    resolve();
    if (styleEl && styleEl.firstChild) styleEl.firstChild.nodeValue = cssText();
    else if (styleEl) styleEl.appendChild(document.createTextNode(cssText()));
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](current); } catch (e) { /* a listener must not break the others */ } }
  }

  load();
  resolve();

  return {
    ROLE_GROUPS: ROLE_GROUPS, ROLES: ALL_ROLES, THEMES: THEMES, byId: byId,
    mix: mix, parse: parse, hex: hex, isHex: isHex, normalise: normalise, luminance: luminance, contrast: contrast,
    fillRoles: fillRoles, derive: derive, palette: palette, css: cssText,
    // c('routeBack') -> the colour now. Used by the map drawing.
    c: function (role) { return (current || resolve())[role] || '#ff00ff'; },
    all: function () { return current || resolve(); },
    state: function () { return state; },
    selectedId: function () { return state.id; },
    // The theme's own colour for a role (ignoring the user's changes), to reset to.
    themeColour: function (role) { return palette(state.id, {})[role]; },
    isChanged: function (role) { return state.custom[role] !== undefined; },
    // Style element to keep up to date (the app makes it).
    attach: function (el) { styleEl = el; },
    select: function (id) { state.id = byId(id).id; state.custom = {}; save(); apply(); },
    setColour: function (role, value) { if (ALL_ROLES.indexOf(role) < 0 || !isHex(value)) return false; state.custom[role] = normalise(value); save(); apply(); return true; },
    resetColour: function (role) { delete state.custom[role]; save(); apply(); },
    resetAll: function () { state.custom = {}; save(); apply(); },
    onChange: function (fn) { listeners.push(fn); },
    // A theme as text to share, and back. Only roles that differ from the base theme are written.
    exportText: function () { return JSON.stringify({ app: 'PushPlanner', theme: state.id, colours: palette() }, null, 1); },
    importText: function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { return { ok: false, why: 'That is not valid JSON.' }; }
      var cols = data && (data.colours || data.colors || data.custom);
      if (!cols || typeof cols !== 'object') return { ok: false, why: 'No "colours" found in it.' };
      var next = {}, n = 0, k;
      for (k in cols) { if (ALL_ROLES.indexOf(k) >= 0 && isHex(cols[k])) { next[k] = normalise(cols[k]); n++; } }
      if (!n) return { ok: false, why: 'None of the colours in it are ones this app knows.' };
      if (data.theme && typeof data.theme === 'string') state.id = byId(data.theme).id;
      state.custom = next; save(); apply();
      return { ok: true, count: n };
    },
    // Where a colour is poorly readable against its background: [{ name, ratio }]
    contrastWarnings: function () {
      var t = current || resolve(), out = [];
      [['Main text on panels', t.text, t.panel], ['Secondary text on panels', t.textDim, t.panel], ['Button text on buttons', t.buttonText, t.button], ['Accent text on the accent', t.accentText, t.accent], ['Accent on the page', t.accent, t.bg]].forEach(function (c) {
        var ratio = contrast(c[1], c[2]); if (ratio < 3) out.push({ name: c[0], ratio: ratio });
      });
      return out;
    }
  };
})();
