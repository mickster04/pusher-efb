import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---- a fake sim, installed before the app loads ----
const sim = { eng: [0, 0], x: 0, y: 0, hdg: 0, velZ: 0, rotY: 0, wait: 1, attached: 0, attachAt: 0, brake: 1, beacon: 1, fbw: 0, pitch: 0, ground: 1, agl: 0, lastWrite: 0, writes: [], t0: 0, ref: { lat: -43.49, lon: 172.53 } };
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
      case 'LIGHT BEACON': return sim.beaconSwitch !== undefined ? sim.beaconSwitch : sim.beacon;   // the switch variable can say 1 while the light is off (the ATR)
      case 'LIGHT BEACON ON': return sim.beacon;
      case 'PLANE PITCH DEGREES': return sim.pitch;
      case 'L:A32NX_PUSHBACK_SYSTEM_ENABLED': return sim.fbw;
      case 'GROUND VELOCITY': return Math.abs(sim.velZ) * 0.5925;
      case 'VELOCITY BODY Z': return sim.velZ;
      case 'NUMBER OF ENGINES': return sim.engines === undefined ? 0 : sim.engines;
      default: {
        const m = /^(GENERAL ENG COMBUSTION|TURBINE ENG N1):(\d)$/.exec(name);
        if (m) { const v = sim.eng[Number(m[2]) - 1] || 0; return m[1] === 'GENERAL ENG COMBUSTION' ? (v > 0 ? 1 : 0) : v; }
        return 0;
      }
    }
  },
  SetSimVarValue(name, unit, value) {
    sim.writes.push([name, value]);
    switch (name) {
      case 'VELOCITY BODY Z': sim.velZ = value; sim.lastWrite = now(); break;
      case 'ROTATION VELOCITY BODY Y': sim.rotY = value; sim.lastWrite = now(); break;
      case 'PUSHBACK WAIT': sim.wait = value ? 1 : 0; break;
      case 'K:TOGGLE_PUSHBACK': sim.attachAt = now() + 250; break;           // the tug comes (or goes) a moment after the event
      case 'K:PARKING_BRAKES': if (sim.brakeLagMs) setTimeout(() => { sim.brake = sim.brake ? 0 : 1; }, sim.brakeLagMs); else sim.brake = sim.brake ? 0 : 1; sim.brakeToggles = (sim.brakeToggles || 0) + 1; break;
      case 'L:A32NX_PUSHBACK_SYSTEM_ENABLED': sim.fbw = value; break;
      case 'LIGHT BEACON': break;   // the switch variable is not written by the app any more
      case 'K:BEACON_LIGHTS_SET': if (!sim.beaconLocked) sim.beacon = value ? 1 : 0; break;   // some aircraft ignore the key events
      case 'K:TOGGLE_BEACON_LIGHTS': if (!sim.beaconLocked) sim.beacon = sim.beacon ? 0 : 1; break;
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
  Object.assign(sim, { eng: [0, 0], engines: undefined, x: 0, y: 0, hdg: 0, velZ: 0, rotY: 0, wait: 1, attached: 0, attachAt: 0, brake: 1, brakeLagMs: 0, brakeToggles: 0, beacon: 1, beaconSwitch: undefined, beaconLocked: false, fbw: 0, pitch: 0, ground: 1, agl: 0, lastWrite: 0, writes: [] });
  PS.state.taxi = null; PS.engines.reset(); PS.settings.set('requireEngines', true);
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
  assert.equal(PS.push.finishMode('done', PS.plan.count()), true, 'finished with no pins: the button is Finish push');
  planBack(30);                                  // the pilot plans another push after this one
  assert.equal(PS.push.finishMode('done', PS.plan.count()), false, 'new pins after a finished push: the button is Start push again');
  assert.equal(PS.push.canStart().ok, true, 'and a new push can start: ' + PS.push.canStart().why);
  });
});

