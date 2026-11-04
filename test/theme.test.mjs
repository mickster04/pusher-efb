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

test('theme: choosing a preset, setting a colour, resetting it, and sharing a theme as text', () => {
  T.select('klm');
  assert.equal(T.selectedId(), 'klm');
  assert.equal(T.c('accent'), '#00a1de');
  assert.equal(T.setColour('accent', '#FF0000'), true);
  assert.equal(T.c('accent'), '#ff0000'); assert.ok(T.isChanged('accent'));
  assert.ok(PS.theme.css().indexOf('#ff0000') >= 0, 'the stylesheet picked it up');
  assert.equal(T.setColour('accent', 'nonsense'), false, 'a bad value is refused');
  assert.equal(T.setColour('notARole', '#123456'), false);
  const text = T.exportText();
  T.resetAll();
  assert.equal(T.c('accent'), '#00a1de');
  const r = T.importText(text);
  assert.ok(r.ok && r.count >= 30, 'imported ' + r.count);
  assert.equal(T.c('accent'), '#ff0000');
  assert.equal(T.importText('{not json').ok, false);
  assert.equal(T.importText('{"colours":{"nope":"#fff"}}').ok, false);
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

test('theme files: the presets in the package folder are the ones built in, and an exported theme is a valid file', () => {
  const fs = require('node:fs');
  const dir = new URL('../PackageSources/PushPlanner/themes/', import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL('index.json', dir), 'utf8'));
  assert.ok(index.themes.length >= 15);
  let empties = 0;
  index.themes.forEach((id) => {
    const t = JSON.parse(fs.readFileSync(new URL(id + '.json', dir), 'utf8'));
    if (t.empty) { empties++; return; }
    assert.equal(T.validateThemeFile(t), '', id);
    assert.equal(T.byId(id).id, id);
  });
  assert.equal(empties, 8, 'eight free slots to put a theme in');
  const exported = JSON.parse(T.exportText());
  assert.equal(T.validateThemeFile(exported), '', 'the copied theme can be saved straight as a theme file');
});

test('theme files: an empty slot is skipped quietly, and a slot that has been filled in loads', () => {
  const slot = (n) => JSON.stringify({ id: 'user' + n, name: 'User theme ' + n, empty: true });
  const filled = JSON.stringify({ id: 'my-green', name: 'My green', colours: { bg: '#102010', text: '#e0ffe0', accent: '#44dd44', panel: '#183018' } });
  const r = T.ingest([{ file: 'user1.json', text: slot(1) }, { file: 'user2.json', text: filled }, { file: 'user3.json', text: slot(3) }]);
  assert.equal(r.empty, 2); assert.equal(r.added, 1); assert.equal(r.failed.length, 0);
  assert.equal(T.byId('my-green').name, 'My green');
  assert.ok(!T.THEMES.some((th) => th.id === 'user1'), 'an empty slot is not a theme');
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
