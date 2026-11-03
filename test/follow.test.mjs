import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PushPlanner/PushPlanner.js');
const G = PS.geo, plan = PS.plan;

const own = { lat: -43.49, lon: 172.53, hdgDeg: 0 };
const at = (brg, d, from) => G.offset((from || own).lat, (from || own).lon, brg, d);
const from = (pt) => ({ lat: pt[0], lon: pt[1] });   // a [lat, lon] point as a start for at()
function approach(cur, target, step) { return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step); }

// A simulated tug: the drive layer ramps speed (14 ft/s per s) and turn rate (5 deg/s per s) towards what the follower asks, and the
// aircraft's nose turns at gain x commanded - deadband, which is the response the original app measured (gain 0.77, deadband 0.30 deg/s).
function simulate(planned, opts) {
  opts = opts || {};
  const gain = opts.gain === undefined ? 0.77 : opts.gain, dead = opts.dead === undefined ? 0.30 : opts.dead, dt = 0.05;
  const legs = PS.follow.legsFromPlan(planned);
  const f = PS.follow.create(legs, { cruiseUnits: opts.cruise || 25 });
  let x = 0, y = 0, psi = own.hdgDeg, v = 0, yawRamped = 0, t = 0, maxCte = 0, c = null, stops = [], phases = {}, maxYawSeen = 0;
  const endWp = planned.waypoints[planned.waypoints.length - 1];
  while (t < (opts.maxT || 300)) {
    const ll = G.fromXY(own.lat, own.lon, x, y);
    c = f.update({ lat: ll[0], lon: ll[1], hdgDeg: psi, t }, dt, v);
    phases[c.phase] = (phases[c.phase] || 0) + 1;
    if (c.stop) { stops.push(c.stop); break; }
    if (c.done) break;
    if (Math.abs(c.cte) > maxCte && c.phase === 'run') maxCte = Math.abs(c.cte);
    v = approach(v, c.speedFtS, 14 * dt);
    yawRamped = approach(yawRamped, c.yawDegS, 5 * dt);
    const mag = Math.max(0, gain * Math.abs(yawRamped) - dead);
    const yawAct = Math.sign(yawRamped) * mag;
    if (Math.abs(yawAct) > maxYawSeen) maxYawSeen = Math.abs(yawAct);
    psi = G.normDeg(psi + yawAct * dt);
    const d = v * 0.3048 * dt;
    x += d * Math.sin(G.rad(psi)); y += d * Math.cos(G.rad(psi));
    t += dt;
  }
  const endXY = G.toXY(own.lat, own.lon, endWp.lat, endWp.lon);
  const endLeg = planned.legs[planned.legs.length - 1];
  return { t, done: !!(c && c.done), stops, maxCte, phases, endErrM: Math.hypot(x - endXY.x, y - endXY.y), headErr: Math.abs(G.angleDiff(psi, endLeg.endHdgDeg)), maxYawSeen, v };
}
function planFor(pinsList, setup) {
  plan.clear();
  pinsList.forEach((p) => plan.add(p[0], p[1]));
  if (setup) setup();
  return plan.evaluate(own);
}

test('follower: a straight push back reaches the end, slowly and straight', () => {
  const r = simulate(planFor([at(180, 80)]));
  assert.ok(r.done, 'finished: ' + JSON.stringify(r.stops));
  assert.ok(r.endErrM < 1.5, 'end error ' + r.endErrM.toFixed(2) + ' m');
  assert.ok(r.maxCte < 0.6, 'stays on the line: ' + r.maxCte.toFixed(2) + ' m');
  assert.ok(r.headErr < 3, 'nose ends as planned: ' + r.headErr.toFixed(1) + ' deg off');
  assert.ok(r.t < 100, 'takes ' + r.t.toFixed(0) + ' s (the original pushes at about 1.1 m/s in reverse at its default speed)');
});

