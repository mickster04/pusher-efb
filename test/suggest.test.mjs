import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { scenarios } from './tools/suggest-scenarios.mjs';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PushPlanner/PushPlanner.js');
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

test('suggest: straight back keeps the nose, and the planner turns the along options', () => {
  const list = PS.suggest.suggest(taxiwayA(), own);
  assert.ok(list.length >= 3, 'got ' + list.length);
  const back = list.find((s) => s.title === 'Straight back to taxiway A');
  assert.ok(back, 'straight back option');
  assert.equal(list[0].id, back.id, 'straight back is offered first');
  assert.ok(Math.abs(back.lengthM - 60) < 1, 'straight back is 60 m, got ' + back.lengthM);
  assert.equal(Math.round(back.facingDeg), 0);
  assert.equal(back.warning, null);
  // back then along: the planned line leaves the aircraft, and ends facing along the taxiway either way
  const east = list.find((s) => s.title === 'Taxiway A, facing east'), west = list.find((s) => s.title === 'Taxiway A, facing west');
  assert.ok(east && west, 'both directions along the taxiway are offered');
  [east, west].forEach((s) => { assert.equal(s.warning, null); assert.ok(s.waypoints.length >= 1 && s.route.length > 2); });
  assert.ok(Math.abs(east.facingDeg - 90) < 8 && Math.abs(west.facingDeg - 270) < 8, 'nose ends along the taxiway: ' + east.facingDeg + ' / ' + west.facingDeg);
});

test('suggest: nothing without taxi data, a position, or inside reach', () => {
  assert.deepEqual(PS.suggest.suggest([], own), []);
  assert.deepEqual(PS.suggest.suggest(taxiwayA(), null), []);
  const junk = [{ name: 'A', rawName: 'A', category: 'Taxiway', rawType: 2, points: taxiwayA()[0].points }];   // a runway-type path
  assert.deepEqual(PS.suggest.suggest(junk, own), []);
  const far = taxiwayA().map((it) => ({ ...it, points: it.points.map((p) => G.offset(p[0], p[1], 180, 400)) }));
  assert.deepEqual(PS.suggest.suggest(far, own), []);
});

test('suggest: matches the original app (taxiSuggest.ts) on the recorded scenarios', () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/suggest-golden.json', import.meta.url), 'utf8'));
  // Scenarios where the original and the port pick different but equally good end points (a tie that float noise decides); only the count is compared.
  const knownTies = ['connector@180'];
  const sc = scenarios(G);
  let checked = 0; const extras = [];
  for (const [name, mk] of Object.entries(sc.layouts)) {
    for (const hdg of sc.headings) {
      const key = name + '@' + hdg;
      const gotList = PS.suggest.suggestPushbacks(mk(), { lat: sc.ref[0], lon: sc.ref[1], hdgDeg: hdg });
      const got = gotList.map((s) => s.title).sort();
      const want = golden[key].map((s) => s.title).sort();
      if (knownTies.indexOf(key) >= 0) { assert.equal(got.length, want.length, key + ' count'); continue; }
      // The planner now keeps a turnaround pin clear of the turn (it was not in the original), so a few options the original could not plan
      // can appear. Everything the original offered must still be offered; anything extra is reported here and must be a plain option.
      const missing = want.filter((t) => got.indexOf(t) < 0 && t.indexOf(', pointing ') < 0 && !/^LINK /.test(t));   // compass-pointing options are never shown; link options are only used when no taxiway has one, and the arrival geometry now differs
      const extra = got.filter((t) => want.indexOf(t) < 0);
      assert.deepEqual(missing, [], key + ' lost options');
      extras.push(...extra.map((t) => key + ': ' + t));
      // The same options, so the pin counts agree within one (an end point tie can differ by a turnaround or bend pin).
      golden[key].forEach((w) => {
        const g = gotList.find((x) => x.title === w.title); if (!g) return;
        assert.ok(Math.abs(g.waypoints.length - w.pins) <= 1, key + ' ' + w.title + ': ' + g.waypoints.length + ' vs ' + w.pins + ' pins');
      });
      checked++;
    }
  }
  assert.ok(checked >= 28, 'checked ' + checked);
  assert.ok(extras.length <= 40, 'extra options: ' + extras.join(' | '));
});

