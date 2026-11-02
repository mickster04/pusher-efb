import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PusherSpikes/PusherSpikes.js');

test('distance and bearing', () => {
  const d = PS.geo.distanceM(0, 0, 0, 1);
  assert.ok(Math.abs(d - 111195) < 200);
  assert.ok(Math.abs(PS.geo.bearingDeg(0, 0, 1, 0) - 0) < 0.01);
  assert.ok(Math.abs(PS.geo.bearingDeg(0, 0, 0, 1) - 90) < 0.01);
});

test('angleDiff wraps', () => {
  assert.equal(PS.geo.angleDiff(350, 10), 20);
  assert.equal(PS.geo.angleDiff(10, 350), -20);
  assert.equal(PS.geo.normDeg(-90), 270);
});

test('offset round trip', () => {
  const p = PS.geo.offset(51.47, -0.45, 45, 500);
  assert.ok(Math.abs(PS.geo.distanceM(51.47, -0.45, p[0], p[1]) - 500) < 1);
  assert.ok(Math.abs(PS.geo.bearingDeg(51.47, -0.45, p[0], p[1]) - 45) < 0.1);
});

test('nearestOnPolyline projects onto a segment', () => {
  const a = PS.geo.offset(0, 0, 90, -100), b = PS.geo.offset(0, 0, 90, 100);
  const n = PS.geo.nearestOnPolyline([a, b], PS.geo.offset(0, 0, 0, 50)[0], 0);
  assert.ok(Math.abs(n.distM - 50) < 1);
});

test('traffic: head-on contact closes and has CPA near zero', () => {
  const own = { lat: 0, lon: 0, hdgDeg: 0, gsKt: 10, altFt: 0 };
  const p = PS.geo.offset(0, 0, 0, 200);
  const r = PS.traffic.analyse(own, { lat: p[0], lon: p[1], hdgDeg: 180, gsKt: 10, altFt: 0 });
  assert.ok(Math.abs(r.distM - 200) < 1);
  assert.ok(r.closingKt > 19 && r.closingKt < 21);
  assert.ok(r.cpaM < 1);
  assert.ok(Math.abs(r.tcpaSec - 200 / (20 * PS.geo.KT_TO_MS)) < 0.5);
  assert.equal(r.ahead, true);
});

test('traffic: stationary contact has no tcpa when both stopped', () => {
  const own = { lat: 0, lon: 0, hdgDeg: 0, gsKt: 0, altFt: 0 };
  const r = PS.traffic.analyse(own, { lat: 0.001, lon: 0, hdgDeg: 0, gsKt: 0, altFt: 100 });
  assert.equal(r.tcpaSec, null);
  assert.equal(r.altDiffFt, 100);
});

test('taxi extract + aggregate on the sample layout', () => {
  const s = PS.taxi.sample(51.47, -0.45);
  const ex = PS.taxi.extract({ runways: s.runways, paths: s.paths, parking: s.parking });
  const rows = PS.taxi.aggregate(ex.items, 51.47, -0.45);
  const a = rows.find((r) => r.name === 'A' && r.category === 'Taxiway');
  assert.equal(a.segments, 4);
  assert.ok(a.lengthM > 400 && a.lengthM < 520);
  assert.ok(rows.find((r) => r.category === 'Runway'));
  assert.ok(rows.find((r) => r.category === 'Parking connector'));
  assert.equal(ex.parking.length, 2);
});

test('taxi extract reports unknown shapes instead of failing', () => {
  const ex = PS.taxi.extract({ icao: 'KSEA', frequencies: [] });
  assert.equal(ex.items.length, 0);
  assert.ok(/Top-level keys/.test(ex.notes[0]));
  assert.equal(PS.taxi.extract(null).items.length, 0);
});

test('toasts: show, update, dismiss', () => {
  PS.toasts.clear();
  const id = PS.toasts.show({ kind: 'info', title: 'x', persistent: true });
  assert.equal(PS.toasts.items.length, 1);
  PS.toasts.update(id, { message: 'm' });
  assert.equal(PS.toasts.items[0].message, 'm');
  PS.toasts.dismiss(id);
  assert.equal(PS.toasts.items.length, 0);
});

test('sim wrappers fail soft without a sim', () => {
  assert.equal(PS.getVar('X', 'number').ok, false);
  assert.equal(PS.setVar('X', 'number', 1).ok, false);
  assert.equal(PS.keyEvent('X', 1, 'coherent').ok, false);
  assert.equal(PS.readOwn(), null);
});

test('runway centre + heading + length becomes a line of the right length', () => {
  const ex = PS.taxi.extract({ runways: [{ designation: '02/20', latitude: -43.49, longitude: 172.53, direction: 20, length: 3000, width: 45 }] });
  assert.equal(ex.items.length, 1);
  assert.equal(ex.items[0].points.length, 2);
  const len = PS.geo.polylineLengthM(ex.items[0].points);
  assert.ok(Math.abs(len - 3000) < 5);
});
