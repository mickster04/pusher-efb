import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PushPlanner/PushPlanner.js');

const vals = { 'PLANE LATITUDE': 51.47, 'PLANE LONGITUDE': -0.45, 'PLANE HEADING DEGREES TRUE': 90, 'SIM ON GROUND': 1, 'NUMBER OF ENGINES': 2, 'GENERAL ENG COMBUSTION:1': 1, 'GENERAL ENG COMBUSTION:2': 0, 'TURBINE ENG N1:1': 30 };
globalThis.SimVar = { GetSimVarValue: (n) => (n in vals ? vals[n] : 0), SetSimVarValue: () => Promise.resolve() };
const lines = () => PS.logs.map((l) => PS.fmtLog(l)).join('\n');

test('logv keeps detail only while detailed logging is on or a check is running', () => {
  PS.logs.length = 0;
  PS.logv('x', 'quiet');
  assert.equal(PS.logs.length, 0);
  PS.detail.on = true;
  PS.logv('x', 'loud');
  PS.detail.on = false;
  PS.detail.running = 1;
  PS.logv('x', 'during a check');
  PS.detail.running = 0;
  assert.deepEqual(PS.logs.map((l) => l.msg), ['loud', 'during a check']);
});

test('every check has an id, a title and a description, and ids are unique', () => {
  const ids = PS.diag.CHECKS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  PS.diag.CHECKS.forEach((c) => assert.ok(c.title && c.what && typeof c.run === 'function', c.id));
});

test('a check logs its detail, reports a status, and turns detail logging off again', async () => {
  PS.logs.length = 0;
  const r = await PS.diag.run('engines');
  assert.equal(r.status, 'ok');
  assert.match(r.text, /2 engine\(s\), 1 running/);
  assert.match(lines(), /\[diag\] engine 1: combustion true/);
  assert.match(lines(), /Engines: OK/);
  assert.equal(PS.detail.running, 0);
});

test('the sim, services and an unknown check', async () => {
  const sim = await PS.diag.run('sim');
  assert.ok(sim.status === 'ok' || sim.status === 'warn', sim.text);
  const svc = await PS.diag.run('services');
  assert.equal(svc.status, 'ok');
  const none = await PS.diag.run('nope');
  assert.equal(none.status, 'fail');
  assert.equal(PS.detail.running, 0);
});

test('a check that throws is reported as failed, not thrown', async () => {
  PS.diag.CHECKS.push({ id: 'boom', title: 'Boom', what: 'x', run: () => { throw new Error('bang'); } });
  const r = await PS.diag.run('boom');
  PS.diag.CHECKS.pop();
  assert.equal(r.status, 'fail');
  assert.match(r.text, /bang/);
  assert.equal(PS.detail.running, 0);
});

test('the aircraft check reads the title and friends, and the line for the log header says so even when it cannot', async () => {
  vals.TITLE = 'Airbus A320neo Test Livery'; vals['ATC MODEL'] = 'A320'; vals['ATC AIRLINE'] = 'Test Air';
  PS.logs.length = 0;
  const r = await PS.diag.run('aircraft');
  assert.equal(r.status, 'ok'); assert.match(r.text, /A320neo/);
  assert.match(PS.aircraftLine(), /aircraft: Airbus A320neo Test Livery \| model A320 \| airline Test Air \| engines 2/);
  assert.match(lines(), /aircraft: Airbus A320neo/);
  delete vals.TITLE; delete vals['ATC MODEL']; delete vals['ATC AIRLINE'];
  const r2 = await PS.diag.run('aircraft');
  assert.equal(r2.status, 'warn');
  assert.match(PS.aircraftLine(), /title unreadable/);
});

test('the startup probe starts using the aircraft\'s brake lever variable and logs every engine reading, including the FlyByWire ones', () => {
  vals.TITLE = 'Airbus A330-900neo Condor Sea';
  vals['ATC MODEL'] = 'TT:ATCCOM.AC_MODEL A330.0.text';
  vals['L:A32NX_PARK_BRAKE_LEVER_POS'] = 1;
  vals['L:A32NX_ENGINE_STATE:2'] = 1; // engine 2: the sim says no combustion, FlyByWire says on
  vals['L:A32NX_ENGINE_N1:1'] = 22;
  PS.logs.length = 0;
  const r = PS.probe.run('test');
  assert.equal(r.brakeLvar, 'L:A32NX_PARK_BRAKE_LEVER_POS', 'from the A330 profile');
  assert.equal(PS.brake.read(false).lvar.name, 'L:A32NX_PARK_BRAKE_LEVER_POS', 'and the brake is now read through it');
  assert.ok(PS.brake.read(false).set, 'so a set lever counts as the brake being set');
  assert.ok(/FlyByWire state 1/.test(lines()), 'the engine readings are in the log: ' + lines());
  assert.ok(PS.engines.update(true).rows[1].on, 'and the FlyByWire engine state counts as running even though the sim says combustion is off');
  ['TITLE', 'ATC MODEL', 'L:A32NX_PARK_BRAKE_LEVER_POS', 'L:A32NX_ENGINE_STATE:2', 'L:A32NX_ENGINE_N1:1'].forEach((k) => delete vals[k]);
});
