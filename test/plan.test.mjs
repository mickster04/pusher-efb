import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PusherSpikes/PusherSpikes.js');
const G = PS.geo, plan = PS.plan;
const ref = { lat: -43.49, lon: 172.53 };
const own = { lat: ref.lat, lon: ref.lon, hdgDeg: 0 };
const at = (brg, d) => G.offset(ref.lat, ref.lon, brg, d);

test('pins: the last pin is the end pin and labels follow position', () => {
  plan.clear();
  const a = at(180, 40), b = at(180, 90);
  plan.add(a[0], a[1]); plan.add(b[0], b[1]);
  const pins = plan.list();
  assert.equal(pins.length, 2);
  assert.equal(pins[0].terminal, false); assert.equal(pins[1].terminal, true);
  assert.equal(pins[0].label, 'Pin 1'); assert.equal(pins[1].label, 'End position');
  // adding another makes it the end and the old end an ordinary pin
  const c = at(180, 140); plan.add(c[0], c[1]);
  assert.equal(plan.list()[1].label, 'Pin 2'); assert.equal(plan.list()[2].label, 'End position');
  assert.equal(plan.selected(), 2, 'a new pin is selected');
  plan.clear();
});

test('pins: remove keeps the selection on the same pin, and move changes the position', () => {
  plan.clear();
  [40, 80, 120].forEach((d) => { const p = at(180, d); plan.add(p[0], p[1]); });
  plan.select(2);
  plan.remove(0);
  assert.equal(plan.count(), 2);
  assert.equal(plan.selected(), 1, 'selection follows its pin');
  plan.remove(1);
  assert.equal(plan.selected(), -1, 'removing the selected pin clears the selection');
  const p = at(180, 50); plan.move(0, p[0], p[1]);
  assert.ok(Math.abs(G.distanceM(plan.list()[0].lat, plan.list()[0].lon, p[0], p[1])) < 0.01);
  plan.clear();
});

test('heading: set makes it yours, reset returns to auto, and only the end pin keeps an unset heading null', () => {
  plan.clear();
  const a = at(180, 60); plan.add(a[0], a[1]);
  assert.equal(plan.list()[0].headingUser, false); assert.equal(plan.list()[0].headingDeg, null);
  plan.setHeading(0, 271.4);
  assert.equal(plan.list()[0].headingUser, true); assert.equal(plan.list()[0].headingDeg, 271);
  plan.resetHeading(0);
  assert.equal(plan.list()[0].headingUser, false); assert.equal(plan.list()[0].headingDeg, null);
  plan.clear();
});

test('heading handle: dragging behind the pin points the nose through the pin', () => {
  // pin at (100, 100); handle directly below it on screen (behind a north-pointing nose) means heading north
  assert.ok(Math.abs(plan.headingFromHandle(100, 100, 100, 140) - 0) < 0.01);
  assert.ok(Math.abs(plan.headingFromHandle(100, 100, 60, 100) - 90) < 0.01, 'handle to the left: nose points east');
  assert.ok(Math.abs(plan.headingFromHandle(100, 100, 100, 60) - 180) < 0.01, 'handle above: nose points south');
  assert.ok(Math.abs(plan.headingFromHandle(100, 100, 140, 100) - 270) < 0.01, 'handle to the right: nose points west');
});

test('evaluate: a push straight back plans in one reverse leg with no warning', () => {
  plan.clear();
  const a = at(180, 80); plan.add(a[0], a[1]);
  const r = plan.evaluate(own);
  assert.equal(r.empty, false);
  assert.equal(r.legs.length, 1);
  assert.equal(r.legs[0].sign, -1);
  assert.ok(Math.abs(r.totalM - 80) < 1, 'total ' + r.totalM);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].userIndex, 0);
  assert.ok(Math.abs(r.items[0].headingDeg - 0) < 2, 'nose stays north: ' + r.items[0].headingDeg);
  assert.equal(r.route[0][0], own.lat, 'route starts at the aircraft');
  // unchanged inputs return the same object (cached), a change does not
  assert.equal(plan.evaluate(own), r);
  plan.move(0, at(180, 90)[0], at(180, 90)[1]);
  assert.notEqual(plan.evaluate(own), r);
  plan.clear();
});

test('evaluate: no pins is an empty plan; a hairpin to a rotated end pin warns or gets a turnaround pin', () => {
  plan.clear();
  const e0 = plan.evaluate(own);
  assert.equal(e0.empty, true); assert.equal(e0.legs.length, 0); assert.equal(e0.route.length, 1);
  // an end pin 25 m behind, rotated to face the opposite way: the aircraft would have to turn right round
  const a = at(180, 25); plan.add(a[0], a[1]); plan.setHeading(0, 180);
  const r = plan.evaluate(own);
  assert.ok(r.turnaroundAdded || r.warnings.length > 0 || r.legs.length > 1, 'handled as a hairpin: ' + r.info);
  if (r.turnaroundAdded) {
    assert.ok(r.items.some((i) => i.turnaround && i.userIndex === -1), 'planner-added pin is marked and is not one of the user pins');
    assert.equal(plan.count(), 1, 'the user\'s pins are unchanged');
  }
  plan.clear();
});

test('setAll: copies a suggestion and drops planner-added turnaround pins', () => {
  plan.clear();
  const list = PS.suggest.suggest([{ name: 'A', rawName: 'A', category: 'Taxiway', rawType: 1, points: [at(270, 100), at(90, 100)].map((p) => G.offset(p[0], p[1], 180, 60)) }], own);
  assert.ok(list.length > 0);
  const wps = list[0].waypoints.concat([{ id: 'x', label: PS.planner.TURNAROUND_PIN_LABEL, lat: ref.lat, lon: ref.lon, headingDeg: null, headingUser: false, drive: 'auto' }]);
  plan.setAll(wps);
  assert.equal(plan.count(), list[0].waypoints.length, 'turnaround pin dropped');
  assert.equal(plan.list()[plan.count() - 1].terminal, true);
  assert.equal(plan.selected(), -1);
  plan.clear();
});
