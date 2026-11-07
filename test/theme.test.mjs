import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PushPlanner/PushPlanner.js');
const T = PS.theme;

test('theme: every preset resolves to valid colours for every role and token', () => {
  assert.ok(T.THEMES.length >= 15, 'a good set of presets: ' + T.THEMES.length);
  const names = ['Delta', 'British Airways', 'Lufthansa', 'Air New Zealand', 'Eurowings'];
  names.forEach((n) => assert.ok(T.THEMES.some((t) => t.name === n), n + ' is there'));
  T.THEMES.forEach((th) => {
    const tokens = T.derive(T.fillRoles(th.p));
    T.ROLES.forEach((r) => assert.ok(T.isHex(tokens[r]), th.name + ' ' + r + ' = ' + tokens[r]));
    Object.keys(tokens).forEach((k) => assert.ok(T.isHex(tokens[k]), th.name + ' token ' + k));
  });
});

test('theme: the stylesheet has no token left unresolved for any preset, and the default matches the original look', () => {
  const tokenNames = Array.from(new Set((PS.CSS.match(/@(\w+)@/g) || []).map((m) => m.slice(1, -1))));
  assert.ok(tokenNames.length > 20, 'the stylesheet is a template');
  T.THEMES.forEach((th) => {
    const tokens = T.derive(T.fillRoles(th.p));
    tokenNames.forEach((n) => assert.ok(tokens[n] !== undefined, th.name + ' lacks token ' + n));
  });
  const d = T.derive(T.fillRoles(T.byId('default').p));
  assert.equal(d.bg, '#131c24'); assert.equal(d.accent, '#f0a830'); assert.equal(d.panel, '#1b2630'); assert.equal(d.routeFwd, '#5aa8ff'); assert.equal(d.mapBg, '#0f171e');
});

test('theme: text is readable on the panels in every preset', () => {
  T.THEMES.forEach((th) => {
    const t = T.derive(T.fillRoles(th.p));
    assert.ok(T.contrast(t.text, t.panel) >= 4.5, th.name + ' main text ' + T.contrast(t.text, t.panel).toFixed(1));
    assert.ok(T.contrast(t.accentText, t.accent) >= 3, th.name + ' text on accent ' + T.contrast(t.accentText, t.accent).toFixed(1));
    assert.ok(T.contrast(t.textDim, t.panel) >= 3, th.name + ' secondary text ' + T.contrast(t.textDim, t.panel).toFixed(1));
    assert.ok(T.contrast(t.buttonText, t.button) >= 4.5, th.name + ' button text ' + T.contrast(t.buttonText, t.button).toFixed(1));
  });
});

test('theme: choosing a preset, setting a colour, and resetting it', () => {
  T.select('klm');
  assert.equal(T.selectedId(), 'klm');
  assert.equal(T.c('accent'), '#00a1de');
  assert.equal(T.setColour('accent', '#FF0000'), true);
  assert.equal(T.c('accent'), '#ff0000'); assert.ok(T.isChanged('accent'));
  assert.ok(PS.theme.css().indexOf('#ff0000') >= 0, 'the stylesheet picked it up');
  assert.equal(T.setColour('accent', 'nonsense'), false, 'a bad value is refused');
  assert.equal(T.setColour('notARole', '#123456'), false);
  T.resetAll();
  assert.equal(T.c('accent'), '#00a1de');
  T.select('default');
  assert.equal(T.c('accent'), '#f0a830');
});