test('push: the sim detaching the tug stops everything at once', () => {
  withClock(2000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(8, () => { if (PS.push.view().status === 'driving') return false; });
  run(10);
  assert.ok(sim.velZ < -0.5, 'moving back: ' + sim.velZ);
  sim.pitch = 6;                                   // the nose has lifted badly: no carrying on
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

const stand = (name, dx, dy, hdg) => { const p = G.fromXY(sim.ref.lat, sim.ref.lon, dx, dy); return { name, type: 1, lat: p[0], lon: p[1], headingDeg: hdg === undefined ? 0 : hdg, radiusM: 25 }; };

test('engines: the text counts good engine starts, held for a few seconds, as a tug operator would', () => {
  withClock(11000000, () => {
  reset(); sim.engines = 2;
  const poll = () => { PS.engines.status(); };                  // (on the Push tab, or from the push loop, this runs by itself)
  assert.equal(PS.engines.status().text, 'Waiting for a good engine start');
  sim.eng = [25, 0]; run(1, poll);
  assert.match(PS.engines.status().text, /Engine starting/, 'running but not yet held long enough');
  run(4, poll);
  assert.equal(PS.engines.status().text, '1 good engine start');
  sim.eng = [25, 30]; run(5, poll);
  assert.equal(PS.engines.status().text, '2 good engine starts');
  sim.eng = [5, 0]; run(5, poll);                               // combustion on but not turning over: not good
  assert.notEqual(PS.engines.status().good, 1);
  });
});

test('push: the tug is only dismissed after a good engine start, unless the aircraft is back at a gate or the setting is off', () => {
  withClock(12000000, () => {
  reset(); sim.brake = 0; sim.engines = 2; planBack(40);
  PS.state.taxi = { parking: [stand('A1', 0, 0)], items: [] };
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().status, 'done');
  assert.equal(PS.push.view().canFinish, false, 'no engine yet: the tug stays');
  PS.push.toggleTug(); run(2);
  assert.equal(sim.attached, 1, 'the dismiss was refused');
  assert.match(PS.push.view().engineGate.why, /engine/);
  sim.eng = [24, 0]; run(5);
  assert.equal(PS.push.view().engines.text, '1 good engine start');
  assert.ok(PS.push.view().canFinish, 'one good engine is enough');
  assert.ok(PS.push.finish()); run(4);
  assert.equal(sim.attached, 0);
  // the setting off: no wait
  reset(); sim.brake = 0; sim.engines = 2; planBack(30);
  PS.settings.set('requireEngines', false);
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.ok(PS.push.view().canFinish, 'dismissable with the setting off');
  });
});

test('push: return to gate needs the push to have started at a gate, and at the gate the tug can come off whatever the engines are doing', () => {
  withClock(13000000, () => {
  reset(); sim.brake = 0; sim.engines = 2; planBack(50);
  PS.state.taxi = { parking: [stand('B4', 0, 0)], items: [] };
  assert.ok(PS.push.requestStart());
  assert.equal(PS.push.view().gateLeft.name, 'B4'); assert.ok(PS.push.view().gateLeft.at);
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.ok(PS.push.view().canReturn.ok, PS.push.view().canReturn.why);
  assert.equal(PS.push.view().canFinish, false, 'engines off, away from the gate: the tug stays');
  assert.ok(PS.push.requestStart({ returnToGate: true }));
  run(200, () => { if (PS.push.view().status === 'done') return false; });
  const v = PS.push.view();
  assert.equal(v.status, 'done'); assert.match(v.reason, /back at gate B4/);
  assert.ok(v.gate.at, 'detected at the gate');
  assert.ok(v.canFinish, 'at the gate the tug comes off with no engine running');
  // a push that did not start at a gate has no gate to return to
  reset(); sim.brake = 0; planBack(50);
  PS.state.taxi = { parking: [stand('C2', 60, 60)], items: [] };
  assert.ok(PS.push.requestStart());
  run(150, () => { if (PS.push.view().status === 'done') return false; });
  assert.equal(PS.push.view().canReturn.ok, false);
  assert.match(PS.push.view().canReturn.why, /did not start at a gate/);
  });
});

test('gate: at a stand only when close, lined up and stopped', () => {
  withClock(14000000, () => {
  reset();
  PS.state.taxi = { parking: [stand('G1', 0, 0, 0), stand('G2', 100, 0, 0)], items: [] };
  const o = (hdg, gs) => ({ lat: sim.ref.lat, lon: sim.ref.lon, hdgDeg: hdg, gsKt: gs });
  assert.equal(PS.gate.detect(o(10, 0)).at, true);
  assert.equal(PS.gate.detect(o(10, 0)).name, 'G1');
  assert.equal(PS.gate.detect(o(120, 0)).at, false, 'nose off the stand');
  assert.equal(PS.gate.detect(o(0, 6)).at, false, 'still moving');
  const far = G.fromXY(sim.ref.lat, sim.ref.lon, 40, 0);
  assert.equal(PS.gate.detect({ lat: far[0], lon: far[1], hdgDeg: 0, gsKt: 0 }).at, false, 'too far from either stand');
  PS.state.taxi = null;
  assert.equal(PS.gate.detect(o(0, 0)).known, false, 'no stand data');
  });
});

test('services: a request sends the key event, and is refused while a push is under way', () => {
  withClock(15000000, () => {
  reset(); sim.brake = 0; planBack(60);
  sim.writes.length = 0;
  assert.equal(PS.services.request('jetbridge').ok, true);
  assert.ok(sim.writes.some((w) => w[0] === 'K:TOGGLE_JETWAY'));
  ['fuel', 'baggage', 'catering', 'power'].forEach((id) => assert.ok(PS.services.request(id).ok));
  ['REQUEST_FUEL_KEY', 'REQUEST_LUGGAGE', 'REQUEST_CATERING', 'REQUEST_POWER_SUPPLY'].forEach((e) => assert.ok(sim.writes.some((w) => w[0] === 'K:' + e), e));
  assert.ok(PS.services.recently('fuel'));
  assert.ok(PS.push.requestStart());
  run(10, () => { if (PS.push.view().status === 'driving') return false; });
  assert.equal(PS.services.can().ok, false);
  sim.writes.length = 0;
  assert.equal(PS.services.request('fuel').ok, false);
  assert.equal(sim.writes.length, 0, 'nothing sent mid-push');
  });
});

test('push: a pause longer than the not-moving limit does not abort the push on resume', () => {
  withClock(30000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(30, () => { if (PS.push.view().status === 'driving') return false; });
  run(5);
  PS.push.pause();
  run(15);                                                  // longer than the 8 s "not moving" limit
  assert.equal(PS.push.view().status, 'paused');
  PS.push.resume();
  run(3);
  assert.equal(PS.push.view().status, 'driving', 'still driving after the resume: ' + PS.push.view().status);
  PS.push.stop('test stop'); run(4);
  });
});

test('push: a position that is NaN stops the push and nothing but numbers is written', () => {
  withClock(31000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(80);
  assert.ok(PS.push.requestStart());
  run(30, () => { if (PS.push.view().status === 'driving') return false; });
  run(3);
  const from = sim.writes.length;
  sim.x = NaN;
  run(3);
  assert.notEqual(PS.push.view().status, 'driving');
  assert.ok(sim.writes.slice(from).every((w) => Number.isFinite(w[1])), 'no NaN reached the sim');
  });
});

