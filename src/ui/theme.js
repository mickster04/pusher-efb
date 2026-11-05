// Colour themes. A theme is a palette of named colours ("roles"); the stylesheet (styles.css) is a template with @role@ tokens and the map drawing asks
// PS.theme.c('role'), so changing the palette recolours the whole app. The sim's browser has no CSS variables, so the CSS text is rebuilt and swapped.
//
// A palette lists only the roles that matter; the rest are filled in from them (fillRoles) and the many shades the stylesheet uses are mixed from
// the roles (derive), so a theme or a custom colour set stays consistent. The airline themes are "inspired by" those liveries: approximate colours.

PS.theme = (function () {
  var KEY = 'pushplanner.theme';

  // Everything a user can set, in the order the Custom tab shows it.
  var ROLE_GROUPS = [
    {
      title: 'Page',
      roles: [
        ['bg', 'Page background'],
        ['bgDeep', 'Header, tabs and footer'],
        ['panel', 'Panels'],
        ['border', 'Borders'],
        ['text', 'Main text'],
        ['textDim', 'Secondary text'],
        ['accent', 'Accent (titles, selected tab)'],
        ['accentText', 'Text on the accent'],
        ['button', 'Button face'],
        ['buttonText', 'Button text'],
        ['input', 'Fields and map background'],
        ['good', 'Good / on'],
        ['warn', 'Caution'],
        ['bad', 'Warning / stop'],
        ['accent2', 'Highlight (progress bar, chosen suggestion)']
      ]
    },
    {
      title: 'Map',
      roles: [
        ['mapBg', 'Map background'],
        ['mapGrid', 'Range rings'],
        ['mapText', 'Map labels'],
        ['taxiway', 'Taxiways'],
        ['runway', 'Runways'],
        ['pathOther', 'Other paths'],
        ['routeBack', 'Push-back route'],
        ['routeFwd', 'Forward route'],
        ['routeBad', 'Route the tug may not manage'],
        ['routeDone', 'Route already driven'],
        ['aircraft', 'Your aircraft'],
        ['pin', 'Pins'],
        ['pinEnd', 'End pin'],
        ['traffic', 'AI aircraft'],
        ['handle', 'Heading handle'],
        ['outline', 'Outlines']
      ]
    }
  ];

  var ALL_ROLES = [];
  ROLE_GROUPS.forEach(function (g) {
    g.roles.forEach(function (r) {
      ALL_ROLES.push(r[0]);
    });
  });

  // ---- colour maths ----
  function parse(hex) {
    var h = String(hex || '').replace(/^#/, '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function hex(rgb) {
    return (
      '#' +
      rgb
        .map(function (v) {
          var n = Math.max(0, Math.min(255, Math.round(v))).toString(16);
          return n.length < 2 ? '0' + n : n;
        })
        .join('')
    );
  }
  function isHex(v) {
    return parse(v) !== null;
  }
  function normalise(v) {
    var p = parse(v);
    return p ? hex(p) : null;
  }
  // t = 0 is a, 1 is b
  function mix(a, b, t) {
    var pa = parse(a) || [0, 0, 0],
      pb = parse(b) || [0, 0, 0];
    return hex([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t]);
  }
  function luminance(v) {
    var p = parse(v) || [0, 0, 0];
    function ch(c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2]);
  }
  function contrast(a, b) {
    var la = luminance(a),
      lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // ---- the themes ----
  // Page roles are required; map roles are optional (filled from the page roles). The presets are the JSON files in src/themes/ (built into the bundle as
  // PS.BUILTIN_THEMES, so there is always a set to use) and the same files are shipped in the package, where loadFiles() reads them at run time.
  // Map line weights and label size (pixels) are part of a theme: a "map" object in the theme file, any of unnamed, named, runway, label, gap.
  var MAP_DEFAULT = { unnamed: 3, named: 6, runway: 32, label: 15, gap: 9 };
  function cleanMap(m) {
    var out = {},
      k,
      v;
    if (m && typeof m === 'object') {
      for (k in MAP_DEFAULT) {
        v = Number(m[k]);
        if (isFinite(v) && v >= 0 && v <= 80) out[k] = v;
      }
    }
    return out;
  }
  // In a theme file each kind of path is an object with its own colour and width: map.paths.runway / taxiway (named) / unnamed { "colour", "width" }, and
  // map.labels { "size", "gap" }. (The older map.lines and flat map shapes still load.)
  var PATH_KEYS = { runway: ['runway', 'runway'], taxiway: ['taxiway', 'named'], unnamed: ['pathOther', 'unnamed'] }; // file key -> [colour role, width key]
  function mapLines(t) {
    var m = t && t.map && typeof t.map === 'object' ? t.map : null,
      flat = {},
      k,
      p;
    if (!m) return {};
    if (m.lines && typeof m.lines === 'object') flat = cleanMap(m.lines);
    else flat = cleanMap(m);
    if (m.paths && typeof m.paths === 'object') {
      for (k in PATH_KEYS) {
        p = m.paths[k];
        if (p && typeof p === 'object') {
          var w = cleanMap(
            (function () {
              var o = {};
              o[PATH_KEYS[k][1]] = p.width;
              return o;
            })()
          );
          if (w[PATH_KEYS[k][1]] !== undefined) flat[PATH_KEYS[k][1]] = w[PATH_KEYS[k][1]];
        }
      }
    }
    if (m.labels && typeof m.labels === 'object') {
      var l = cleanMap({ label: m.labels.size, gap: m.labels.gap });
      if (l.label !== undefined) flat.label = l.label;
      if (l.gap !== undefined) flat.gap = l.gap;
    }
    return flat;
  }
  // The colours of a theme file, however they are grouped: every valid colour for a known role, found at any depth under the file's groups (page, map, or
  // the older flat "colours"), so the grouping is for people to read and the app does not care where a role sits.
  function fileColours(t) {
    var out = {};
    (function walk(o, depth) {
      var k;
      if (!o || typeof o !== 'object' || depth > 4) return;
      for (k in o) {
        if (depth === 0 && (k === 'id' || k === 'name' || k === 'note')) continue;
        if (typeof o[k] === 'string') {
          if (ALL_ROLES.indexOf(k) >= 0 && isHex(o[k])) out[k] = normalise(o[k]);
        } else walk(o[k], depth + 1);
      }
    })(t, 0);
    var paths = t && t.map && t.map.paths,
      k;
    if (paths && typeof paths === 'object') {
      for (k in PATH_KEYS) {
        if (paths[k] && typeof paths[k] === 'object' && isHex(paths[k].colour)) out[PATH_KEYS[k][0]] = normalise(paths[k].colour);
      }
    }
    return out;
  }
  // The same colours grouped for a theme file: page and map, each in small groups, and the map's line weights.
  var FILE_GROUPS = {
    page: {
      surface: ['bg', 'bgDeep', 'panel', 'border', 'input'],
      text: ['text', 'textDim', 'accentText', 'buttonText'],
      controls: ['accent', 'accent2', 'button'],
      status: ['good', 'warn', 'bad']
    },
    map: {
      surface: ['mapBg', 'mapGrid', 'mapText', 'outline'],
      route: ['routeBack', 'routeFwd', 'routeBad', 'routeDone'],
      markers: ['aircraft', 'pin', 'pinEnd', 'traffic', 'handle']
    }
  };
  function nestPalette(pal, ms) {
    var out = {},
      sec,
      grp;
    for (sec in FILE_GROUPS) {
      out[sec] = {};
      for (grp in FILE_GROUPS[sec]) {
        out[sec][grp] = {};
        FILE_GROUPS[sec][grp].forEach(function (r) {
          if (pal[r]) out[sec][grp][r] = pal[r];
        });
      }
    }
    out.map.paths = {};
    for (grp in PATH_KEYS) out.map.paths[grp] = { colour: pal[PATH_KEYS[grp][0]], width: ms[PATH_KEYS[grp][1]] };
    out.map.labels = { size: ms.label, gap: ms.gap };
    return out;
  }
  function fromFileShape(t) {
    return { id: t.id, name: t.name, note: t.note || '', p: fileColours(t), m: mapLines(t), fromFile: false };
  }
  var THEMES = (PS.BUILTIN_THEMES || []).map(fromFileShape);
  if (!THEMES.length)
    THEMES.push({ id: 'default', name: 'Push Planner', note: '', p: { bg: '#131c24', text: '#dfe7ee', accent: '#f0a830' } });

  // Fill in the roles a theme left out, from the ones it set.
  function fillRoles(p) {
    var r = {},
      k;
    for (k in p) {
      if (Object.prototype.hasOwnProperty.call(p, k) && isHex(p[k])) r[k] = normalise(p[k]);
    }
    function d(role, value) {
      if (!r[role]) r[role] = value;
    }
    d('bg', '#131c24');
    d('text', '#dfe7ee');
    d('bgDeep', mix(r.bg, '#000000', 0.25));
    d('panel', mix(r.bg, r.text, 0.07));
    d('border', mix(r.bg, r.text, 0.18));
    d('textDim', mix(r.text, r.bg, 0.45));
    d('accent', '#f0a830');
    d('accentText', luminance(r.accent) > 0.4 ? '#000000' : '#ffffff');
    d('button', r.border);
    d('buttonText', r.text);
    d('input', mix(r.bg, '#000000', 0.2));
    d('good', '#4cd18a');
    d('warn', '#ffd37a');
    d('bad', '#ff5c6c');
    d('accent2', '#34d2c8');
    d('mapBg', r.input);
    d('mapGrid', r.border);
    d('mapText', r.textDim);
    d('taxiway', r.accent);
    d('runway', mix(r.textDim, r.text, 0.3));
    d('pathOther', mix(r.textDim, r.bg, 0.5));
    d('routeBack', mix(r.text, '#ffffff', 0.6));
    d('routeFwd', '#5aa8ff');
    d('routeBad', r.bad);
    d('routeDone', r.pathOther);
    d('aircraft', r.good);
    d('pin', r.text);
    d('pinEnd', r.warn);
    d('traffic', r.bad);
    d('handle', r.warn);
    d('outline', mix(r.bgDeep, '#000000', 0.3));
    return r;
  }
  // Every token the stylesheet uses: the roles themselves plus shades mixed from them.
  function derive(r) {
    var t = {},
      k;
    for (k in r) t[k] = r[k];
    t.bgDeeper = mix(r.bgDeep, '#000000', 0.3);
    t.border2 = mix(r.border, r.text, 0.15);
    t.borderSoft = mix(r.panel, r.border, 0.55);
    t.panelHi = mix(r.panel, r.text, 0.06);
    t.text2 = mix(r.text, r.bg, 0.12);
    t.textBright = mix(r.text, '#ffffff', 0.6);
    t.dim2 = mix(r.textDim, r.text, 0.15);
    t.dim3 = mix(r.textDim, r.text, 0.55);
    t.dim4 = mix(r.textDim, r.bg, 0.2);
    t.dim5 = mix(r.textDim, r.bg, 0.5);
    t.accentDeep = mix(r.accent, r.bg, 0.6);
    t.accentDeeper = mix(r.accent, r.bg, 0.8);
    t.accentFaint = mix(r.accent, r.bg, 0.88);
    t.badSoft = mix(r.bad, r.text, 0.5);
    t.badDeep = mix(r.bad, r.bg, 0.55);
    t.badDeeper = mix(r.bad, r.bg, 0.75);
    t.goodSoft = mix(r.good, r.text, 0.6);
    t.goodDeep = mix(r.good, r.bg, 0.6);
    t.accent2Deep = mix(r.accent2, r.bg, 0.75);
    return t;
  }

  function find(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) return THEMES[i];
    }
    return null;
  }
  function byId(id) {
    return find(id) || THEMES[0];
  }

  // ---- the chosen theme and the user's own colours on top of it ----
  var state = { id: 'default', custom: {}, customMap: {} };
  var current = null; // the resolved tokens
  var listeners = [];
  var styleEl = null;

  function load() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (typeof saved.id === 'string') state.id = saved.id;
        if (saved.customMap && typeof saved.customMap === 'object') state.customMap = cleanMap(saved.customMap); // kept even if it is not known yet: it may be a theme file still to be read
        if (saved.custom && typeof saved.custom === 'object') {
          for (var k in saved.custom) {
            if (ALL_ROLES.indexOf(k) >= 0 && isHex(saved.custom[k])) state.custom[k] = normalise(saved.custom[k]);
          }
        }
      }
    } catch (e) {
      /* defaults */
    }
  }
  function save() {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* not saved */
    }
  }

  // The palette (all roles) of the chosen theme with the user's colours over it.
  function palette(id, custom) {
    var base = {},
      k,
      theme = byId(id === undefined ? state.id : id),
      over = custom === undefined ? state.custom : custom;
    for (k in theme.p) base[k] = theme.p[k];
    for (k in over) base[k] = over[k];
    return fillRoles(base);
  }
  // The map style of the chosen theme: its own values over the defaults.
  function mapStyle() {
    var theme = byId(state.id),
      out = {},
      k;
    for (k in MAP_DEFAULT)
      out[k] =
        state.customMap[k] !== undefined ? state.customMap[k] : theme && theme.m && theme.m[k] !== undefined ? theme.m[k] : MAP_DEFAULT[k];
    return out;
  }
  function resolve() {
    current = derive(palette());
    return current;
  }
  function cssText() {
    var t = current || resolve();
    return String(PS.CSS || '').replace(/@(\w+)@/g, function (m, name) {
      return t[name] !== undefined ? t[name] : m;
    });
  }
  function apply() {
    resolve();
    if (styleEl && styleEl.firstChild) styleEl.firstChild.nodeValue = cssText();
    else if (styleEl) styleEl.appendChild(document.createTextNode(cssText()));
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](current);
      } catch (e) {
        /* a listener must not break the others */
      }
    }
  }

  // ---- slots: your own themes, kept in the app's own storage ----
  // The page cannot write into the package's files (user1.json ...), so "Save to slot n" keeps the theme in the app's storage; it shows up in the Themes
  // tab like any other and survives restarts. SLOT_COUNT matches the user1.json to user8.json files, which stay the way to bring a theme in from a file.
  var SLOT_KEY = 'pushplanner.themeslots',
    SLOT_COUNT = 8;
  var slots = {};
  function loadSlots() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(SLOT_KEY) || '{}');
      for (var n = 1; n <= SLOT_COUNT; n++) {
        var e = saved[n];
        if (e && typeof e === 'object' && e.colours && typeof e.colours === 'object' && isHex(e.colours.bg) && isHex(e.colours.text)) {
          var cols = {},
            k;
          for (k in e.colours) {
            if (ALL_ROLES.indexOf(k) >= 0 && isHex(e.colours[k])) cols[k] = normalise(e.colours[k]);
          }
          slots[n] = { name: typeof e.name === 'string' && e.name ? e.name.slice(0, 30) : 'Slot ' + n, colours: cols };
        }
      }
    } catch (e) {
      /* none saved */
    }
  }
  function saveSlots() {
    try {
      window.localStorage.setItem(SLOT_KEY, JSON.stringify(slots));
    } catch (e) {
      /* kept for this session only */
    }
  }
  // The saved slots as entries at the end of THEMES (rebuilt whenever they or the file themes change).
  function refreshSlots() {
    for (var i = THEMES.length - 1; i >= 0; i--) {
      if (THEMES[i].fromSlot) THEMES.splice(i, 1);
    }
    for (var n = 1; n <= SLOT_COUNT; n++) {
      if (slots[n])
        THEMES.push({ id: 'slot' + n, name: slots[n].name, note: 'Saved in slot ' + n, p: slots[n].colours, fromFile: false, fromSlot: n });
    }
  }

  // ---- saved themes: real files in the files module's work folder ----
  // The page cannot write files and nothing inside the package can be written by a module (the sim refuses), but the files module can read and write its
  // own work folder (found with a probe, since removed). A theme saved there is a .json file named after the theme, found again at every start (the module lists the
  // folder), and can be copied out to share or dropped in from someone else. If the files module is not installed, saving falls back to the in-app slots.
  // Where the files are on disk. The Microsoft Store path was read from a working install; the Steam one is by the same layout (Steam keeps the sim's data under
  // %APPDATA%\Microsoft Flight Simulator 2024 where the Store keeps it under LocalState) and matches community reports, but has not been checked on a Steam install.
  var WORK_FOLDER = '%LOCALAPPDATA%\\Packages\\Microsoft.Limitless_8wekyb3d8bbwe\\LocalState\\WASM\\MSFS2024\\push-planner\\work';
  var WORK_FOLDER_STEAM = '%APPDATA%\\Microsoft Flight Simulator 2024\\WASM\\MSFS2024\\push-planner\\work';
  var WORK_FOLDER_NOTE =
    'Saved themes are .json files in the push-planner work folder. Microsoft Store install: ' +
    WORK_FOLDER +
    '. Steam install: ' +
    WORK_FOLDER_STEAM +
    ' (from community reports; not checked here). Copy a file out to share it; drop one in and reload to use it.';
  var savedInfo = { state: 'idle', module: 'unknown', count: 0, failed: [], at: 0 };
  function slugify(name) {
    var t = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return t || 'my-theme';
  }
  // Add the theme files the module listed ([{ name, text }]) as themes, replacing the ones listed last time.
  function ingestSaved(list) {
    for (var i = THEMES.length - 1; i >= 0; i--) {
      if (THEMES[i].fromSaved) THEMES.splice(i, 1);
    }
    var failed = [],
      count = 0;
    list.forEach(function (it) {
      var t;
      try {
        t = JSON.parse(it.text);
      } catch (e) {
        failed.push({ file: it.name, why: 'not valid JSON' });
        return;
      }
      if (t && t.empty === true) return;
      var why = validateThemeFile(t);
      if (why) {
        failed.push({ file: it.name, why: why });
        return;
      }
      var cols = fileColours(t);
      var id = t.id,
        clash = find(id);
      if (clash && !clash.fromSaved) id = id + '-saved'; // a saved file never replaces a preset
      THEMES.push({
        id: id,
        name: typeof t.name === 'string' && t.name ? t.name : id,
        note: typeof t.note === 'string' ? t.note : 'Saved theme',
        p: cols,
        m: mapLines(t),
        fromFile: false,
        fromSaved: it.name
      });
      count++;
    });
    refreshSlots();
    return { count: count, failed: failed };
  }
  function loadSaved(done) {
    if (!PS.wasmFiles || typeof PS.wasmFiles.list !== 'function') {
      savedInfo = { state: 'failed', module: 'no', count: 0, failed: [], at: Date.now() };
      if (done) done(savedInfo);
      return;
    }
    savedInfo.state = 'loading';
    PS.wasmFiles.list().then(
      function (files) {
        var r = ingestSaved(files);
        savedInfo = { state: 'done', module: 'yes', count: r.count, failed: r.failed, at: Date.now() };
        PS.logv(
          'theme',
          'saved themes: ' +
            r.count +
            " file(s) in the files module's work folder" +
            (r.failed.length
              ? '; not read: ' +
                r.failed
                  .map(function (f) {
                    return f.file + ' ' + f.why;
                  })
                  .join(', ')
              : '')
        );
        if (!find(state.id)) {
          state.id = THEMES[0].id;
          state.custom = {};
          state.customMap = {};
          save();
        }
        apply();
        if (done) done(savedInfo);
      },
      function (e) {
        savedInfo = { state: 'failed', module: 'no', count: 0, failed: [], at: Date.now() };
        PS.log(
          'theme',
          'saved themes: the files module did not answer (' + (PS.errText ? PS.errText(e) : e) + "); saving will use the app's own storage"
        );
        apply();
        if (done) done(savedInfo);
      }
    );
  }
  // Save the colours in use as a theme called `name`. done({ ok, where: 'file' | 'storage', file, why }).
  function saveTheme(name, done) {
    var nm =
        String(name || '')
          .replace(/\s+/g, ' ')
          .replace(/^ | $/g, '')
          .slice(0, 30) || 'My theme',
      fileName = slugify(nm) + '.json',
      id = 'saved-' + slugify(nm);
    var obj = { id: id, name: nm, note: 'Saved from Push Planner' };
    var nested = nestPalette(palette(), mapStyle());
    obj.page = nested.page;
    obj.map = nested.map;
    var text = JSON.stringify(obj, null, 1);
    function viaStorage(why) {
      var n = 0,
        k;
      for (k = 1; k <= SLOT_COUNT; k++) {
        if (slots[k] && slots[k].name === nm) {
          n = k;
          break;
        }
      }
      if (!n) {
        for (k = 1; k <= SLOT_COUNT; k++) {
          if (!slots[k]) {
            n = k;
            break;
          }
        }
      }
      if (!n) {
        if (done) done({ ok: false, why: 'The files module is not available and all ' + SLOT_COUNT + ' storage slots are used.' });
        return;
      }
      api.saveSlot(n, nm);
      PS.log('theme', 'theme "' + nm + '" saved in the app\'s own storage (slot ' + n + '): ' + why);
      if (done) done({ ok: true, where: 'storage', slot: n });
    }
    if (!PS.wasmFiles || typeof PS.wasmFiles.save !== 'function') {
      viaStorage('no files client');
      return;
    }
    PS.wasmFiles.save(fileName, text).then(
      function (r) {
        if (!r || !r.ok) {
          viaStorage('the files module said: ' + (r && r.detail ? r.detail : 'no'));
          return;
        }
        PS.log('theme', 'theme "' + nm + '" saved as ' + fileName);
        loadSaved(function () {
          if (find(id)) {
            state.id = id;
            state.custom = {};
            state.customMap = {};
            save();
            apply();
          }
          if (done) done({ ok: true, where: 'file', file: fileName, folder: WORK_FOLDER, folderSteam: WORK_FOLDER_STEAM });
        });
      },
      function (e) {
        viaStorage('the files module did not answer');
      }
    );
  }
  function deleteSaved(fileName, done) {
    if (!PS.wasmFiles || typeof PS.wasmFiles.remove !== 'function') {
      if (done) done({ ok: false, why: 'no files module' });
      return;
    }
    PS.wasmFiles.remove(fileName).then(
      function (r) {
        PS.log('theme', 'saved theme file ' + fileName + (r && r.ok ? ' deleted' : ' not deleted: ' + (r && r.detail ? r.detail : 'no')));
        loadSaved(function () {
          if (done) done({ ok: !!(r && r.ok), why: r && r.detail });
        });
      },
      function (e) {
        if (done) done({ ok: false, why: PS.errText ? PS.errText(e) : String(e) });
      }
    );
  }

  // ---- theme files in the package ----
  // The package ships the presets as files (themes/index.json lists them) which are read here when the app starts: what is in them wins over the built-in
  // copy of the same id, and a file with a new id adds a theme. So a theme can be added or changed by editing the files, no rebuild of the app.
  // A theme file is { "id", "name", "note", "page": { "surface": { "bg": "#112233", ... }, "text": {...}, "controls": {...}, "status": {...} },
  // "map": { "surface": {...}, "paths": {...}, "route": {...}, "markers": {...}, "lines": { "unnamed": 3, "named": 6, "runway": 32, "label": 15, "gap": 9 } } }
  // (roles as on the My colours tab; leave out the ones you do not care about; the older flat "colours" object still works). It needs a valid bg and text at least. index.json is { "themes": ["id", ...] } (an entry may also be "file.json").
  var files = { state: 'idle', names: [], empty: 0, base: '', listed: 0, loaded: 0, added: 0, replaced: 0, failed: [], at: 0 };
  var ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i;

  function validateThemeFile(t) {
    if (!t || typeof t !== 'object') return 'not an object';
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) return 'needs an "id" of letters, digits, - or _';
    var cols = fileColours(t),
      n = 0,
      k;
    for (k in cols) n++;
    if (!isHex(cols.bg) || !isHex(cols.text)) return 'needs a valid "bg" and "text" colour';
    return n < 3 ? 'has hardly any valid colours' : '';
  }
  // list: [{ file, text }] (text is the file's contents, or error is set). Returns { added, replaced, failed: [{ file, why }] }.
  function ingest(list) {
    var res = { added: 0, replaced: 0, empty: 0, failed: [] };
    list.forEach(function (it) {
      if (it.error) {
        res.failed.push({ file: it.file, why: it.error });
        return;
      }
      var t;
      try {
        t = JSON.parse(it.text);
      } catch (e) {
        res.failed.push({ file: it.file, why: 'not valid JSON' });
        return;
      }
      if (t && t.empty === true) {
        res.empty++;
        return;
      } // a free slot (user1.json ...): nothing to load yet
      var why = validateThemeFile(t);
      if (why) {
        res.failed.push({ file: it.file, why: why });
        return;
      }
      var cols = fileColours(t);
      var entry = {
          id: t.id,
          name: typeof t.name === 'string' && t.name ? t.name : t.id,
          note: typeof t.note === 'string' ? t.note : '',
          p: cols,
          m: mapLines(t),
          fromFile: true
        },
        existing = find(t.id);
      if (existing) {
        THEMES[THEMES.indexOf(existing)] = entry;
        res.replaced++;
      } else {
        THEMES.push(entry);
        res.added++;
      }
    });
    refreshSlots();
    return res;
  }
  function themeBase() {
    return PS.global.__themeBase || 'coui://html_ui/efb_ui/efb_apps/' + PS.INTERNAL_NAME + '/themes';
  }
  function httpGet(url, cb) {
    var done = false;
    function finish(err, text) {
      if (done) return;
      done = true;
      cb(err, text);
    }
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        var ok = (x.status === 200 || x.status === 0) && typeof x.responseText === 'string' && x.responseText.length > 0;
        finish(ok ? null : 'could not be read (status ' + x.status + ')', x.responseText);
      };
      x.onerror = function () {
        finish('could not be read (network error)');
      };
      x.send();
      setTimeout(function () {
        finish('timed out');
      }, 6000);
    } catch (e) {
      finish(PS.errText ? PS.errText(e) : String(e));
    }
  }
  function loadFiles(done) {
    if (typeof XMLHttpRequest === 'undefined') {
      files.state = 'failed';
      files.failed = [{ file: 'index.json', why: 'no XMLHttpRequest here' }];
      if (done) done(files);
      return;
    }
    files = {
      state: 'loading',
      names: [],
      empty: 0,
      base: themeBase(),
      listed: 0,
      loaded: 0,
      added: 0,
      replaced: 0,
      failed: [],
      at: Date.now()
    };
    PS.logv('theme', 'reading theme files from ' + files.base + '/index.json');
    httpGet(files.base + '/index.json', function (err, text) {
      var names = null;
      if (!err) {
        try {
          var idx = JSON.parse(text);
          if (idx && Array.isArray(idx.themes)) names = idx.themes;
          else err = 'has no "themes" list';
        } catch (e) {
          err = 'is not valid JSON';
        }
      }
      if (err || !names) {
        files.state = 'failed';
        files.failed = [{ file: 'index.json', why: err || 'empty' }];
        PS.log('theme', 'theme files not read: index.json ' + files.failed[0].why + ' (the built-in themes are used)');
        notify(done);
        return;
      }
      files.listed = names.length;
      files.names = names.slice();
      var got = [],
        left = names.length;
      if (!left) {
        finishLoad(got, done);
        return;
      }
      names.forEach(function (n, i) {
        var file = String(n).replace(/\.json$/i, '') + '.json';
        httpGet(files.base + '/' + file, function (e2, t2) {
          got[i] = e2 ? { file: file, error: e2 } : { file: file, text: t2 };
          if (--left === 0) finishLoad(got, done);
        });
      });
    });
  }
  function finishLoad(got, done) {
    var r = ingest(got);
    files.empty = r.empty;
    files.loaded = got.length - r.failed.length - r.empty;
    files.added = r.added;
    files.replaced = r.replaced;
    files.failed = r.failed;
    files.state = 'done';
    PS.logv('theme', 'index.json names ' + files.names.length + ' theme(s): ' + files.names.join(', '));
    PS.logv(
      'theme',
      'theme files: ' +
        files.loaded +
        ' of ' +
        (files.listed - files.empty) +
        ' read, ' +
        files.empty +
        ' free slot(s) (' +
        r.added +
        ' new, ' +
        r.replaced +
        ' replaced the built-in)' +
        (r.failed.length
          ? '; failed: ' +
            r.failed
              .map(function (f) {
                return f.file + ' ' + f.why;
              })
              .join(', ')
          : '')
    );
    // the saved theme may be one of the files: look again now they are in (and fall back if it is gone)
    if (!find(state.id)) {
      PS.log('theme', 'the saved theme "' + state.id + '" is not available: using ' + THEMES[0].name);
      state.id = THEMES[0].id;
      state.custom = {};
      state.customMap = {};
      save();
    }
    notify(done);
  }
  function notify(done) {
    apply();
    if (done) done(files);
  }

  loadSlots();
  refreshSlots();
  load();
  resolve();

  var api = {
    ROLE_GROUPS: ROLE_GROUPS,
    ROLES: ALL_ROLES,
    THEMES: THEMES,
    byId: byId,
    mix: mix,
    parse: parse,
    hex: hex,
    isHex: isHex,
    normalise: normalise,
    luminance: luminance,
    contrast: contrast,
    mapStyle: mapStyle,
    fillRoles: fillRoles,
    derive: derive,
    palette: palette,
    css: cssText,
    // c('routeBack') -> the colour now. Used by the map drawing.
    c: function (role) {
      return (current || resolve())[role] || '#ff00ff';
    },
    all: function () {
      return current || resolve();
    },
    state: function () {
      return state;
    },
    SLOT_COUNT: SLOT_COUNT,
    slotInfo: function (n) {
      var e = slots[n];
      return { n: n, filled: !!e, name: e ? e.name : '' };
    },
    // Keep the colours in use now as slot n (name is trimmed to 30 characters), and switch to it.
    saveSlot: function (n, name) {
      n = Number(n);
      if (!(n >= 1 && n <= SLOT_COUNT)) return false;
      var nm =
        String(name || '')
          .replace(/^\s+|\s+$/g, '')
          .slice(0, 30) || 'My theme';
      slots[n] = { name: nm, colours: palette() };
      saveSlots();
      refreshSlots();
      state.id = 'slot' + n;
      state.custom = {};
      state.customMap = {};
      save();
      apply();
      return true;
    },
    clearSlot: function (n) {
      n = Number(n);
      if (!slots[n]) return false;
      delete slots[n];
      saveSlots();
      refreshSlots();
      if (state.id === 'slot' + n) {
        state.id = THEMES[0].id;
        state.custom = {};
        state.customMap = {};
        save();
      }
      apply();
      return true;
    },
    workFolder: WORK_FOLDER,
    workFolderSteam: WORK_FOLDER_STEAM,
    workFolderNote: WORK_FOLDER_NOTE,
    loadSaved: loadSaved,
    saveTheme: saveTheme,
    deleteSaved: deleteSaved,
    savedStatus: function () {
      return savedInfo;
    },
    slugify: slugify,
    ingestSaved: ingestSaved,
    loadFiles: loadFiles,
    ingest: ingest,
    validateThemeFile: validateThemeFile,
    fileStatus: function () {
      return files;
    },
    themeBase: themeBase,
    selectedId: function () {
      return find(state.id) ? state.id : THEMES[0].id;
    },
    // The theme's own colour for a role (ignoring the user's changes), to reset to.
    themeColour: function (role) {
      return palette(state.id, {})[role];
    },
    isChanged: function (role) {
      return state.custom[role] !== undefined;
    },
    // Style element to keep up to date (the app makes it).
    attach: function (el) {
      styleEl = el;
    },
    select: function (id) {
      state.id = byId(id).id;
      state.custom = {};
      state.customMap = {};
      save();
      apply();
    },
    setColour: function (role, value) {
      if (ALL_ROLES.indexOf(role) < 0 || !isHex(value)) return false;
      state.custom[role] = normalise(value);
      save();
      apply();
      return true;
    },
    resetColour: function (role) {
      delete state.custom[role];
      save();
      apply();
    },
    // The map's line widths and label size (keys of MAP_DEFAULT), set in the app instead of editing the theme file; saved with a saved theme.
    setMapValue: function (key, v) {
      if (MAP_DEFAULT[key] === undefined) return false;
      v = Number(v);
      if (!isFinite(v) || v < 0 || v > 80) return false;
      state.customMap[key] = v;
      save();
      apply();
      return true;
    },
    resetMap: function () {
      state.customMap = {};
      save();
      apply();
    },
    mapChanged: function () {
      return Object.keys(state.customMap).length > 0;
    },
    resetAll: function () {
      state.custom = {};
      state.customMap = {};
      save();
      apply();
    },
    onChange: function (fn) {
      listeners.push(fn);
    },
    // A theme as text to share, and back. Only roles that differ from the base theme are written.
    exportText: function () {
      return JSON.stringify(
        { app: 'PushPlanner', id: 'my-theme', name: 'My theme', note: 'Saved from Push Planner', theme: state.id, colours: palette() },
        null,
        1
      );
    },
    importText: function (text) {
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { ok: false, why: 'That is not valid JSON.' };
      }
      var cols = data && (data.colours || data.colors || data.custom);
      if (!cols || typeof cols !== 'object') return { ok: false, why: 'No "colours" found in it.' };
      var next = {},
        n = 0,
        k;
      for (k in cols) {
        if (ALL_ROLES.indexOf(k) >= 0 && isHex(cols[k])) {
          next[k] = normalise(cols[k]);
          n++;
        }
      }
      if (!n) return { ok: false, why: 'None of the colours in it are ones this app knows.' };
      if (data.theme && typeof data.theme === 'string' && find(data.theme)) state.id = data.theme;
      state.custom = next;
      save();
      apply();
      return { ok: true, count: n };
    },
    // Where a colour is poorly readable against its background: [{ name, ratio }]
    contrastWarnings: function () {
      var t = current || resolve(),
        out = [];
      [
        ['Main text on panels', t.text, t.panel],
        ['Secondary text on panels', t.textDim, t.panel],
        ['Button text on buttons', t.buttonText, t.button],
        ['Accent text on the accent', t.accentText, t.accent],
        ['Accent on the page', t.accent, t.bg]
      ].forEach(function (c) {
        var ratio = contrast(c[1], c[2]);
        if (ratio < 3) out.push({ name: c[0], ratio: ratio });
      });
      return out;
    }
  };
  return api;
})();
