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
// aircraft's nose turns at gain x commanded - deadband, which is the response the original app measured (fitted to the real sim: gain about 2.3, deadband 0.30 deg/s).
function simulate(planned, opts) {
  opts = opts || {};
  const gain = opts.gain === undefined ? 2.3 : opts.gain, dead = opts.dead === undefined ? 0.30 : opts.dead, dt = 0.05;
  const legs = PS.follow.legsFromPlan(planned);
  const f = PS.follow.create(legs, { cruiseUnits: opts.cruise || 25 });
  let x = opts.startX || 0, y = 0, psi = own.hdgDeg + (opts.startPsi || 0), v = 0, yawRamped = 0, t = 0, maxCte = 0, c = null, stops = [], phases = {}, maxYawSeen = 0;
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
  const r = simulate(planned, { gain: 1.6, dead: 0.4, cruise: 35 });
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

// ---- speed profile ----
const F = PS.follow;
function pathOf(pts) { return F.buildPath(pts, { lat: pts[0][0], lon: pts[0][1] }); }
function straightPts(len) { const a = [own.lat, own.lon]; return [a, at(0, len)]; }
function arcPts(radius, turnDeg, lead) {   // lead m straight, a left arc, lead m straight
  const pts = [[own.lat, own.lon]]; let p = from(pts[0]), brg = 0;
  const push = (d) => { const q = at(brg, d, p); pts.push(q); p = from(q); };
  for (let d = 5; d <= lead; d += 5) push(5);
  const stepDeg = 5, chord = 2 * radius * Math.sin(G.rad(stepDeg / 2));
  for (let a = 0; a < turnDeg; a += stepDeg) { brg += stepDeg / 2; push(chord); brg += stepDeg / 2; }
  for (let d = 5; d <= lead; d += 5) push(5);
  return pts;
}
const mps = (fts) => fts * 0.3048;

test('profile: a long straight reaches the top speed and the stop is braked for in time', () => {
  const top = 5;                                    // ft/s
  const prof = F.buildProfile(pathOf(straightPts(200)), false, top);
  assert.ok(Math.abs(F.profileAt(prof, 100).v - top) < 0.05, 'top speed mid-straight');
  assert.match(F.profileAt(prof, 100).why, /straight/);
  assert.match(F.profileAt(prof, 198).why, /stop/);
  for (let i = 1; i < prof.n; i++) {          // never decelerates faster than the limit, never accelerates faster either
    const dv2 = mps(prof.v[i]) ** 2 - mps(prof.v[i - 1]) ** 2;
    assert.ok(dv2 <= 2 * F.K.ACCEL_MS2 * prof.ds + 1e-6 && dv2 >= -2 * F.K.DECEL_MS2 * prof.ds - 1e-6, 'step ' + i);
  }
  assert.ok(prof.v[prof.n - 2] <= F.K.MIN_AUTO_UNITS * F.K.UNITS_TO_FTS + 0.5, 'a crawl at the end');
});

test('profile: slows before a tight curve, is slower in it than on the straight, and tighter curves are slower', () => {
  const top = 5;
  const p40 = F.buildProfile(pathOf(arcPts(40, 90, 80)), false, top);
  const p20 = F.buildProfile(pathOf(arcPts(20, 90, 80)), false, top);
  const min = (p) => Math.min(...p.v.slice(10, p.n - 20));
  assert.ok(min(p40) < top - 1, 'curve slower than the straight');
  assert.ok(min(p20) < min(p40) + 1e-9, 'tighter is not faster');
  const iCurve = p40.radius.findIndex((r) => r < 100);
  assert.ok(iCurve > 0);
  const before = p40.v[Math.max(0, iCurve - 60)], at = p40.v[iCurve];   // 30 m before the curve starts to show
  assert.ok(before > at - 1e-9, 'already slowing on the approach');
  const slow = p40.v.findIndex((v, i) => i > 20 && v < top - 0.2);
  assert.ok(slow < iCurve, 'slowing starts before the curve');
});

test('profile: a reverse push is slower than forward, and a new top speed changes a running follower', () => {
  const fwd = F.buildProfile(pathOf(straightPts(200)), false, 5), rev = F.buildProfile(pathOf(straightPts(200)), true, 5);
  assert.ok(F.profileAt(rev, 100).v < F.profileAt(fwd, 100).v);
  const f = F.create([{ sign: -1, points: straightPts(200) }], { cruiseUnits: 25 });
  const before = F.profileAt(f.legs[0].prof, 100).v;
  f.setCruise(10);
  assert.ok(F.profileAt(f.legs[0].prof, 100).v < before);
});

test('profile: the speed along a chord-built arc is steady, not a sawtooth', () => {
  const prof = F.buildProfile(pathOf(arcPts(40, 120, 30)), false, 7);
  const a = Math.round(prof.n * 0.4), b = Math.round(prof.n * 0.7);
  let lo = Infinity, hi = 0;
  for (let i = a; i < b; i++) { lo = Math.min(lo, prof.v[i]); hi = Math.max(hi, prof.v[i]); }
  assert.ok(hi - lo < 0.6, 'speed in the arc varies by ' + (hi - lo).toFixed(2) + ' ft/s');
});

test('follower: arrives facing the planned heading even when it starts off the line and off the heading (heading matters more than position)', () => {
  const r = simulate(planFor([at(180, 40), at(90, 60, from(at(180, 40)))]), { startX: 1.5, startPsi: 7 });
  assert.ok(r.done, 'finished: ' + JSON.stringify(r.stops));
  assert.ok(r.headErr < 5, 'nose ends ' + r.headErr.toFixed(1) + ' deg off');
  const s = simulate(planFor([at(180, 100)]), { startX: 2, startPsi: -8 });
  assert.ok(s.done && s.headErr < 4, 'straight, started off: nose ends ' + s.headErr.toFixed(1) + ' deg off (done ' + s.done + ')');
});

test('follower: near the end it steers by the nose, not the position, so a metre off the line does not swing the tug', () => {
  const planned = planFor([at(180, 100)]);
  const f = PS.follow.create(PS.follow.legsFromPlan(planned), { cruiseUnits: 25 });
  const run = (hdgOff, side, atM) => {
    const base = G.fromXY(own.lat, own.lon, side, -atM);                    // atM metres back along the line, side metres east of it
    let c = null;
    for (let i = 0; i < 40; i++) c = f.update({ lat: base[0], lon: base[1], hdgDeg: G.normDeg(own.hdgDeg + hdgOff), t: i * 0.05 }, 0.05, -3);
    return c;
  };
  const c = run(8, 1.0, 95);                                                 // 5 m from the end, 1 m off, nose 8 degrees off the line
  assert.ok(c.yawDegS < 0 && c.yawDegS > -1.0, 'a gentle turn back toward the end heading (nose is clockwise of it): ' + c.yawDegS.toFixed(2) + ' deg/s command');
  assert.ok(Math.abs(c.speedFtS) < 4, 'and slowing: ' + c.speedFtS.toFixed(2) + ' ft/s');
});