test('push: the run limit is 20 minutes for a short push and grows with a long route', () => {
  withClock(40000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(60);
  assert.ok(PS.push.requestStart());
  assert.equal(PS.push.view().runLimitMs, 20 * 60 * 1000);
  PS.push.stop('test'); run(4);
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(4500);
  assert.ok(PS.push.requestStart());
  assert.ok(PS.push.view().runLimitMs > 60 * 60 * 1000, 'a 4.5 km route gets over an hour: ' + PS.push.view().runLimitMs);
  PS.push.stop('test'); run(4);
  });
});

test('push: starting with pins left at another airport clears them and says there is no route', () => {
  withClock(41000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0;
  const far = G.offset(sim.ref.lat, sim.ref.lon, 90, 30000); PS.plan.add(far[0], far[1]);
  assert.equal(PS.push.requestStart(), false);
  assert.equal(PS.plan.count(), 0, 'the far pins were cleared');
  });
});

test('push: waits for the beacon before calling the tug, carries on once it is on, and the setting can turn the wait off', () => {
  withClock(50000000, () => {
  reset(); planBack(60); sim.beacon = 0; sim.beaconLocked = true;
  assert.ok(PS.push.requestStart(), 'start accepted');
  assert.equal(PS.push.view().status, 'waitBeacon', 'waiting for the beacon: ' + PS.push.view().status);
  run(2);
  assert.equal(sim.attached, 0, 'the tug is not called while the beacon is off');
  assert.ok(PS.toasts.items.some((t) => t.id === 'push-beacon'), 'the beacon prompt is up');
  sim.beacon = 1;
  run(1);
  assert.equal(sim.attached, 1, 'the beacon is on: the tug was called: ' + PS.push.view().status);
  assert.ok(!PS.toasts.items.some((t) => t.id === 'push-beacon'), 'the beacon prompt went away');
  PS.push.stop('test');
  reset(); planBack(60); sim.beacon = 0;
  PS.settings.set('requireBeacon', false);
  assert.ok(PS.push.requestStart(), 'start accepted');
  assert.equal(PS.push.view().status, 'attaching', 'with the wait off the tug is called at once');
  PS.settings.set('requireBeacon', true);
  PS.push.emergencyStop('test end'); run(1);
  });
});

