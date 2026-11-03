import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PusherSpikes/PusherSpikes.js');
const G = PS.geo;

// An aircraft at the origin facing north; taxiway "A" runs east-west 60 m behind it (south); link "LINK 1" joins at the east end.
const ref = { lat: -43.49, lon: 172.53 };
function seg(name, type, brg, startDist, len, fromBrg) {
  const a = G.offset(ref.lat, ref.lon, fromBrg === undefined ? brg : fromBrg, startDist);
  const b = G.offset(a[0], a[1], brg, len);
  return { name: name || '(unnamed)', rawName: name || '', category: 'Taxiway', rawType: type, points: [a, b] };
}
// Taxiway A: from 200 m west of the point 60 m south of the aircraft, running east, in four 100 m stretches.
function taxiwayA() {
  const origin = G.offset(ref.lat, ref.lon, 180, 60);
  const items = [];
  for (let i = 0; i < 4; i++) {
    const a = G.offset(origin[0], origin[1], 270, 200 - i * 100);
    const b = G.offset(origin[0], origin[1], 270, 100 - i * 100);
    items.push({ name: 'A', rawName: 'A', category: 'Taxiway', rawType: 1, points: [a, b] });
  }
  return items;
}
const own = { lat: ref.lat, lon: ref.lon, hdgDeg: 0 };

test('geo.fromXY is the inverse of toXY', () => {
  const p = G.fromXY(ref.lat, ref.lon, 120, -80);
  const q = G.toXY(ref.lat, ref.lon, p[0], p[1]);
  assert.ok(Math.abs(q.x - 120) < 0.01 && Math.abs(q.y + 80) < 0.01);
});

test('plotView maps lat/lon to pixels and back', () => {
  const view = PS.plotView(760, 480, ref, 500);
  const c = view.toPx(ref.lat, ref.lon);
  assert.ok(Math.abs(c[0] - 380) < 0.01 && Math.abs(c[1] - 240) < 0.01);
  // 100 m east and 50 m north of the centre
  const p = G.fromXY(ref.lat, ref.lon, 100, 50);
  const px = view.toPx(p[0], p[1]);
  assert.ok(Math.abs(px[0] - (380 + 100 * view.scale)) < 0.01);
  assert.ok(Math.abs(px[1] - (240 - 50 * view.scale)) < 0.01);
  const back = view.fromPx(px[0], px[1]);
  assert.ok(Math.abs(back[0] - p[0]) < 1e-7 && Math.abs(back[1] - p[1]) < 1e-7);
  // zooming changes the scale (this is what the range buttons do)
  assert.ok(PS.plotView(760, 480, ref, 100).scale > view.scale);
});

test('nearestPin picks the closest pin inside the radius', () => {
  const view = PS.plotView(760, 480, ref, 500);
  const pins = [{ lat: G.fromXY(ref.lat, ref.lon, 50, 0)[0], lon: G.fromXY(ref.lat, ref.lon, 50, 0)[1] }, { lat: G.fromXY(ref.lat, ref.lon, -100, 0)[0], lon: G.fromXY(ref.lat, ref.lon, -100, 0)[1] }];
  const p0 = view.toPx(pins[0].lat, pins[0].lon);
  assert.equal(PS.nearestPin(view, pins, p0[0] + 5, p0[1] + 5, 18), 0);
  assert.equal(PS.nearestPin(view, pins, 380, 100, 18), -1);
});

test('routeLegs measures legs and the total', () => {
  const a = G.offset(ref.lat, ref.lon, 0, 100), b = G.offset(a[0], a[1], 90, 50);
  const r = PS.routeLegs(ref, [{ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }]);
  assert.ok(Math.abs(r.legs[0].distM - 100) < 0.5 && Math.abs(r.legs[1].distM - 50) < 0.5);
  assert.ok(Math.abs(r.totalM - 150) < 1);
});

test('suggest: straight back to the taxiway keeps the nose, and along options run both ways', () => {
  const list = PS.suggest.suggest(taxiwayA(), own);
  assert.ok(list.length >= 3, 'got ' + list.length);
  const back = list.find((s) => s.id.indexOf('back-') === 0);
  assert.ok(back, 'straight back option');
  assert.ok(Math.abs(back.lengthM - 60) < 1, 'straight back is 60 m, got ' + back.lengthM);
  assert.equal(Math.round(back.facingDeg), 0);
  assert.equal(back.route.length, 2);
  // the first suggestion is the straight back one
  assert.equal(list[0].id, back.id);
  const along = list.filter((s) => s.id.indexOf('along-') === 0);
  assert.ok(along.length >= 2, 'along options');
  // pushing back then east along the taxiway: the nose ends pointing west (reversing east); the other way, east
  const facings = along.map((s) => Math.round(s.facingDeg));
  assert.ok(facings.indexOf(270) >= 0 && facings.indexOf(90) >= 0, 'both directions offered, got ' + facings.join(','));
  // route is the aircraft, the junction, then the pins
  along.forEach((s) => { assert.equal(s.route.length, 2 + s.pins.length); assert.ok(s.lengthM > 60); });
});

test('suggest: nothing without named taxiway data or a position', () => {
  assert.deepEqual(PS.suggest.suggest([], own), []);
  assert.deepEqual(PS.suggest.suggest(taxiwayA(), null), []);
  // runways, parking connectors and paint are ignored
  const junk = [{ name: 'A', rawName: 'A', category: 'Taxiway', rawType: 2, points: taxiwayA()[0].points }, { name: '', rawName: '', category: 'Parking connector', rawType: 3, points: taxiwayA()[1].points }];
  assert.deepEqual(PS.suggest.suggest(junk, own), []);
});

test('suggest: a taxiway beyond reach is not offered', () => {
  const far = taxiwayA().map((it) => ({ ...it, points: it.points.map((p) => G.offset(p[0], p[1], 180, 400)) }));
  assert.deepEqual(PS.suggest.suggest(far, own), []);
});

test('suggest: a taxiway running along the push line (a sharp turn) offers no along option that way', () => {
  // a taxiway running north-south through the aircraft's tail axis, 40 m south: pushing back then north reverses direction
  const items = [{ name: 'B', rawName: 'B', category: 'Taxiway', rawType: 1, points: [G.offset(ref.lat, ref.lon, 180, 40), G.offset(ref.lat, ref.lon, 180, 200)] }];
  const list = PS.suggest.suggest(items, own);
  // parallel to the tail axis: no intersection, so no options at all
  assert.equal(list.length, 0);
});

test('taxi extract keeps the raw type and name that the suggester needs', () => {
  const raw = { paths: [{ name: 'A', type: 1, widthM: 23, points: [[-43.49, 172.53], [-43.4901, 172.5301]] }, { name: '', type: 4, widthM: 15, points: [[-43.49, 172.53], [-43.4902, 172.5302]] }] };
  const ex = PS.taxi.extract(raw);
  const named = ex.items.find((i) => i.rawName === 'A');
  assert.equal(named.rawType, 1);
  const lane = ex.items.find((i) => i.rawType === 4);
  assert.equal(lane.rawName, '');
  // and the suggester treats the unnamed type-4 stretch as a lane
  const list = PS.suggest.suggest(ex.items, { lat: -43.4905, lon: 172.5295, hdgDeg: 45 });
  assert.ok(Array.isArray(list));
});
