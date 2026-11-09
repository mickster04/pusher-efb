// Builds the single file the EFB loads: PackageSources/PushPlanner/PushPlanner.js. No dependencies.
//
// Source layout (src/):
//   core/      sim access and logging, geometry, saved settings
//   data/      taxi, traffic and airport data, the taxi WASM client, air traffic
//   planning/  route planner, push suggester, the plan (pins)
//   push/      tug and brake control, path follower, the push state machine
//   ui/        widgets, theme and colours, map maths and drawing
//   pages/     the Plan, Push and Settings tabs
//   app.js     the shell and EFB registration (last)
//   styles/    styles.css, a template: @role@ tokens are filled from the theme at run time
//   icons/     one SVG file per icon (kebab-case name -> camelCase key, e.g. zoom-in.svg -> 'zoomIn')
//   themes/    one JSON file per preset colour theme plus index.json (the order). They are built into the bundle (so a theme always works) AND copied to
//              PackageSources/PushPlanner/themes/, which the package ships; the app reads those files when it starts, so a theme can be edited there.
//              (the sim only serves files the package's layout.json lists, so a theme file added to an installed package later is a 404)
//
// The modules share one scope and some use others while loading, so the ORDER below matters. Every .js under src/ has to be listed (the build fails
// if one is missing), so a new file cannot be forgotten.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const out = join(root, 'PackageSources', 'PushPlanner', 'PushPlanner.js');

const ORDER = [
  'core/core.js',
  'core/i18n.js',
  'core/i18n-sim.js',
  'core/geo.js',
  'data/taxi-data.js',
  'ui/theme.js',
  'data/traffic-data.js',
  'ui/ui.js',
  'data/wasm-taxi.js',
  'data/wasm-files.js',
  'ui/plot-draw.js',
  'ui/plot-math.js',
  'planning/route-planner.js',
  'planning/push-suggest.js',
  'planning/planner-texts.js',
  'planning/plan.js',
  'core/settings.js',
  'push/tug.js',
  'push/aircraft-profiles.js',
  'push/learned.js',
  'push/follow.js',
  'push/gate.js',
  'push/engines.js',
  'push/push.js',
  'push/services.js',
  'data/facility.js',
  'data/air-traffic.js',
  'diag/probe.js',
  'diag/checks.js',
  'ui/diag-panel.js',
  'pages/plan.js',
  'pages/push.js',
  'ui/colours.js',
  'pages/settings.js',
  'app.js'
];

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
const onDisk = walk(srcDir)
  .map((f) => relative(srcDir, f).split(sep).join('/'))
  .filter((f) => f.endsWith('.js'));
const missing = onDisk.filter((f) => !ORDER.includes(f));
const gone = ORDER.filter((f) => !onDisk.includes(f));
if (missing.length || gone.length) {
  console.error(
    'build.mjs ORDER is out of step with src/. Not listed: ' +
      (missing.join(', ') || 'none') +
      '. Listed but missing: ' +
      (gone.join(', ') || 'none')
  );
  process.exit(1);
}

const css = readFileSync(join(srcDir, 'styles', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .trim();

// icons/*.svg -> { camelName: ['d', '#filled d', ...] }
const icons = {};
const iconDir = join(srcDir, 'icons');
for (const f of readdirSync(iconDir)
  .filter((n) => n.endsWith('.svg'))
  .sort()) {
  const svg = readFileSync(join(iconDir, f), 'utf8');
  const key = f.slice(0, -4).replace(/-([a-z0-9])/g, (m, c) => c.toUpperCase());
  const paths = [];
  const re = /<path\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(svg))) {
    const d = /\bd="([^"]*)"/.exec(m[1]);
    if (!d) throw new Error(f + ': a <path> without d');
    paths.push((/\bfill="currentColor"/.test(m[1]) ? '#' : '') + d[1]);
  }
  if (!paths.length) throw new Error(f + ': no <path> found (only <path> elements are supported)');
  icons[key] = paths;
}