test('push: the aircraft\'s own (FlyByWire) pushback system is switched off while our tug is on, kept off if the pilot turns it on, and put back afterwards', () => {
  withClock(51000000, () => {
  reset(); planBack(60); sim.fbw = 1; sim.brake = 0;
  assert.ok(PS.push.requestStart(), 'start accepted');
  assert.equal(sim.fbw, 0, 'switched off as the push starts');
  run(3);
  sim.fbw = 1;                                   // the pilot enables the flyPad pushback while our tug is on
  run(1);
  assert.equal(sim.fbw, 0, 'switched off again');
  PS.push.emergencyStop('test'); PS.push.dismissTug();
  run(3);
  assert.equal(sim.fbw, 1, 'put back as it was once the tug is gone');
  });
});

test('push: when the sim lets go of the tug mid-push the app calls it again and carries on; too many times, a lifted nose or no progress stops it', () => {
  withClock(52000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(120);
  assert.ok(PS.push.requestStart());
  run(30, () => { if (PS.push.view().status === 'driving') return false; });
  run(15);                                       // driving for a while, with record of progress
  assert.equal(PS.push.view().status, 'driving');
  const y0 = sim.y;
  sim.attached = 0;                              // the sim lets go
  run(1);
  assert.ok(['reattach', 'settling'].includes(PS.push.view().status), 'calling the tug again: ' + PS.push.view().status);
  assert.ok(PS.logs.some((e) => /calling the tug again \(1 of 3/.test(e.msg || e.text || e.message || '')), 'logged the recovery');
  run(10);
  assert.equal(PS.push.view().status, 'driving', 'carrying on: ' + PS.push.view().status);
  run(10);
  assert.ok(sim.y < y0 - 1 || Math.abs(sim.y - y0) > 1, 'moving again');
  PS.push.emergencyStop('test end'); run(1);
  });
});

test('push: a nose that lifts during the push stops it', () => {
  withClock(53000000, () => {
  reset(); sim.brake = 0; sim.attached = 1; sim.wait = 0; planBack(120);
  assert.ok(PS.push.requestStart());
  run(30, () => { if (PS.push.view().status === 'driving') return false; });
  run(4);
  assert.equal(PS.push.view().status, 'driving');
  sim.pitch = -4;                                // nose up 4 deg from where it began (the sim reports + as nose down)
  run(3);
  const v = PS.push.view();
  assert.ok(v.status === 'stopping' || v.status === 'ready', 'stopped: ' + v.status);
  assert.match(v.reason, /nose pitch/, 'says why: ' + v.reason);
  PS.push.emergencyStop('test end'); run(1);
  });
});

test('push: the main button is the next step (tug, brake, beacon), follows what is done outside the app, and the push starts by itself once the last step is done', () => {
  withClock(54000000, () => {
  reset(); planBack(80); sim.beacon = 0; sim.brake = 1;
  assert.equal(PS.push.nextStep(), 'tug', 'first: call the tug');
  PS.push.watchSteps();                           // the first look never starts anything
  PS.push.doNextStep();                           // the pilot presses the button
  run(2);
  assert.equal(sim.attached, 1, 'the tug was called');
  assert.equal(PS.push.nextStep(), 'brake', 'then: release the brake');
  sim.brake = 0;                                   // done by hand in the cockpit
  assert.equal(PS.push.nextStep(), 'beacon', 'the button moved on by itself: beacon light');
  run(1);
  assert.notEqual(PS.push.view().status, 'driving', 'nothing starts while a step is missing');
  PS.push.doNextStep();                            // beacon light on, through the button
  run(2);
  assert.equal(sim.beacon, 1, 'the beacon was turned on');
  PS.push.watchSteps();
  run(6);
  const st = PS.push.view().status;
  assert.ok(st === 'settling' || st === 'driving', 'all steps done: the push started by itself, status ' + st);
  PS.push.emergencyStop('test end'); run(1);
  });
});

test('push: opening the app with every step already done does not start a push, and no plan is not ready to go', () => {
  withClock(55000000, () => {
  reset(); planBack(80); sim.beacon = 1; sim.brake = 0; sim.attached = 1; sim.wait = 0;
  PS.push.watchSteps();
  run(2);
  assert.equal(PS.push.nextStep(), 'go');
  assert.ok(!PS.push.isActive(), 'no push started on the first look: ' + PS.push.view().status);
  PS.plan.clear();
  assert.notEqual(PS.push.nextStep(), 'go', 'steps done but nothing planned: not ready to go (no plan, or Finish after an earlier push)');
  PS.push.emergencyStop('test end'); run(1);
  });
});

