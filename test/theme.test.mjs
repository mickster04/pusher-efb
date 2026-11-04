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
