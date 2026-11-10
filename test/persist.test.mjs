import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PushPlanner/PushPlanner.js');

test('persist: the settings file restores settings, theme and learned pivots once, ignores unknown or wrongly typed values, and is not read as a theme', async () => {
  const saved = [];
  PS.wasmFiles = { save: (name, text) => { saved.push([name, text]); return Promise.resolve({ ok: true }); } };
  const file = {
    name: PS.persist.FILE,
    text: JSON.stringify({
      v: 1,
      settings: { requireBeacon: false, uiSize: 'compact', tightest: 18, bogus: 1, snapM: 'far' },
      theme: { id: 'night', custom: {}, customMap: {} },
      learned: { '72-600': { pivotM: 3.5, pushes: 2, at: 5 }, junk: 7 },
      speedPercent: 70
    })
  };
  PS.persist.ingest([{ name: 'saved-x.json', text: '{}' }, file]);
  assert.equal(PS.settings.get('requireBeacon'), false);
  assert.equal(PS.settings.get('uiSize'), 'compact');
  assert.equal(PS.settings.get('tightest'), 18);
  assert.equal(PS.settings.get('snapM'), 50, 'a value of the wrong type is ignored');
  assert.equal(PS.settings.get('bogus'), undefined, 'an unknown name is ignored');
  assert.equal(PS.theme.getState().id, 'night');
  assert.equal(PS.learned.get({ model: '72-600' }).pivotM, 3.5);
  assert.equal(PS.learned.get({ model: 'junk' }), null);
  assert.equal(PS.push.getSpeedPercent(), 70);
  // a second listing (after a theme was saved, say) must not undo what changed since
  PS.settings.set('requireBeacon', true);
  PS.persist.ingest([file]);
  assert.equal(PS.settings.get('requireBeacon'), true, 'only the first listing is applied');
  // writing: one file with everything
  await PS.persist.flush();
  const last = saved[saved.length - 1];
  assert.equal(last[0], PS.persist.FILE);
  const o = JSON.parse(last[1]);
  assert.equal(o.settings.requireBeacon, true);
  assert.equal(o.theme.id, 'night');
  assert.equal(o.learned['72-600'].pivotM, 3.5);
  assert.equal(o.speedPercent, 70);
  // the settings file is not a theme
  PS.theme.restoreState({ id: 'default', custom: {}, customMap: {} });
  PS.settings.set('uiSize', 'auto');
  PS.settings.set('tightest', 26);
  PS.settings.set('requireBeacon', true);
});

test('persist: the theme loader does not report the settings file as a theme that failed to read', async () => {
  PS.wasmFiles = { list: () => Promise.resolve([{ name: PS.persist.FILE, text: JSON.stringify({ v: 1, settings: {} }) }]), save: () => Promise.resolve({ ok: true }) };
  const info = await new Promise((resolve) => PS.theme.loadSaved(resolve));
  assert.equal(info.state, 'done');
  assert.deepEqual(info.failed, [], 'nothing failed: the settings file was skipped');
  assert.equal(info.count, 0);
});

test('migrate: a file of any older format is walked up one step at a time, a missing number means format 1, a newer one is left alone, a missing step is reported', () => {
  const steps = {
    1: (o) => { o.renamed = o.old; delete o.old; return o; },
    2: (o) => { o.list = [o.renamed]; return o; }
  };
  const a = PS.migrate({ old: 'x' }, 'v', 3, steps);                      // no "v": format 1
  assert.deepEqual([a.from, a.to, a.migrated, a.newer], [1, 3, true, false]);
  assert.equal(a.obj.v, 3);
  assert.deepEqual(a.obj.list, ['x'], 'both steps ran, in order');
  const input = { v: 2, renamed: 'y' };
  const b = PS.migrate(input, 'v', 3, steps);
  assert.deepEqual(b.obj.list, ['y'], 'a format 2 file only needs the last step');
  assert.equal(input.v, 2, 'the input is not changed');
  const c = PS.migrate({ v: 9 }, 'v', 3, steps);
  assert.equal(c.newer, true, 'a newer format is flagged');
  assert.equal(c.obj.v, 9, 'and left as it is');
  const d = PS.migrate({ v: 1 }, 'v', 3, { 1: (o) => o });                 // step 2 is missing
  assert.equal(d.broken, true);
  assert.equal(d.to, 2);
  assert.equal(PS.migrate({ v: 3 }, 'v', 3, steps).migrated, false, 'the current format needs nothing');
});

test('persist: the settings file records its format and the app version; one from a newer format is read but never overwritten; one with no format is rewritten', async () => {
  const saved = [];
  PS.wasmFiles = { save: (name, text) => { saved.push([name, text]); return Promise.resolve({ ok: true }); } };
  PS.persist._forget();
  PS.persist.ingest([{ name: PS.persist.FILE, text: JSON.stringify({ v: 99, app: '9.0.0', settings: { requireBeacon: false }, extra: 1 }) }]);
  assert.equal(PS.settings.get('requireBeacon'), false, 'a newer file is still read');
  PS.settings.set('uiSize', 'compact');
  await PS.persist.flush();
  assert.equal(saved.length, 0, 'but nothing is written over it');
  PS.persist._forget();
  PS.persist.ingest([{ name: PS.persist.FILE, text: JSON.stringify({ settings: { requireBeacon: true } }) }]);   // the first format had no number
  await PS.persist.flush();
  const o = JSON.parse(saved[saved.length - 1][1]);
  assert.equal(o.v, PS.persist.SCHEMA);
  assert.equal(o.app, PS.VERSION, 'the app version that wrote it is recorded');
  PS.settings.set('uiSize', 'auto');
  PS.settings.set('requireBeacon', true);
});

test('themes: a saved theme says which format and app version wrote it; a file with no format still loads; one from a newer format that does not validate says why', async () => {
  let wrote = null;
  PS.wasmFiles = {
    save: (name, text) => { wrote = [name, text]; return Promise.resolve({ ok: true }); },
    list: () => Promise.resolve([wrote ? { name: wrote[0], text: wrote[1] } : { name: 'x.json', text: '{}' }])
  };
  const r = await new Promise((resolve) => PS.theme.saveTheme('Format check', resolve));
  assert.equal(r.ok, true);
  const t = JSON.parse(wrote[1]);
  assert.equal(t.format, 1);
  assert.equal(t.app, PS.VERSION);
  const old = Object.assign({}, t); delete old.format; delete old.app; old.id = 'old-one'; old.name = 'Old one';
  const future = { format: 7, id: 'future-one', name: 'Future', page: {} };
  const res = PS.theme.ingest([{ file: 'old.json', text: JSON.stringify(old) }, { file: 'future.json', text: JSON.stringify(future) }]);
  assert.equal(res.added, 1, 'the file with no format loads');
  assert.match(res.failed[0].why, /newer version of the app: theme format 7/);
});