// themes/*.json (listed in themes/index.json) -> built in, and copied to the package folder the app reads at run time
const themeDir = join(srcDir, 'themes');
const themeIds = JSON.parse(readFileSync(join(themeDir, 'index.json'), 'utf8')).themes;
const themes = themeIds.map((id) => JSON.parse(readFileSync(join(themeDir, id + '.json'), 'utf8')));
const themeOut = join(root, 'PackageSources', 'PushPlanner', 'themes');
if (existsSync(themeOut)) rmSync(themeOut, { recursive: true });
mkdirSync(themeOut, { recursive: true });
copyFileSync(join(themeDir, 'index.json'), join(themeOut, 'index.json'));
for (const id of themeIds) copyFileSync(join(themeDir, id + '.json'), join(themeOut, id + '.json'));

// the translations ship in the package too, in the sim's own format (the sim may read them: core/i18n-sim.js tries)
const locOut = join(root, 'PackageSources', 'localization');
mkdirSync(locOut, { recursive: true });
copyFileSync(join(srcDir, 'lang', 'pushplanner.loc'), join(locOut, 'pushplanner.loc'));

// the licence and notices ship in the package next to the app (MIT: they must accompany copies)
for (const n of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(join(root, n), join(root, 'PackageSources', 'PushPlanner', n));

// lang/pushplanner.loc (the sim's .loc format) -> { 'de-DE': { 'English text': 'Deutsch' } } embedded for PS.t. English is the source text, so it has no table.
const loc = JSON.parse(readFileSync(join(srcDir, 'lang', 'pushplanner.loc'), 'utf8')).LocalisationFile;
const langTable = {};
const langPatterns = [];
const langKeys = {};
for (const [key, entry] of Object.entries(loc.Strings)) {
  const en = entry.Languages['en-US'] && entry.Languages['en-US'].Text;
  if (key.startsWith('PUSHPLANNER.PATTERN.')) langPatterns.push(en);
  langKeys[en] = key;
  for (const [code, v] of Object.entries(entry.Languages)) {
    if (code === 'en-US' || !v.Text) continue;
    (langTable[code] = langTable[code] || {})[en] = v.Text;
  }
}

const parts = [
  '/* Push Planner - MSFS 2024 EFB app. Generated by build.mjs from src/. Do not edit.',
  ' * MIT licence, (c) 2026 Mike Cleaver. Parts derived from Pusher (MIT, (c) Palm Coasty Simulations).',
  ' * Full notices: LICENSE and THIRD_PARTY_NOTICES.md, shipped alongside this file. */',
  '(function () {',
  "'use strict';",
  'var PS = {};',
  'PS.CSS = ' + JSON.stringify(css) + ';',
  'PS.ICONS = ' + JSON.stringify(icons) + ';',
  'PS.BUILTIN_THEMES = ' + JSON.stringify(themes) + ';',
  'PS.LANG_KEYS = ' + JSON.stringify(langKeys) + ';',
  'PS.LANG_PATTERNS = ' + JSON.stringify(langPatterns) + ';',
  'PS.LANG_TABLE = ' +
    JSON.stringify(langTable).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) +
    ';'
];
for (const f of ORDER) {
  parts.push('/* ---- ' + f + ' ---- */');
  parts.push(readFileSync(join(srcDir, f), 'utf8'));
}
parts.push("if (typeof module !== 'undefined' && module.exports) { module.exports = PS; }");
parts.push('})();');

// The version lives in package.json only (npm run bump): the bundle and the package definition follow it.
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const defFile = join(root, 'PackageDefinitions', 'push-planner.xml');
const def = readFileSync(defFile, 'utf8');
const defNew = def.replace(/(<AssetPackage Version=")[^"]*(")/, '$1' + version + '$2');
if (defNew !== def) writeFileSync(defFile, defNew);
writeFileSync(out, parts.join('\n').replace(/PS\.VERSION = '[^']*';/, "PS.VERSION = '" + version + "';") + '\n');
console.log('built', out, 'v' + version, '(' + ORDER.length + ' modules, ' + Object.keys(icons).length + ' icons, ' + themes.length + ' themes)');