test('push: a brake that is slow to move (the ATR) gets one toggle, not one per press, and ends released', () => {
  withClock(56000000, () => {
  reset(); planBack(60); sim.attached = 1; sim.wait = 0; sim.beacon = 1; sim.brake = 1; sim.brakeLagMs = 1800;
  PS.push.watchSteps();
  assert.equal(PS.push.nextStep(), 'brake');
  PS.push.doNextStep(); run(1); PS.push.doNextStep(); run(1); PS.push.doNextStep();   // the pilot presses it three times while it is moving
  assert.equal(sim.brakeToggles, 1, 'one PARKING_BRAKES toggle, not one per press: ' + sim.brakeToggles);
  run(5);
  assert.equal(sim.brake, 0, 'released once the sim got there');
  assert.ok(!PS.logs.some((e) => /release: FAILED, it would not/.test(e.msg || e.text || e.message || '')), 'not reported as failed while it was still moving');
  PS.push.emergencyStop('test end'); run(1);
  sim.brakeLagMs = 0;
  });
});

test('push: the beacon counts as on when the light or the switch says so, and a loop route is not started', () => {
  withClock(57000000, () => {
  reset(); planBack(60); sim.attached = 1; sim.wait = 0; sim.brake = 0;
  sim.beacon = 0; sim.beaconSwitch = 1;               // the switch says on, the light is dark (no power yet)
  assert.equal(PS.beacon.read().on, true, 'the switch being on counts');
  sim.beaconSwitch = 0;                                // both off
  assert.equal(PS.beacon.read().on, false, 'both off is off');
  assert.equal(PS.push.nextStep(), 'beacon', 'so the beacon is the next step');
  sim.beaconSwitch = undefined;
  // a route the planner calls severe (a loop, or a start more than 90 deg off the aircraft's axis) cannot be driven: not started
  const real = PS.plan.evaluate;
  PS.plan.evaluate = (o) => Object.assign(real(o), { severe: true });
  try {
    sim.beacon = 1;
    assert.equal(PS.push.canStart(false).ok, false, 'not startable');
    assert.match(PS.push.canStart(false).why, /loop or starts far off/, 'says why');
    assert.equal(PS.push.requestStart(), false, 'and a start is refused');
  } finally {
    PS.plan.evaluate = real;
  }
  PS.plan.clear();
  });
});

test('push: a flickering beacon does not start a push, and after Stop nothing starts by itself until the pilot presses a step', () => {
  withClock(58000000, () => {
  reset(); planBack(80); sim.attached = 1; sim.wait = 0; sim.brake = 0; sim.beacon = 0;
  PS.push.watchSteps(); run(1);
  sim.beacon = 1; PS.push.watchSteps(); run(0.3); PS.push.watchSteps();   // on for a moment
  sim.beacon = 0; run(1); PS.push.watchSteps(); run(3);
  assert.ok(!PS.push.isActive(), 'a flicker started nothing: ' + PS.push.view().status);
  sim.beacon = 1; for (let i = 0; i < 8; i++) { run(1); PS.push.watchSteps(); }     // really on: starts by itself after 2 s (the Push tab calls this every half second)
  assert.ok(PS.push.isActive(), 'steady on starts the push: ' + PS.push.view().status);
  PS.push.stop('test');
  run(1);
  sim.beacon = 0; run(2); PS.push.watchSteps(); sim.beacon = 1; for (let i = 0; i < 8; i++) { run(1); PS.push.watchSteps(); }
  assert.ok(!PS.push.isActive(), 'after Stop the beacon coming on again does not restart it: ' + PS.push.view().status);
  PS.push.doNextStep();                                                   // the pilot presses a step: automatic start is back
  PS.push.emergencyStop('test end'); run(1);
  });
});

test('push: the view reads the parking brake fresh, so a brake moved in the cockpit shows without a push running', () => {
  withClock(59000000, () => {
  reset(); sim.brake = 1;
  assert.equal(PS.push.view().brake.set, true);
  sim.brake = 0;
  assert.equal(PS.push.view().brake.set, false, 'seen at once');
  });
});

test('push: with the parking brake ignored (Settings) the brake is not a step, does not hold the push, and does not stop it', () => {
  withClock(60000000, () => {
  reset(); planBack(80); sim.attached = 1; sim.wait = 0; sim.beacon = 1; sim.brake = 1;
  PS.settings.set('requireBrake', false);
  try {
    assert.notEqual(PS.push.nextStep(), 'brake', 'the brake is not the next step');
    assert.equal(PS.push.nextStep(), 'go');
    assert.ok(PS.push.requestStart(), 'start accepted with the brake set');
    run(6);
    assert.equal(PS.push.view().status, 'driving', 'driving with the brake reading set: ' + PS.push.view().status);
    run(3);
    assert.equal(PS.push.view().status, 'driving', 'and it is not stopped for it');
  } finally {
    PS.settings.set('requireBrake', true);
    PS.push.emergencyStop('test end'); run(1);
  }
  });
});
