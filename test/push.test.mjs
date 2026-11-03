import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---- a fake sim, installed before the app loads ----
const sim = { x: 0, y: 0, hdg: 0, velZ: 0, rotY: 0, wait: 1, attached: 0, attachAt: 0, brake: 1, ground: 1, agl: 0, lastWrite: 0, writes: [], t0: 0, ref: { lat: -43.49, lon: 172.53 } };
let G, PS;
function now() { return Date.now(); }
globalThis.SimVar = {
  GetSimVarValue(name, unit) {
    const ll = G ? G.fromXY(sim.ref.lat, sim.ref.lon, sim.x, sim.y) : [sim.ref.lat, sim.ref.lon];
    switch (name) {
      case 'PLANE LATITUDE': return ll[0];
      case 'PLANE LONGITUDE': return ll[1];
      case 'PLANE HEADING DEGREES TRUE': return sim.hdg;
      case 'SIM ON GROUND': return sim.ground;
      case 'PLANE ALT ABOVE GROUND': return sim.agl;
      case 'PUSHBACK ATTACHED': return sim.attached;
      case 'BRAKE PARKING POSITION': return sim.brake ? 1 : 0;
      case 'GROUND VELOCITY': return Math.abs(sim.velZ) * 0.5925;
      case 'VELOCITY BODY Z': return sim.velZ;
      default: return 0;
    }
  },
  SetSimVarValue(name, unit, value) {
    sim.writes.push([name, value]);
    switch (name) {
      case 'VELOCITY BODY Z': sim.velZ = value; sim.lastWrite = now(); break;
      case 'ROTATION VELOCITY BODY Y': sim.rotY = value; sim.lastWrite = now(); break;
      case 'PUSHBACK WAIT': sim.wait = value ? 1 : 0; break;
      case 'K:TOGGLE_PUSHBACK': sim.attachAt = now() + 250; break;           // the tug comes (or goes) a moment after the event
      case 'K:PARKING_BRAKES': sim.brake = sim.brake ? 0 : 1; break;
      case 'BRAKE PARKING POSITION': if (unit === 'percent over 100') { /* some aircraft ignore a write to it */ } break;
      default: break;
    }
    return Promise.resolve();
  }
};
PS = require('../PackageSources/PushPlanner/PushPlanner.js');
G = PS.geo;
const own = () => ({ lat: G.fromXY(sim.ref.lat, sim.ref.lon, sim.x, sim.y)[0], lon: G.fromXY(sim.ref.lat, sim.ref.lon, sim.x, sim.y)[1], hdgDeg: sim.hdg });

function physics(ms) {
  const dt = ms / 1000;
  if (sim.attachAt && now() >= sim.attachAt) { sim.attached = sim.attached ? 0 : 1; sim.attachAt = 0; }
  const fresh = now() - sim.lastWrite < 150;                  // velocity is not sticky: stop writing it and the aircraft stops
  if (sim.attached && !sim.wait && fresh) {
    const yawDegS = sim.rotY * 180 / Math.PI;
    const mag = Math.max(0, 0.77 * Math.abs(yawDegS) - 0.30);
    sim.hdg = G.normDeg(sim.hdg + Math.sign(yawDegS) * mag * dt);
    const d = sim.velZ * 0.3048 * dt;
    sim.x += d * Math.sin(G.rad(sim.hdg)); sim.y += d * Math.cos(G.rad(sim.hdg));
  }
}
function run(seconds, each) {
  for (let i = 0; i < seconds * 20; i++) { mock.timers.tick(50); physics(50); if (each && each(i) === false) return; }
}
function reset() {
  PS.push.emergencyStop('test reset'); PS.plan.clear();
  Object.assign(sim, { x: 0, y: 0, hdg: 0, velZ: 0, rotY: 0, wait: 1, attached: 0, attachAt: 0, brake: 1, ground: 1, agl: 0, lastWrite: 0, writes: [] });
  PS.toasts.clear();
}
function withClock(start, fn) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: start });
  try { fn(); } finally { mock.timers.reset(); }
}
const planBack = (m) => { const p = G.offset(sim.ref.lat, sim.ref.lon, 180, m); PS.plan.add(p[0], p[1]); };

