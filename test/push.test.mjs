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
    const mag = Math.max(0, 2.3 * Math.abs(yawDegS) - 0.30);
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
  PS.toasts.clear(); PS.toasts.setAppOpen(false);   // push toasts only show while the app is not on screen
}
function withClock(start, fn) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: start });
  PS.push.forgetLoop();
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
  assert.equal(PS.push.view().status, 'driving', 'before: ' + PS.logs.slice(-6).map((e) => e.msg).join(' / '));
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

test('push: going to another EFB app carries on, closing the app stops the push at once', () => {
  withClock(6000000, () => {
  reset(); sim.brake = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(10, () => { if (PS.push.view().status === 'driving') return false; });
  run(3);
  assert.equal(PS.push.view().status, 'driving', 'before: ' + PS.logs.slice(-6).map((e) => e.msg).join(' / '));
  const y0 = sim.y;
  PS.runCloseHooks('app paused');
  run(5);
  assert.equal(PS.push.view().status, 'driving', 'still pushing in the background');
  assert.ok(sim.y < y0, 'still moving');
  PS.runCloseHooks('app closed');
  assert.equal(sim.velZ, 0, 'velocity zeroed');
  assert.notEqual(PS.push.view().status, 'driving');
  });
});

test('toasts: push messages are held back while the app is open, and sent to the EFB when it is not', () => {
  const sent = [];
  PS.state.notificationManager = { showNotification: (n) => sent.push(n) };
  PS.toasts.clear(); PS.toasts.setAppOpen(true);
  PS.toasts.show({ id: 'x-push', efbOnly: true, persistent: true, title: 'Pushing', message: '50 m left' });
  assert.equal(PS.toasts.items.length, 0, 'nothing shown with the app open');
  assert.equal(sent.length, 0);
  PS.toasts.setAppOpen(false);
  PS.toasts.show({ id: 'x-push', efbOnly: true, persistent: true, title: 'Pushing', message: '40 m left' });
  PS.toasts.show({ id: 'x-push', efbOnly: true, persistent: true, title: 'Pushing', message: '30 m left' });
  assert.equal(sent.length, 1, 'one notification per message id');
  assert.equal(PS.toasts.items.length, 1);
  PS.toasts.setAppOpen(true);
  assert.equal(PS.toasts.items.length, 0, 'dropped when the app comes back');
  PS.state.notificationManager = null; PS.toasts.setAppOpen(false);
});

test('push: finishing deletes the pins and offers a return to the gate, which retraces the push', () => {
  withClock(7000000, () => {
  reset(); sim.brake = 0; planBack(60);
  assert.equal(PS.push.view().canReturn.ok, false, 'nothing to return from yet');
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done');
  assert.equal(PS.plan.count(), 0, 'pins deleted');
  const v = PS.push.view();
  assert.ok(v.canReturn.ok, 'return offered: ' + v.canReturn.why);
  assert.ok(Math.abs(sim.y - (-60)) < 1.6);
  assert.ok(PS.push.requestStart({ returnToGate: true }), 'return accepted with no pins');
  run(5);
  assert.ok(PS.push.view().isReturn);
  run(200, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done', 'return finished: ' + PS.push.view().status);
  assert.ok(Math.hypot(sim.x, sim.y) < 1.6, 'back at the gate: ' + sim.x.toFixed(1) + ',' + sim.y.toFixed(1));
  assert.equal(PS.push.view().canReturn.ok, false, 'nothing more to return from');
  });
});

test('push: a return to the gate is refused if the aircraft is not where the push ended, or the brake holds it', () => {
  withClock(8000000, () => {
  reset(); sim.brake = 0; planBack(40);
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done');
  sim.y -= 100;                                  // the aircraft was moved
  assert.equal(PS.push.view().canReturn.ok, false);
  assert.match(PS.push.view().canReturn.why, /moved/);
  assert.equal(PS.push.requestStart({ returnToGate: true }), false);
  sim.y += 100; sim.brake = 1;
  assert.ok(PS.push.requestStart({ returnToGate: true }), 'accepted: the brake is released for the pilot like any push');
  run(5);
  assert.equal(sim.brake, 0, 'the brake was released by the app');
  assert.notEqual(PS.push.view().status, 'waitBrake');
  PS.push.stop('test');
  });
});

test('push: a stopped push can return to the gate over the ground it covered, and a stopped return can be carried on', () => {
  withClock(9000000, () => {
  reset(); sim.brake = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(40, () => { if (PS.push.view().status === 'driving' && sim.y < -25) return false; });
  PS.push.stop('test stop');
  run(10);
  assert.equal(PS.push.view().status, 'ready');
  const stoppedAt = sim.y;
  assert.ok(stoppedAt < -20 && stoppedAt > -70, 'stopped part way: ' + stoppedAt.toFixed(1));
  const v = PS.push.view();
  assert.ok(v.canReturn.ok, 'return offered: ' + v.canReturn.why);
  assert.ok(Math.abs(v.returnM - -stoppedAt) < 3, 'the way back is as far as it got: ' + v.returnM.toFixed(1) + ' vs ' + (-stoppedAt).toFixed(1));
  // go back part of the way, stop again, then carry on to the gate
  assert.ok(PS.push.requestStart({ returnToGate: true }));
  run(40, () => { if (PS.push.view().status === 'driving' && sim.y > stoppedAt / 2) return false; });
  PS.push.stop('test stop 2');
  run(10);
  assert.equal(PS.push.view().status, 'ready');
  assert.ok(PS.push.view().canReturn.ok, 'still offered: ' + PS.push.view().canReturn.why);
  assert.ok(PS.push.requestStart({ returnToGate: true }));
  run(200, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done');
  assert.ok(Math.hypot(sim.x, sim.y) < 1.6, 'back at the gate: ' + sim.x.toFixed(1) + ',' + sim.y.toFixed(1));
  });
});

test('push: Finish sets the brake and dismisses the tug, and skips whatever the pilot already did by hand', () => {
  withClock(10000000, () => {
  reset(); sim.brake = 0; planBack(40);
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done');
  assert.ok(PS.push.view().canFinish);
  assert.ok(PS.push.finish());
  run(4);
  assert.equal(sim.brake, 1, 'brake set'); assert.equal(sim.attached, 0, 'tug dismissed');
  assert.equal(PS.push.view().canFinish, false, 'nothing left to finish');
  // the pilot sets the brake first: Finish still dismisses the tug
  reset(); sim.brake = 0; planBack(30);
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  sim.brake = 1;
  assert.ok(PS.push.view().canFinish, 'the tug is still on');
  assert.ok(PS.push.finish());
  run(4);
  assert.equal(sim.attached, 0, 'tug dismissed even though the pilot set the brake');
  });
});
