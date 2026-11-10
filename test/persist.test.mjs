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