test('planner: a straight push has no warning, a hairpin gets a turnaround pin or a warning', () => {
  const P = PS.planner;
  const origin = { lat: ref.lat, lon: ref.lon, hdgDeg: 0 };
  const back = G.offset(ref.lat, ref.lon, 180, 80);
  const straight = P.plannedRouteSegments(origin, [{ lat: back[0], lon: back[1], headingDeg: 0, headingUser: false, drive: 'auto' }]);
  assert.equal(straight.length, 1);
  assert.equal(straight[0].sign, -1, 'pushing back');
  assert.ok(Math.abs(P.pathLengthM(straight[0].points) - 80) < 1);
  assert.equal(P.segmentWarning(straight[0]), null);
  // a pin just beside the aircraft needs a turn tighter than the tug's radius
  const beside = G.offset(ref.lat, ref.lon, 90, 12);
  const tight = P.plannedRouteSegments(origin, [{ lat: beside[0], lon: beside[1], headingDeg: 180, headingUser: true, drive: 'auto' }]);
  assert.ok(tight.some((g) => P.segmentWarning(g) !== null) || tight.length > 1, 'a hairpin warns or is split into legs');
});

test('planner: fillet arcs respect the turn radius', () => {
  const P = PS.planner;
  const a = [ref.lat, ref.lon], b = G.offset(a[0], a[1], 0, 100), c = G.offset(b[0], b[1], 90, 100);
  const stats = { minRadiusM: P.PATH_TURN_RADIUS_M };
  const out = P.filletPath([a, b, c], P.PATH_TURN_RADIUS_M, stats);
  assert.ok(out.length > 3, 'the corner is rounded');
  assert.ok(Math.abs(stats.minRadiusM - P.PATH_TURN_RADIUS_M) < 0.5, 'radius ' + stats.minRadiusM);
  assert.ok(P.pathLengthM(out) < 200, 'rounded path is shorter than the two legs');
});

test('taxi extract keeps the raw type and name that the suggester needs', () => {
  const raw = { paths: [{ name: 'A', type: 1, widthM: 23, points: [[-43.49, 172.53], [-43.4901, 172.5301]] }, { name: '', type: 4, widthM: 15, points: [[-43.49, 172.53], [-43.4902, 172.5302]] }] };
  const ex = PS.taxi.extract(raw);
  assert.equal(ex.items.find((i) => i.rawName === 'A').rawType, 1);
  const lane = ex.items.find((i) => i.rawType === 4);
  assert.equal(lane.rawName, '');
  assert.ok(Array.isArray(PS.suggest.suggest(ex.items, { lat: -43.4905, lon: 172.5295, hdgDeg: 45 })));
});

test('suggest: a few compass-pointing options only where they add a different facing, lanes only when no taxiway option, and each option reports its arc', () => {
  const sc = scenarios(G);
  let sawAny = false;
  for (const [name, mk] of Object.entries(sc.layouts)) {
    for (const hdg of sc.headings) {
      const layout = mk();
      // feed the layout back through the extracted-item shape the app uses
      const items = layout.paths.map((p) => ({ rawName: p.name, rawType: p.type, category: p.type === 3 ? 'Parking connector' : 'Taxiway', points: p.points, widthM: p.widthM }));
      const list = PS.suggest.suggest(items, { lat: sc.ref[0], lon: sc.ref[1], hdgDeg: hdg }, layout.parking);
      list.forEach((s) => {
        sawAny = true;
        assert.equal(typeof s.tightestRadiusM, 'number');
        assert.ok(s.detail.indexOf('Tightest arc') >= 0);
      });
      const pointing = list.filter((s) => s.title.indexOf(', pointing ') >= 0), others = list.filter((s) => s.title.indexOf(', pointing ') < 0);
      assert.ok(pointing.length <= 2, name + '@' + hdg + ': at most two pointing options, got ' + pointing.length);
      pointing.forEach((p) => others.forEach((o) => assert.ok(Math.abs(G.angleDiff(p.facingDeg, o.facingDeg)) >= 50, name + '@' + hdg + ': "' + p.title + '" faces too like "' + o.title + '"')));
      if (list.some((s) => s.group === 'taxiway')) assert.ok(list.every((s) => s.group === 'taxiway'), name + '@' + hdg + ': lanes/links only when there is no taxiway option');
    }
  }
  assert.ok(sawAny);
});