test('push: attach, wait for the brake, then drive the plan to its end', () => {
  withClock(1000000, () => {
  reset(); planBack(60);
  assert.equal(PS.push.view().status, 'idle');
  assert.ok(PS.push.requestStart(), 'start accepted');
  assert.equal(PS.push.view().status, 'attaching');
  run(1);                                        // the tug arrives
  assert.equal(sim.attached, 1, 'the tug attached');
  assert.equal(PS.push.view().status, 'waitBrake', 'waiting for the brake: ' + PS.push.view().status);
  assert.ok(PS.toasts.items.some((t) => t.id === 'push-brake'), 'the brake prompt is up');
  run(2);
  assert.equal(sim.velZ, 0, 'nothing driven while the brake is on');
  assert.equal(sim.x === 0 && sim.y === 0, true, 'the aircraft has not moved');
  // the pilot releases the brake (the app offers to do it): it writes the variables, then toggles the key event if that does not stick
  PS.push.releaseBrake();
  run(2);
  assert.equal(sim.brake, 0, 'the brake was released by the app');
  let driving = false;
  run(10, () => { if (PS.push.view().status === 'driving') { driving = true; return false; } });
  assert.ok(driving, 'driving started once the brake was off and the tug had settled: ' + PS.push.view().status);
  assert.ok(!PS.toasts.items.some((t) => t.id === 'push-brake'), 'the brake prompt went away');
  assert.ok(PS.toasts.items.some((t) => t.id === 'push' && /left/.test(t.message)), 'the progress toast shows distance left');
  run(120, () => { const s = PS.push.view().status; if (s === 'done') return false; });
  const v = PS.push.view();
  assert.equal(v.status, 'done', 'finished: ' + v.status + ' ' + v.reason);
  const endErr = Math.hypot(sim.x - 0, sim.y - (-60));
  assert.ok(endErr < 1.6, 'ended ' + endErr.toFixed(2) + ' m from the end pin');
  assert.ok(Math.abs(sim.velZ) < 0.01, 'stopped');
  assert.ok(PS.toasts.items.some((t) => t.id === 'push-done'), 'the finished prompt is up');
  });
});

test('push: the sim detaching the tug stops everything at once', () => {
  withClock(2000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(8, () => { if (PS.push.view().status === 'driving') return false; });
  run(10);
  assert.ok(sim.velZ < -0.5, 'moving back: ' + sim.velZ);
  sim.attached = 0;                                // the user (or the sim) takes the tug away
  run(1);
  const v = PS.push.view();
  assert.ok(v.status === 'idle' || v.status === 'ready', 'stopped: ' + v.status);
  assert.match(v.reason, /detached/, 'says why: ' + v.reason);
  // With no tug on, velocity writes would shove a free aircraft, so the app must stop writing altogether (velocity is not sticky).
  const writesAtStop = sim.writes.length, y1 = sim.y;
  run(3);
  assert.equal(sim.writes.length, writesAtStop, 'no further writes after the tug went');
  assert.equal(sim.y, y1, 'the aircraft stopped moving');
  });
});

test('push: setting the parking brake mid-push holds the tug, and releasing it carries on', () => {
  withClock(3000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(8, () => { if (PS.push.view().status === 'driving') return false; });
  run(15);
  const y0 = sim.y;
  sim.brake = 1;
  run(4);
  assert.equal(PS.push.view().status, 'brakeHold', 'held: ' + PS.push.view().status);
  assert.ok(Math.abs(sim.velZ) < 0.01, 'stopped');
  assert.ok(PS.toasts.items.some((t) => t.id === 'push' && /brake/i.test(t.message)), 'the toast says why');
  const y1 = sim.y; run(2); assert.equal(sim.y, y1, 'does not creep while held');
  sim.brake = 0;
  run(3);
  assert.equal(PS.push.view().status, 'driving', 'carried on: ' + PS.push.view().status);
  run(120, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done');
  assert.ok(sim.y < y0, 'went on past where it stopped');
  });
});

test('push: pause holds the aircraft still and resume carries on; stop ends it', () => {
  withClock(4000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(8, () => { if (PS.push.view().status === 'driving') return false; });
  run(10);
  PS.push.pause();
  run(4);
  assert.equal(PS.push.view().status, 'paused');
  const y1 = sim.y; run(3); assert.equal(sim.y, y1, 'held still while paused');
  assert.ok(PS.toasts.items.some((t) => t.id === 'push' && /paused/.test(t.title)), 'toast says paused');
  PS.push.resume();
  run(3);
  assert.equal(PS.push.view().status, 'driving');
  run(10);
  assert.ok(sim.y < y1, 'moving again');
  PS.push.stop('test stop');
  run(4);
  assert.equal(PS.push.view().status, 'ready', 'stopped, tug still on: ' + PS.push.view().status);
  assert.ok(Math.abs(sim.velZ) < 0.01);
  });
});

test('push: refuses to start with no plan, or when the aircraft is not on the ground', () => {
  withClock(5000000, () => {
  reset();
  assert.equal(PS.push.requestStart(), false);
  assert.match(PS.push.canStart().why, /no plan/i);
  planBack(60); sim.ground = 0;
  assert.equal(PS.push.canStart().ok, false);
  assert.match(PS.push.canStart().why, /not on the ground/);
  sim.ground = 1; sim.agl = 200;
  assert.equal(PS.push.canStart().ok, false);
  });
});

test('push: closing or pausing the app stops the push at once', () => {
  withClock(6000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(8, () => { if (PS.push.view().status === 'driving') return false; });
  run(10);
  PS.runCloseHooks('paused');
  assert.equal(sim.velZ, 0, 'velocity zeroed');
  assert.notEqual(PS.push.view().status, 'driving');
  });
});
