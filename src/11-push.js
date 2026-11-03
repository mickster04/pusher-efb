// The push: attach the tug, make sure the parking brake is off, then drive the planned route with the path follower, showing the distance left.
// Built on PS.tug and PS.brake (09-tug.js), PS.follow (10-follow.js) and the plan (PS.plan). The Push tab is the interface to this.
//
// Status: idle -> attaching -> ready (tug on) ; Start: waitBrake (until the parking brake is off) -> settling -> driving -> stopping -> done
//         driving <-> paused (you) ; driving -> brakeHold (the brake was set mid-push; resumes by itself when released) ; any -> ready (stopped)
//
// Safety: nothing is written to the aircraft unless the tug is attached; the push stops at once if the sim detaches the tug, the app is paused or
// closed, the aircraft leaves the ground, the position cannot be read, or the follower reports the path is lost or the aircraft is not moving.
// None of this has been run in the sim yet.

PS.push = (function () {
  var TICK_MS = 50;
  var SETTLE_MS = 2500;            // after attaching, before the first drive write (the original waits longer on a fresh attach; not yet tuned here)
  var SPEED_RAMP = 14;             // ft/s per second (the original reaches cruise in about 0.35 s)
  var YAW_RAMP = 5;                // degrees per second per second
  var MAX_RUN_MS = 20 * 60 * 1000;
  var AGL_ABORT_FT = 25;
  var SPEED_KEY = 'pushplanner.speedpercent';

  var S = {
    status: 'idle', reason: '', speedPercent: 50, plan: null, follower: null, totalM: 0,
    cur: { speed: 0, yaw: 0 }, last: { remainingM: 0, leg: 0, legCount: 0, phase: '', cte: 0, alphaDeg: 0, speedFtS: 0, yawDegS: 0, note: '' },
    startedAt: 0, doneAt: 0, attached: false, brake: null, writes: 0, failures: 0, lastError: '', stopNext: 'ready', stopQuietSince: 0,
    lastTick: 0, lastSlow: 0, lastLog: 0, lastBrakeCheck: 0, poseFails: 0, prevHdg: null, prevHdgAt: 0, measuredYaw: null, wantRun: false, settleStart: 0, brakeAsked: false
  };
  var timer = null;
  try { var sp = Number(window.localStorage.getItem(SPEED_KEY)); if (sp >= 10 && sp <= 100) S.speedPercent = sp; } catch (e0) { /* storage may be unavailable */ }

  function log(msg) { PS.log('push', msg); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function approach(cur, target, maxStep) { return cur < target ? Math.min(target, cur + maxStep) : Math.max(target, cur - maxStep); }
  function cruiseUnits() { return clamp(Math.round(S.speedPercent / 100 * 50), 5, 50); }   // the original's speed factor: 5 to 50, one unit = 0.2 ft/s
  function readPose() {
    var la = PS.getVar('PLANE LATITUDE', 'degrees'), lo = PS.getVar('PLANE LONGITUDE', 'degrees'), hd = PS.getVar('PLANE HEADING DEGREES TRUE', 'degrees');
    if (!la.ok || !lo.ok || !hd.ok || typeof la.value !== 'number' || typeof lo.value !== 'number' || typeof hd.value !== 'number') return null;
    return { lat: la.value, lon: lo.value, hdgDeg: hd.value };
  }
  function onGround() {
    var g = PS.getVar('SIM ON GROUND', 'bool'), a = PS.getVar('PLANE ALT ABOVE GROUND', 'feet');
    return { ok: g.ok, ground: g.ok && Number(g.value) > 0, agl: a.ok ? a.value : null };
  }

  var ACTIVE = { attaching: 1, waitBrake: 1, settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 };
  var wasActive = false;
  function setStatus(st, why) {
    if (S.status !== st || S.reason !== (why || '')) log('status: ' + st + (why ? ' (' + why + ')' : ''));
    S.status = st; S.reason = why || '';
    ensureLoop(); updateToasts(true);
  }
  // The tick loop runs while a push is active (restarted fresh each time one becomes active) and, slowly, while the tug is simply on; it is
  // stopped when nothing is going on, so a finished or dismissed push leaves no timer behind.
  function ensureLoop() {
    var active = !!ACTIVE[S.status], wanted = active || S.status === 'ready';
    if (!wanted) { if (timer !== null) { clearInterval(timer); timer = null; } wasActive = false; return; }
    if (timer === null || (active && !wasActive)) {
      if (timer !== null) clearInterval(timer);
      S.lastTick = Date.now(); timer = setInterval(tick, TICK_MS);
    }
    wasActive = active;
  }

  // ---------------- toasts: the progress popup (distance left, Pause/Resume, Stop) and the brake prompt ----------------
  var finishToastShown = false;
  function remainingText() {
    var l = S.last, leg = S.follower ? S.follower.legs[Math.min(l.leg, S.follower.legs.length - 1)] : null;
    return PS.fmt.dist(l.remainingM) + ' left' + (S.follower && l.legCount > 1 ? ', leg ' + (l.leg + 1) + ' of ' + l.legCount : '') + (leg ? (leg.sign < 0 ? ', pushing back' : ', driving forward') : '');
  }
  function updateToasts(force) {
    var running = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 };
    if (running[S.status]) {
      var paused = S.status === 'paused' || (S.status === 'stopping' && S.stopNext === 'paused');
      PS.toasts.show({ id: 'push', kind: S.status === 'brakeHold' ? 'brake' : 'info', persistent: true,
        title: 'Pushback' + (paused ? ' (paused)' : (S.status === 'brakeHold' ? ' (brake set)' : '')),
        message: S.status === 'brakeHold' ? 'The parking brake was set. Release it and the push carries on. ' + remainingText() : (S.status === 'settling' ? 'Starting...' : remainingText()),
        actions: [{ label: paused ? 'Resume' : 'Pause', onClick: function () { if (paused) resume(); else pause(); } }, { label: 'Stop', onClick: function () { stop('stopped by you'); } }] });
    } else {
      PS.toasts.dismiss('push');
    }
    if (S.status === 'waitBrake') {
      PS.toasts.show({ id: 'push-brake', kind: 'brake', persistent: true, title: 'Release the parking brake',
        message: 'The push starts as soon as the brake is off.', actions: [{ label: 'Release it for me', onClick: function () { releaseBrake(); } }, { label: 'Cancel', onClick: function () { stop('cancelled by you'); } }] });
    } else if (S.status !== 'brakeHold') {
      PS.toasts.dismiss('push-brake');
    }
    if (S.status === 'done') {
      if (!finishToastShown) {
        finishToastShown = true;
        PS.toasts.show({ id: 'push-done', kind: 'info', persistent: true, title: 'Push finished', message: 'Set the parking brake, then dismiss the tug.',
          actions: [{ label: 'Set the brake', onClick: function () { setBrake(); } }, { label: 'Dismiss tug', onClick: function () { dismissTug(); PS.toasts.dismiss('push-done'); } }, { label: 'x', onClick: function () { PS.toasts.dismiss('push-done'); } }] });
      }
    } else { finishToastShown = false; if (S.status !== 'done') PS.toasts.dismiss('push-done'); }
  }

  // ---------------- brake ----------------
  function releaseBrake() {
    log('releasing the parking brake');
    PS.brake.release(function (r) { log('parking brake release: ' + (r.ok ? 'done, ' : 'FAILED, ') + r.how); S.brake = PS.brake.read(true); });
  }
  function setBrake() {
    log('setting the parking brake');
    PS.brake.set(function (r) { log('parking brake set: ' + (r.ok ? 'done, ' : 'FAILED, ') + r.how); S.brake = PS.brake.read(true); });
  }

  // ---------------- control ----------------
  function canStart() {
    if (PS.plan.count() === 0) return { ok: false, why: 'There is no plan yet: make one on the Plan tab.' };
    if ({ settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, waitBrake: 1, attaching: 1 }[S.status]) return { ok: false, why: 'A push is already under way.' };
    var g = onGround();
    if (g.ok && (!g.ground || (typeof g.agl === 'number' && g.agl > AGL_ABORT_FT))) return { ok: false, why: 'The aircraft is not on the ground.' };
    return { ok: true, why: '' };
  }

  // Start: attach the tug if it is not on, wait for the parking brake to be off, settle, then drive the plan.
  function requestStart() {
    var c = canStart();
    if (!c.ok) { S.reason = c.why; log('cannot start: ' + c.why); return false; }
    S.wantRun = true; S.brakeAsked = false;
    var pose = readPose();
    if (!pose) { S.reason = 'The aircraft position cannot be read.'; log('cannot start: ' + S.reason); return false; }
    var plan = PS.plan.evaluate(pose);        // planned again from where the aircraft is now
    if (plan.empty || !plan.segments.length) { S.reason = 'The plan has no route from here.'; log('cannot start: ' + S.reason); return false; }
    S.plan = plan; S.totalM = plan.totalM;
    S.follower = PS.follow.create(PS.follow.legsFromPlan(plan), { cruiseUnits: cruiseUnits() });
    S.cur = { speed: 0, yaw: 0 }; S.writes = 0; S.failures = 0; S.lastError = ''; S.measuredYaw = null; S.prevHdg = null;
    S.last = { remainingM: plan.totalM, leg: 0, legCount: plan.legs.length, phase: 'run', cte: 0, alphaDeg: 0, speedFtS: 0, yawDegS: 0, note: '' };
    log('push requested: ' + PS.fmt.dist(plan.totalM) + ' in ' + plan.legs.length + ' leg(s), turn radius ' + Math.round(plan.radiusM) + ' m, cruise speed factor ' + cruiseUnits() + ' (' + S.speedPercent + '%)' +
      (plan.warnings.length ? ', WITH WARNINGS: ' + plan.warnings.join(' | ') : ''));
    if (!PS.tug.isAttached()) {
      setStatus('attaching', 'calling the tug');
      PS.tug.attach(function (r) {
        if (!S.wantRun) return;
        if (!r.ok) { S.wantRun = false; setStatus('idle', r.error); return; }
        beginBrakeCheck();
      });
    } else beginBrakeCheck();
    return true;
  }
  function beginBrakeCheck() {
    S.brake = PS.brake.read(true);
    if (S.brake.set) { setStatus('waitBrake', 'the parking brake is set'); }
    else beginSettling();
  }
  function beginSettling() { S.settleStart = Date.now(); setStatus('settling', 'tug attached'); }
  function beginDriving() {
    S.startedAt = Date.now(); S.cur = { speed: 0, yaw: 0 }; S.poseFails = 0; S.lastLog = 0;
    setStatus('driving', '');
  }

  // Ease speed and turn to zero while still writing every tick (velocity is not sticky), then hold; `next` is where it goes afterwards.
  function beginStopping(reason, next) {
    S.stopNext = next || 'ready'; S.stopQuietSince = 0;
    setStatus('stopping', reason || '');
  }
  function pause() { if (S.status === 'driving') { log('pause pressed'); beginStopping('paused', 'paused'); } }
  function resume() {
    if (S.status === 'paused' || (S.status === 'stopping' && S.stopNext === 'paused')) {
      log('resume pressed'); S.stopNext = 'driving'; if (S.status === 'paused') setStatus('driving', ''); else updateToasts(true);
    }
  }
  function stop(why) {
    S.wantRun = false;
    if (S.status === 'driving' || S.status === 'paused' || S.status === 'brakeHold') { log('stop: ' + why); beginStopping(why, 'ready'); }
    else if (S.status === 'stopping') { S.stopNext = 'ready'; }
    else if (S.status === 'waitBrake' || S.status === 'settling' || S.status === 'attaching') {
      PS.tug.cancelAttach(); setStatus(PS.tug.isAttached() ? 'ready' : 'idle', why);
    }
  }
  // At once: used when the sim detaches the tug, the app is paused or closed, or something is wrong. Zero everything, no easing.
  function emergencyStop(why) {
    var active = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, waitBrake: 1, attaching: 1 }[S.status];
    S.wantRun = false;
    if (!active) return;
    log('EMERGENCY STOP: ' + why);
    if (PS.tug.isAttached()) PS.tug.zeroAndHold();
    S.cur = { speed: 0, yaw: 0 };
    PS.tug.cancelAttach();
    setStatus(PS.tug.isAttached() ? 'ready' : 'idle', why);
  }

  function toggleTug() {
    if (PS.tug.isAttached()) {
      emergencyStop('dismissing the tug');
      dismissTug();
    } else if (S.status === 'idle' || S.status === 'ready' || S.status === 'done') {
      setStatus('attaching', 'calling the tug');
      PS.tug.attach(function (r) { setStatus(r.ok ? 'ready' : 'idle', r.ok ? 'tug attached' : r.error); S.attached = PS.tug.isAttached(); if (r.ok) S.brake = PS.brake.read(true); });
    }
  }
  function dismissTug() { PS.tug.detach(); setStatus('idle', 'tug dismissed'); }

  // ---------------- the loop ----------------
  function slowChecks(now) {
    S.attached = PS.tug.isAttached();
    var live = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 }[S.status];
    if (live && !S.attached) { emergencyStop('the sim detached the tug'); return; }
    if (S.status === 'ready' && !S.attached) { setStatus('idle', 'the tug is no longer attached'); return; }
    if (live && S.startedAt && now - S.startedAt > MAX_RUN_MS) { emergencyStop('the push has run for 20 minutes'); return; }
    // The brake, read every half second while it matters.
    if (now - S.lastBrakeCheck >= 500 && (live || S.status === 'ready' || S.status === 'waitBrake')) {
      S.lastBrakeCheck = now; S.brake = PS.brake.read(false);
      if (S.status === 'driving' && S.brake.set) { log('the parking brake was set during the push'); beginStopping('the parking brake was set', 'brakeHold'); }
    }
    if (S.status === 'driving' || S.status === 'stopping') {
      var g = onGround();
      if (g.ok && (!g.ground || (typeof g.agl === 'number' && g.agl > AGL_ABORT_FT))) emergencyStop('the aircraft left the ground');
    }
    updateToasts(false);
  }

  function tick() {
    var now = Date.now(), dt = clamp((now - S.lastTick) / 1000, 0.01, 0.12);
    S.lastTick = now;
    if (now - S.lastSlow >= 250) { S.lastSlow = now; slowChecks(now); }
    switch (S.status) {
      case 'waitBrake':
        if (now - S.lastBrakeCheck < 400) break;
        S.lastBrakeCheck = now; S.brake = PS.brake.read(false);
        if (!S.brake.set) { log('the parking brake is off'); beginSettling(); }
        break;
      case 'settling':
        if (PS.tug.attachedMs() >= SETTLE_MS && now - S.settleStart >= 1000) beginDriving();
        break;
      case 'driving': driveTick(now, dt); break;
      case 'stopping': stopTick(now, dt); break;
      case 'brakeHold':
        PS.tug.zeroAndHold();
        if (S.brake && !S.brake.set) { log('the parking brake is off again: carrying on'); S.cur = { speed: 0, yaw: 0 }; setStatus('driving', ''); }
        break;
      case 'paused': PS.tug.zeroAndHold(); break;
      default: break;
    }
  }

  function driveTick(now, dt) {
    var pose = readPose();
    if (!pose) { S.poseFails++; if (S.poseFails > 20) emergencyStop('the aircraft position cannot be read'); return; }
    S.poseFails = 0;
    pose.t = (now - S.startedAt) / 1000;
    var out = S.follower.update(pose, dt, S.cur.speed);
    S.last = { remainingM: out.remainingM, leg: out.leg, legCount: out.legCount, phase: out.phase, cte: out.cte, alphaDeg: out.alphaDeg, speedFtS: out.speedFtS, yawDegS: out.yawDegS, note: out.note };
    if (out.stop) { log('stopping: ' + out.stop); S.wantRun = false; beginStopping(out.stop, 'ready'); return; }
    if (out.done) { log('route finished'); beginStopping('', 'done'); return; }
    S.cur.speed = approach(S.cur.speed, out.speedFtS, SPEED_RAMP * dt);
    S.cur.yaw = approach(S.cur.yaw, out.yawDegS, YAW_RAMP * dt);
    var w = PS.tug.write(S.cur.speed, S.cur.yaw);
    S.writes++; if (!w.ok) { S.failures++; S.lastError = w.error; }
    // measured nose turn rate and a log line each second, for tuning against the sim
    if (S.prevHdg !== null && now - S.prevHdgAt >= 1000) {
      S.measuredYaw = PS.geo.angleDiff(S.prevHdg, pose.hdgDeg) / ((now - S.prevHdgAt) / 1000); S.prevHdg = pose.hdgDeg; S.prevHdgAt = now;
    } else if (S.prevHdg === null) { S.prevHdg = pose.hdgDeg; S.prevHdgAt = now; }
    if (now - S.lastLog >= 1000) {
      S.lastLog = now;
      var gs = PS.getVar('GROUND VELOCITY', 'knots'), vz = PS.getVar('VELOCITY BODY Z', 'feet per second');
      log('drive t=' + PS.fmt.num(pose.t, 0) + 's ' + out.phase + ' leg ' + (out.leg + 1) + '/' + out.legCount + ' left ' + PS.fmt.num(out.remainingM, 1) + ' m | speed target ' + PS.fmt.num(out.speedFtS, 2) + ' ramped ' + PS.fmt.num(S.cur.speed, 2) + ' read ' + PS.fmt.num(vz.value, 2) + ' ft/s, GS ' + PS.fmt.num(gs.value, 2) + ' kt | yaw target ' + PS.fmt.num(out.yawDegS, 2) + ' ramped ' + PS.fmt.num(S.cur.yaw, 2) + ' measured ' + PS.fmt.num(S.measuredYaw, 2) + ' deg/s | off path ' + PS.fmt.num(out.cte, 2) + ' m, aim ' + PS.fmt.num(out.alphaDeg, 1) + ' deg, heading ' + PS.fmt.num(pose.hdgDeg, 1) +
        ' | writes ' + S.writes + ' failed ' + S.failures + (out.note ? ' | ' + out.note : ''));
    }
  }

  function stopTick(now, dt) {
    S.cur.speed = approach(S.cur.speed, 0, SPEED_RAMP * dt);
    S.cur.yaw = approach(S.cur.yaw, 0, YAW_RAMP * dt);
    var w = PS.tug.write(S.cur.speed, S.cur.yaw);
    S.writes++; if (!w.ok) { S.failures++; S.lastError = w.error; }
    if (S.cur.speed === 0 && S.cur.yaw === 0) {
      if (!S.stopQuietSince) S.stopQuietSince = now;
      if (now - S.stopQuietSince >= 600) {
        PS.tug.zeroAndHold();
        var next = S.stopNext;
        if (next === 'driving') { setStatus('driving', ''); return; }
        if (next === 'done') { S.doneAt = Date.now(); S.last.remainingM = 0; setStatus('done', 'the route is finished'); return; }
        setStatus(next, next === 'paused' ? 'held still' : (next === 'brakeHold' ? 'waiting for the parking brake to be released' : S.reason));
      }
    } else S.stopQuietSince = 0;
  }

  PS.closeHooks.push(function (why) { emergencyStop('the app was ' + (why || 'paused or closed')); });

  // What the Push tab shows.
  function view() {
    var l = S.last, leg = S.follower ? S.follower.legs[Math.min(l.leg, S.follower.legs.length - 1)] : null;
    return {
      status: S.status, reason: S.reason, attached: S.attached, brake: S.brake, plan: S.plan, totalM: S.totalM, speedPercent: S.speedPercent, cruiseUnits: cruiseUnits(),
      remainingM: l.remainingM, leg: l.leg, legCount: l.legCount, phase: l.phase, cte: l.cte, alphaDeg: l.alphaDeg, speedFtS: S.cur.speed, yawDegS: S.cur.yaw, measuredYaw: S.measuredYaw,
      direction: leg ? (leg.sign < 0 ? 'push back' : 'drive forward') : '', elapsedS: S.startedAt && (S.status === 'driving' || S.status === 'stopping' || S.status === 'paused' || S.status === 'brakeHold') ? (Date.now() - S.startedAt) / 1000 : 0,
      writes: S.writes, failures: S.failures, lastError: S.lastError, note: l.note, progress: S.totalM > 0 ? clamp(1 - l.remainingM / S.totalM, 0, 1) : 0
    };
  }

  function setSpeedPercent(p) {
    S.speedPercent = clamp(Math.round(p), 10, 100);
    try { window.localStorage.setItem(SPEED_KEY, String(S.speedPercent)); } catch (e1) { /* not saved */ }
    log('cruise speed set to ' + S.speedPercent + '% (speed factor ' + cruiseUnits() + ')');
  }

  // Look at the tug once when the app starts, so the tab opens showing the truth.
  S.attached = PS.tug.isAttached();
  if (S.attached) { S.status = 'ready'; S.reason = 'the tug is already attached'; ensureLoop(); }

  return { view: view, canStart: canStart, requestStart: requestStart, pause: pause, resume: resume, stop: stop, emergencyStop: emergencyStop, toggleTug: toggleTug, dismissTug: dismissTug,
    releaseBrake: releaseBrake, setBrake: setBrake, setSpeedPercent: setSpeedPercent, route: function () { return S.plan; } };
})();