test('suggest: the arc filter keeps options with a decent arc and falls back rather than offering nothing', () => {
  // straight back to a taxiway 60 m behind: a clean straight push, so it passes the filter
  const list = PS.suggest.suggest(taxiwayA(), own);
  const back = list.find((s) => s.title === 'Straight back to taxiway A');
  assert.ok(back && back.tightestRadiusM >= 32 && back.maxStartOffDeg <= 45);
  list.forEach((s) => assert.ok(s.tightestRadiusM >= 32 && s.maxStartOffDeg <= 45, s.title + ' arc ' + s.tightestRadiusM + ' start off ' + s.maxStartOffDeg));
});

test('suggest: no two suggestions end in the same spot', () => {
  // the synthetic taxiway used when debugging: the options must end at least 12 m apart
  const ac = { lat: -43.48983, lon: 172.53785, hdgDeg: 43 }, c = [-43.490416, 172.537618];
  const a = G.offset(c[0], c[1], 310, 300), b = G.offset(c[0], c[1], 130, 300);
  const out = PS.suggest.suggest([{ name: 'F', rawName: 'F', category: 'Taxiway', rawType: 1, points: [a, c, b] }], ac, []);
  assert.ok(out.length >= 2, 'several options: ' + out.length);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const ei = out[i].waypoints[out[i].waypoints.length - 1], ej = out[j].waypoints[out[j].waypoints.length - 1];
    assert.ok(G.distanceM(ei.lat, ei.lon, ej.lat, ej.lon) >= 12, out[i].title + ' and ' + out[j].title + ' end ' + G.distanceM(ei.lat, ei.lon, ej.lat, ej.lon).toFixed(1) + ' m apart');
  }
});

test('suggest: every option ends facing the way its title says', () => {
  const dirs = { north: 0, 'north-east': 45, east: 90, 'south-east': 135, south: 180, 'south-west': 225, west: 270, 'north-west': 315 };
  const c = [-43.490416, 172.537618];
  const a = G.offset(c[0], c[1], 310, 300), b = G.offset(c[0], c[1], 130, 300);
  [30, 43, 130, 220, 300].forEach((hdg) => {
    const ac = { lat: -43.48983, lon: 172.53785, hdgDeg: hdg };
    const out = PS.suggest.suggest([{ name: 'F', rawName: 'F', category: 'Taxiway', rawType: 1, points: [a, c, b] }], ac, []);
    out.forEach((s) => {
      const m = /facing ([a-z-]+)/.exec(s.title);
      if (!m || dirs[m[1]] === undefined) return;
      assert.ok(Math.abs(G.angleDiff(s.facingDeg, dirs[m[1]])) <= 45, 'heading ' + hdg + ': "' + s.title + '" ends facing ' + Math.round(s.facingDeg));
    });
  });
});

test('suggest: end points are kept out of junctions where the push can go a little further', () => {
  const ref = { lat: -43.49, lon: 172.53 };
  const xy = (x, y) => G.fromXY(ref.lat, ref.lon, x, y);
  const items = [
    { name: 'A', rawName: 'A', category: 'Taxiway', rawType: 1, points: [xy(-200, -60), xy(250, -60)] },
    { name: 'B', rawName: 'B', category: 'Taxiway', rawType: 1, points: [xy(20, -60), xy(20, -200)] }
  ];
  [20, 340].forEach((hdg) => {
    const out = PS.suggest.suggest(items, { lat: ref.lat, lon: ref.lon, hdgDeg: hdg }, []);
    // (taxiway A has room to go further either way; B's only workable end for this heading is the one at the junction, so it is left out of the check)
    out.filter((s) => /^Taxiway A, /.test(s.title)).forEach((s) => {
      const e = s.waypoints[s.waypoints.length - 1], q = G.toXY(ref.lat, ref.lon, e.lat, e.lon);
      const toJunction = Math.hypot(q.x - 20, q.y - -60);
      assert.ok(toJunction >= 35, 'heading ' + hdg + ': "' + s.title + '" ends ' + toJunction.toFixed(0) + ' m from the junction at (20, -60)');
    });
  });
});