test('follower: a push back with a 90 degree turn follows the arc', () => {
  const a = at(180, 60), b = at(90, 50, from(a));
  const r = simulate(planFor([a, b]));
  assert.ok(r.done, 'finished: ' + JSON.stringify(r.stops));
  assert.ok(r.endErrM < 2.0, 'end error ' + r.endErrM.toFixed(2) + ' m');
  assert.ok(r.maxCte < 3.0, 'off the planned line by at most ' + r.maxCte.toFixed(2) + ' m');
  assert.ok(r.headErr < 8, 'nose ends ' + r.headErr.toFixed(1) + ' deg off');
});

test('follower: a route that reverses direction stops at the cusp, holds, then drives the second leg', () => {
  // push back 60 m, then pull forward 50 m up and to the side: two legs in opposite directions
  const a = at(180, 60), b = at(45, 50, from(a));
  const planned = planFor([a, b]);
  assert.ok(planned.legs.length >= 2, 'planned legs: ' + planned.legs.length);
  const r = simulate(planned);
  assert.ok(r.done, 'finished: ' + JSON.stringify(r.stops));
  assert.ok(r.phases.cuspStop > 0 && r.phases.cuspHold > 0, 'stopped and held between the legs: ' + JSON.stringify(r.phases));
  assert.ok(r.endErrM < 3.0, 'end error ' + r.endErrM.toFixed(2) + ' m');
});

test('follower: copes with a sluggish tug (turns at 60% of the command) and a faster cruise speed', () => {
  const a = at(180, 60), b = at(90, 50, from(a));
  const planned = planFor([a, b]);
  const r = simulate(planned, { gain: 0.6, dead: 0.4, cruise: 35 });
  assert.ok(r.done, 'finished: ' + JSON.stringify(r.stops));
  assert.ok(r.endErrM < 3.5, 'end error ' + r.endErrM.toFixed(2) + ' m');
  assert.ok(r.maxCte < 5, 'off the line by at most ' + r.maxCte.toFixed(2) + ' m');
});

test('follower: remaining distance counts down over all the legs, and a lost path or a stuck aircraft is reported', () => {
  const a = at(180, 80);
  const planned = planFor([a]);
  const legs = PS.follow.legsFromPlan(planned);
  const f = PS.follow.create(legs, { cruiseUnits: 25 });
  const c0 = f.update({ lat: own.lat, lon: own.lon, hdgDeg: own.hdgDeg, t: 0 }, 0.05, 0);
  assert.ok(Math.abs(c0.remainingM - planned.totalM) < 0.5, 'remaining at the start ' + c0.remainingM + ' vs ' + planned.totalM);
  assert.ok(c0.speedFtS < 0, 'pushing back is a negative speed');
  const half = at(180, 40);
  const c1 = f.update({ lat: half[0], lon: half[1], hdgDeg: own.hdgDeg, t: 1 }, 0.05, -2);
  assert.ok(Math.abs(c1.remainingM - (planned.totalM - 40)) < 1, 'remaining halfway ' + c1.remainingM);
  // far off the path for longer than the limit
  let stop = '';
  for (let k = 0; k < 100 && !stop; k++) {       // 25 m to the side of the path and moving along it, so it is lost, not stuck
    const lost = at(90, 25, from(at(180, 40 + k * 0.4)));
    stop = f.update({ lat: lost[0], lon: lost[1], hdgDeg: own.hdgDeg, t: 2 + k * 0.1 }, 0.05, -2).stop;
  }
  assert.ok(stop.indexOf('off the planned path') >= 0, 'lost: ' + stop);
  // stuck: commanded to move but the position never changes
  const g = PS.follow.create(legs, { cruiseUnits: 25 });
  let stuck = '';
  for (let k = 0; k < 200 && !stuck; k++) stuck = g.update({ lat: own.lat, lon: own.lon, hdgDeg: own.hdgDeg, t: k * 0.1 }, 0.05, -2).stop;
  assert.ok(stuck.indexOf('not moving') >= 0, 'stuck: ' + stuck);
  plan.clear();
});