test('theme: colour maths', () => {
  assert.equal(T.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(T.normalise('#ABC'), '#aabbcc');
  assert.equal(T.parse('red'), null);
  assert.ok(T.contrast('#000000', '#ffffff') > 20);
});

test('theme files: valid ones add or replace themes, bad ones are reported and ignored', () => {
  const before = T.THEMES.length;
  const good = JSON.stringify({ id: 'file-test', name: 'File test', note: 'from a file', colours: { bg: '#102030', text: '#eeeeee', accent: '#ff8800', panel: '#203040' } });
  const replace = JSON.stringify({ id: 'klm', name: 'KLM (edited)', colours: { bg: '#001122', text: '#ffffff', accent: '#00ccff' } });
  const r = T.ingest([
    { file: 'file-test.json', text: good },
    { file: 'klm.json', text: replace },
    { file: 'broken.json', text: '{nope' },
    { file: 'noid.json', text: JSON.stringify({ name: 'x', colours: { bg: '#000', text: '#fff' } }) },
    { file: 'nobg.json', text: JSON.stringify({ id: 'nobg', colours: { accent: '#fff', text: '#fff', panel: '#000' } }) },
    { file: 'missing.json', error: 'could not be read (status 404)' }
  ]);
  assert.equal(r.added, 1); assert.equal(r.replaced, 1);
  assert.equal(r.failed.length, 4, r.failed.map((f) => f.file + ': ' + f.why).join('; '));
  assert.equal(T.THEMES.length, before + 1);
  assert.equal(T.byId('klm').name, 'KLM (edited)'); assert.equal(T.byId('klm').fromFile, true);
  T.select('file-test');
  assert.equal(T.c('bg'), '#102030'); assert.equal(T.c('accent'), '#ff8800');
  assert.ok(T.derive(T.fillRoles(T.byId('file-test').p)).panelHi, 'the rest of the palette is filled in');
  T.select('default');
});

test('theme files: the presets in the package folder are the ones built in', () => {
  const fs = require('node:fs');
  const dir = new URL('../PackageSources/PushPlanner/themes/', import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
  assert.ok(index.themes.length >= 15);
  index.themes.forEach((id) => {
    const t = JSON.parse(fs.readFileSync(new URL(id + '.json', dir), 'utf8'));
    assert.equal(T.validateThemeFile(t), '', id);
    assert.equal(T.byId(id).id, id);
  });
});

test('theme files: a theme file in the package loads', () => {
  const filled = JSON.stringify({ id: 'my-green', name: 'My green', colours: { bg: '#102010', text: '#e0ffe0', accent: '#44dd44', panel: '#183018' } });
  const r = T.ingest([{ file: 'my-green.json', text: filled }]);
  assert.equal(r.added, 1); assert.equal(r.failed.length, 0);
  assert.equal(T.byId('my-green').name, 'My green');
  T.select('default');
});

test('theme slots: saving keeps the colours in use as a theme in that slot, and clearing takes it away', () => {
  T.select('klm'); T.setColour('accent', '#ff8800');
  assert.equal(T.saveSlot(3, '  My orange KLM  '), true);
  assert.equal(T.slotInfo(3).name, 'My orange KLM'); assert.ok(T.slotInfo(3).filled);
  assert.equal(T.selectedId(), 'slot3', 'it switches to the saved slot');
  assert.equal(T.c('accent'), '#ff8800'); assert.equal(T.isChanged('accent'), false, 'the change is now part of the theme');
  assert.ok(T.THEMES.some((t) => t.id === 'slot3' && t.fromSlot === 3), 'listed with the others');
  T.select('default'); T.select('slot3');
  assert.equal(T.c('accent'), '#ff8800', 'and picking it again gives the same colours');
  assert.equal(T.saveSlot(9, 'x'), false, 'only slots 1 to 8');
  assert.equal(T.saveSlot(1, ''), true); assert.equal(T.slotInfo(1).name, 'My theme', 'a blank name gets a default');
  assert.equal(T.clearSlot(3), true);
  assert.ok(!T.THEMES.some((t) => t.id === 'slot3'));
  assert.equal(T.selectedId(), 'slot1', 'clearing a slot that is not in use leaves the choice alone');
  T.clearSlot(1);
  assert.equal(T.selectedId(), T.THEMES[0].id, 'clearing the slot in use falls back to the first theme');
  T.select('default');
});

test('saved themes: saving writes a file named after the theme through the files module, it comes back as a theme, and can be deleted', async () => {
  const files = {};
  const orig = { list: PS.wasmFiles.list, save: PS.wasmFiles.save, remove: PS.wasmFiles.remove };
  PS.wasmFiles.list = () => Promise.resolve(Object.keys(files).map((n) => ({ name: n, text: files[n] })));
  PS.wasmFiles.save = (name, text) => { files[name] = text; return Promise.resolve({ ok: true, detail: '' }); };
  PS.wasmFiles.remove = (name) => { const had = name in files; delete files[name]; return Promise.resolve({ ok: had, detail: had ? '' : 'missing' }); };
  const call = (fn, ...a) => new Promise((resolve) => fn(...a, resolve));
  try {
    T.select('delta'); T.setColour('accent', '#00ff00');
    const r = await call(T.saveTheme, '  Delta  night!  ');
    assert.equal(r.ok, true); assert.equal(r.where, 'file'); assert.equal(r.file, 'delta-night.json');
    assert.match(r.folder, /push-planner\\work$/, 'the folder is reported');
    const saved = JSON.parse(files['delta-night.json']);
    assert.equal(saved.name, 'Delta night!'); assert.equal(saved.page.controls.accent, '#00ff00'); assert.equal(T.validateThemeFile(saved), '', 'a valid theme file that can be shared');
    assert.ok(T.THEMES.some((t) => t.fromSaved === 'delta-night.json'), 'listed as a theme');
    assert.equal(T.byId(T.selectedId()).fromSaved, 'delta-night.json', 'and selected');
    assert.equal(T.c('accent'), '#00ff00');
    // a file somebody else dropped into the folder is picked up on the next load, and never replaces a preset
    files['friend.json'] = JSON.stringify({ id: 'klm', name: 'Friend KLM', colours: { bg: '#001122', text: '#ffffff', accent: '#abcdef' } });
    files['junk.json'] = '{nope';
    const klmName = T.byId('klm').name;
    await call(T.loadSaved);
    assert.equal(T.byId('klm').name, klmName, 'the preset is untouched');
    assert.ok(T.THEMES.some((t) => t.name === 'Friend KLM' && t.id === 'klm-saved'));
    assert.deepEqual(T.savedStatus().failed.map((f) => f.file), ['junk.json']);
    const d = await call(T.deleteSaved, 'delta-night.json');
    assert.equal(d.ok, true); assert.ok(!('delta-night.json' in files));
    assert.ok(!T.THEMES.some((t) => t.fromSaved === 'delta-night.json'));
  } finally { Object.assign(PS.wasmFiles, orig); T.select('default'); }
});

test('saved themes: with no files module the theme is kept in the app\'s storage instead', async () => {
  const orig = { save: PS.wasmFiles.save };
  PS.wasmFiles.save = () => Promise.reject(new Error('no reply'));
  try {
    T.select('klm');
    const r = await new Promise((resolve) => T.saveTheme('Fallback one', resolve));
    assert.equal(r.ok, true); assert.equal(r.where, 'storage'); assert.ok(r.slot >= 1);
    assert.ok(T.THEMES.some((t) => t.name === 'Fallback one' && t.fromSlot));
    T.clearSlot(r.slot);
  } finally { Object.assign(PS.wasmFiles, orig); T.select('default'); }
});
