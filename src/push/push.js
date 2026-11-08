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
  var SETTLE_MS = 2500; // after attaching, before the first drive write (the original waits longer on a fresh attach; not yet tuned here)
  var SPEED_RAMP = 14; // ft/s per second (the original reaches cruise in about 0.35 s)
  var YAW_RAMP = 5; // degrees per second per second (building up the turn)
  var YAW_RAMP_DOWN = 20; // easing the turn off: the real nose turns about 2.3x what is commanded, so a turn left running while stopping jiggles the aircraft
  // A push is ended after this long whatever else happens (the last resort behind the other watchdogs). A long route needs longer: the allowance is
  // 1.5 x the time the route takes at the chosen top speed (3/4 of it, the slowest the tug goes), and never less than this.
  var MIN_RUN_MS = 20 * 60 * 1000;
  function runLimitMs(routeM) {
    var cruiseMs = cruiseUnits() * 0.2 * 0.3048; // 0.2 ft/s per speed unit
    return Math.max(MIN_RUN_MS, ((1.5 * routeM) / (cruiseMs * 0.75)) * 1000);
  }
  var AGL_ABORT_FT = 25;
  var STALL_MS = 1200;
  var RETURN_NEAR_M = 20,
    RETURN_MIN_M = 2;
  var SPEED_KEY = 'pushplanner.speedpercent';

  var S = {
    status: 'idle',
    reason: '',
    speedPercent: 50,
    plan: null,
    follower: null,
    profile: null,
    info: null,
    totalM: 0,
    cur: { speed: 0, yaw: 0 },
    last: { remainingM: 0, leg: 0, legCount: 0, phase: '', cte: 0, alphaDeg: 0, speedFtS: 0, yawDegS: 0, note: '' },
    startedAt: 0,
    runLimitMs: MIN_RUN_MS,
    attached: false,
    brake: null,
    writes: 0,
    failures: 0,
    lastError: '',
    stopNext: 'ready',
    stopQuietSince: 0,
    lastTick: 0,
    lastSlow: 0,
    lastLog: 0,
    lastBrakeCheck: 0,
    poseFails: 0,
    driveAt: 0, // when driveTick last ran
    prevHdg: null,
    prevHdgAt: 0,
    measuredYaw: null,
    wantRun: false,
    settleStart: 0,
    brakeAsked: false,
    moved: false, // the tug has moved the aircraft since it was called: it is not let go until an engine is started
    gateLeft: null // PS.gate.detect() when the push started: the gate Return to gate has to get back to
  };
  var timer = null;
  try {
    var sp = Number(window.localStorage.getItem(SPEED_KEY));
    if (sp >= 10 && sp <= 100) S.speedPercent = sp;
  } catch (e0) {
    /* storage may be unavailable */
  }

  function log(msg) {
    PS.log('push', msg);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function approach(cur, target, maxStep) {
    return cur < target ? Math.min(target, cur + maxStep) : Math.max(target, cur - maxStep);
  }
  function cruiseUnits() {
    return clamp(Math.round((S.speedPercent / 100) * 50), 5, 50);
  } // the original's speed factor: 5 to 50, one unit = 0.2 ft/s
  function readPose() {
    var la = PS.getVar('PLANE LATITUDE', 'degrees'),
      lo = PS.getVar('PLANE LONGITUDE', 'degrees'),
      hd = PS.getVar('PLANE HEADING DEGREES TRUE', 'degrees');
    if (!la.ok || !lo.ok || !hd.ok) return null;
    // a number, and not NaN or infinite (NaN is typeof 'number', and would run on into every write)
    function num(v) {
      return typeof v === 'number' && isFinite(v);
    }
    if (!num(la.value) || !num(lo.value) || !num(hd.value)) return null;
    return { lat: la.value, lon: lo.value, hdgDeg: hd.value };
  }
  function onGround() {
    var g = PS.getVar('SIM ON GROUND', 'bool'),
      a = PS.getVar('PLANE ALT ABOVE GROUND', 'feet');
    return { ok: g.ok, ground: g.ok && Number(g.value) > 0, agl: a.ok ? a.value : null };
  }

  var ACTIVE = { attaching: 1, waitBrake: 1, settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 };
  var wasActive = false;
  function setStatus(st, why) {
    if (S.status !== st || S.reason !== (why || '')) log('status: ' + st + (why ? ' (' + why + ')' : ''));
    S.status = st;
    S.reason = why || '';
    ensureLoop();
    updateToasts(true);
  }
  // The tick loop runs while a push is active (restarted fresh each time one becomes active) and, slowly, while the tug is simply on; it is
  // stopped when nothing is going on, so a finished or dismissed push leaves no timer behind.
  // For tests that swap the clock: forget the timer, which belonged to the old one.
  function forgetLoop() {
    timer = null;
    wasActive = false;
    S.returnPlan = null;
    S.isReturn = false;
  }
  function ensureLoop() {
    var active = !!ACTIVE[S.status],
      wanted = active || S.status === 'ready' || S.moved; // (after a push the loop keeps watching the engines until the tug goes)
    if (!wanted) {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      wasActive = false;
      return;
    }
    if (timer === null || (active && !wasActive)) {
      if (timer !== null) clearInterval(timer);
      S.lastTick = Date.now();
      timer = setInterval(tick, TICK_MS);
    }
    wasActive = active;
  }

  // ---------------- toasts: the progress popup (distance left, Pause/Resume, Stop) and the brake prompt ----------------
  var finishToastShown = false;
  function remainingText() {
    var l = S.last,
      leg = S.follower ? S.follower.legs[Math.min(l.leg, S.follower.legs.length - 1)] : null;
    return (
      PS.fmt.dist(l.remainingM) +
      ' left' +
      (S.follower && l.legCount > 1 ? ', leg ' + (l.leg + 1) + ' of ' + l.legCount : '') +
      (leg ? (leg.sign < 0 ? ', pushing back' : ', driving forward') : '')
    );
  }
  function updateToasts(force) {
    var running = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 };
    if (running[S.status]) {
      var paused = S.status === 'paused' || (S.status === 'stopping' && S.stopNext === 'paused');
      PS.toasts.show({
        efbOnly: true,
        id: 'push',
        kind: S.status === 'brakeHold' ? 'brake' : 'info',
        persistent: true,
        title: 'Pushback' + (paused ? ' (paused)' : S.status === 'brakeHold' ? ' (brake set)' : ''),
        message:
          S.status === 'brakeHold'
            ? 'The parking brake was set. Release it and the push carries on. ' + remainingText()
            : S.status === 'settling'
              ? 'Starting...'
              : remainingText(),
        actions: [
          {
            label: paused ? 'Resume' : 'Pause',
            onClick: function () {
              if (paused) resume();
              else pause();
            }
          },
          {
            label: 'Stop',
            onClick: function () {
              stop('stopped by you');
            }
          }
        ]
      });
    } else {
      PS.toasts.dismiss('push');
    }
    if (S.status === 'waitBrake') {
      PS.toasts.show({
        efbOnly: true,
        id: 'push-brake',
        kind: 'brake',
        persistent: true,
        title: 'Release the parking brake',
        message: 'The push starts as soon as the brake is off.',
        actions: [
          {
            label: 'Release it for me',
            onClick: function () {
              releaseBrake();
            }
          },
          {
            label: 'Cancel',
            onClick: function () {
              stop('cancelled by you');
            }
          }
        ]
      });
    } else if (S.status !== 'brakeHold') {
      PS.toasts.dismiss('push-brake');
    }
    if (S.status === 'done') {
      if (!finishToastShown) {
        finishToastShown = true;
        PS.toasts.show({
          efbOnly: true,
          id: 'push-done',
          kind: 'info',
          persistent: true,
          title: 'Push finished',
          message: 'Finish sets the parking brake and dismisses the tug (after a good engine start).',
          actions: [
            {
              label: 'Set the brake',
              onClick: function () {
                setBrake();
              }
            }
          ]
            .concat(
              S.returnPlan
                ? [
                    {
                      label: 'Return to gate',
                      onClick: function () {
                        PS.toasts.dismiss('push-done');
                        requestStart({ returnToGate: true });
                      }
                    }
                  ]
                : []
            )
            .concat([
              {
                label: 'Dismiss tug',
                onClick: function () {
                  dismissTug();
                  PS.toasts.dismiss('push-done');
                }
              },
              {
                label: 'x',
                onClick: function () {
                  PS.toasts.dismiss('push-done');
                }
              }
            ])
        });
      }
    } else {
      finishToastShown = false;
      if (S.status !== 'done') PS.toasts.dismiss('push-done');
    }
  }

  // ---------------- brake ----------------
  function releaseBrake() {
    log('releasing the parking brake');
    PS.brake.release(function (r) {
      log('parking brake release: ' + (r.ok ? 'done, ' : 'FAILED, ') + r.how);
      S.brake = PS.brake.read(true);
    });
  }
  function setBrake() {
    log('setting the parking brake');
    PS.brake.set(function (r) {
      log('parking brake set: ' + (r.ok ? 'done, ' : 'FAILED, ') + r.how);
      S.brake = PS.brake.read(true);
    });
  }

  // ---------------- control ----------------
  // The big button on the Push tab is Finish push when the push is over and nothing new is planned (the pins are deleted when a push finishes), and
  // Start push as soon as there are pins again, so adjusting or planning another push after one has finished is never a dead end.
  function finishMode(status, pins) {
    return (status === 'done' || status === 'ready') && pins === 0;
  }
  function canStart(isReturn) {
    if (!isReturn && PS.plan.count() === 0) return { ok: false, why: 'There is no plan yet: make one on the Plan tab.' };
    if ({ settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1, waitBrake: 1, attaching: 1 }[S.status])
      return { ok: false, why: 'A push is already under way.' };
    var g = onGround();
    if (g.ok && (!g.ground || (typeof g.agl === 'number' && g.agl > AGL_ABORT_FT)))
      return { ok: false, why: 'The aircraft is not on the ground.' };
    return { ok: true, why: '' };
  }

  // The way back to the gate: the push retraced, each leg turned round and the order reversed. There is no choosing in it. Only a push that planned
  // without a warning gets one, so the retrace is known to be drivable.
  function returnPlanFrom(segs, reverse) {
    var list = reverse
      ? segs
          .slice()
          .reverse()
          .map(function (sg) {
            return { sign: -sg.sign, points: sg.points.slice().reverse(), radiusM: sg.radiusM, lengthM: sg.lengthM };
          })
      : segs;
    var total = 0;
    var legs = list.map(function (sg) {
      var pts = sg.points,
        a = pts[pts.length - 2],
        b = pts[pts.length - 1],
        travel = PS.geo.bearingDeg(a[0], a[1], b[0], b[1]);
      total += sg.lengthM;
      return { sign: sg.sign, lengthM: sg.lengthM, endHdgDeg: PS.geo.normDeg(sg.sign < 0 ? travel + 180 : travel), warning: null };
    });
    return {
      empty: false,
      segments: list,
      legs: legs,
      items: [],
      waypoints: [],
      warnings: [],
      totalM: total,
      radiusM: S.plan ? S.plan.radiusM : PS.plan.turn().radiusM,
      turnaroundAdded: false,
      adapted: false
    };
  }
  // After a push ends, finishes or is stopped: what a return to the gate would be. A push gets the way back over the ground it covered, if that
  // part planned without a warning; a stopped return keeps what is left of the way back. A push that went nowhere changes nothing.
  function updateReturn() {
    if (!S.follower) return;
    if (S.isReturn) {
      var rest = S.follower.ahead();
      if (!rest.length) {
        S.returnPlan = null;
        return;
      }
      var moved = S.follower.travelled().reduce(function (a, sg) {
        return a + sg.lengthM;
      }, 0);
      if (moved >= RETURN_MIN_M) S.returnPlan = returnPlanFrom(rest, false);
      return;
    }
    var done = S.follower.travelled(),
      dist = done.reduce(function (a, sg) {
        return a + sg.lengthM;
      }, 0);
    if (dist < RETURN_MIN_M) return;
    var bad = done.filter(function (sg) {
      return S.plan && S.plan.legs[sg.index] && S.plan.legs[sg.index].warning;
    });
    if (bad.length) {
      S.returnPlan = null;
      log('no return to the gate: the part driven had a warning');
      return;
    }
    S.returnPlan = returnPlanFrom(done, true);
    log('a return to the gate is available (' + PS.fmt.dist(S.returnPlan.totalM) + ')');
  }
  // Returning needs the aircraft to be where the push left it (near the start of the way back), and the usual conditions of any push.
  function canReturn() {
    if (!S.returnPlan) return { ok: false, why: 'There is no push to return from.' };
    if (ACTIVE[S.status]) return { ok: false, why: 'A push is already under way.' };
    var g = onGround();
    if (g.ok && (!g.ground || (typeof g.agl === 'number' && g.agl > AGL_ABORT_FT)))
      return { ok: false, why: 'The aircraft is not on the ground.' };
    var pose = readPose();
    if (!pose) return { ok: false, why: 'The aircraft position cannot be read.' };
    var p0 = S.returnPlan.segments[0].points[0],
      d = PS.geo.distanceM(pose.lat, pose.lon, p0[0], p0[1]);
    if (d > RETURN_NEAR_M) return { ok: false, why: 'The aircraft has moved ' + Math.round(d) + ' m from where the push ended.' };
    // With stand data the push has to have started at a gate: a retrace of a push from anywhere else does not lead to one.
    if (S.gateLeft && S.gateLeft.known && !S.gateLeft.at)
      return {
        ok: false,
        why: 'The push did not start at a gate (' + PS.gate.describe(S.gateLeft) + '), so there is no gate to go back to.'
      };
    return { ok: true, why: '' };
  }

  // Start: attach the tug if it is not on, wait for the parking brake to be off, settle, then drive the plan.
  function requestStart(opts) {
    var isReturn = !!(opts && opts.returnToGate);
    var c = isReturn ? canReturn() : canStart(false);
    if (!c.ok) {
      S.reason = c.why;
      log('cannot start: ' + c.why);
      return false;
    }
    S.wantRun = true;
    S.brakeAsked = false;
    var pose = readPose();
    if (!pose) {
      S.reason = 'The aircraft position cannot be read.';
      log('cannot start: ' + S.reason);
      return false;
    }
    if (!isReturn) PS.plan.dropFarPins(pose); // pins left at another airport: no route from here
    var plan = isReturn ? S.returnPlan : PS.plan.evaluate(pose); // planned again from where the aircraft is now (a return to the gate retraces the push)
    if (plan.empty || !plan.segments.length) {
      S.reason = 'The plan has no route from here.';
      log('cannot start: ' + S.reason);
      return false; // nothing has been changed: a stored Return to gate plan is still there
    }
    S.isReturn = isReturn;
    if (!isReturn) {
      S.returnPlan = null;
      S.gateLeft = PS.gate.detect();
      log('push starts: ' + PS.gate.describe(S.gateLeft));
    }
    S.plan = plan;
    S.totalM = plan.totalM;
    S.runLimitMs = runLimitMs(plan.totalM);
    try {
      PS.probe.run('push start');
    } catch (e) {
      log('probe failed: ' + PS.errText(e));
    }
    var info = PS.aircraftInfo(),
      prof = PS.profiles.find(info),
      mine = PS.learned.get(info),
      pivot = mine ? mine.pivotM : prof ? prof.pivotM : 0;
    S.profile = prof;
    S.info = info;
    log(
      'pivot starts at ' +
        PS.fmt.num(pivot, 1) +
        ' m (' +
        (mine
          ? 'learned here over ' + mine.pushes + ' push(es)'
          : prof
            ? 'the ' + prof.name + ' profile'
            : 'no profile: learned while driving') +
        ')' +
        (prof ? ', yaw gain ' + prof.yawGain : '')
    );
    S.follower = PS.follow.create(PS.follow.legsFromPlan(plan), {
      cruiseUnits: cruiseUnits(),
      pivotM: pivot,
      yawGain: prof ? prof.yawGain : 0
    });
    S.startedAt = 0;
    S.cur = { speed: 0, yaw: 0 };
    S.writes = 0;
    S.failures = 0;
    S.lastError = '';
    S.measuredYaw = null;
    S.prevHdg = null;
    S.last = {
      remainingM: plan.totalM,
      leg: 0,
      legCount: plan.legs.length,
      phase: 'run',
      cte: 0,
      alphaDeg: 0,
      speedFtS: 0,
      yawDegS: 0,
      note: '',
      why: ''
    };
    log(
      (isReturn ? 'return to gate requested: ' : 'push requested: ') +
        PS.fmt.dist(plan.totalM) +
        ' in ' +
        plan.legs.length +
        ' leg(s), turn radius ' +
        Math.round(plan.radiusM) +
        ' m, cruise speed factor ' +
        cruiseUnits() +
        ' (' +
        S.speedPercent +
        '%)' +
        (plan.warnings.length ? ', WITH WARNINGS: ' + plan.warnings.join(' | ') : '')
    );
    if (!PS.tug.isAttached()) {
      setStatus('attaching', 'calling the tug');
      PS.tug.attach(function (r) {
        if (!S.wantRun) return;
        if (!r.ok) {
          S.wantRun = false;
          setStatus('idle', r.error);
          return;
        }
        beginBrakeCheck();
      });
    } else beginBrakeCheck();
    return true;
  }
  function beginBrakeCheck() {
    S.brake = PS.brake.read(true);
    if (S.brake.set) {
      setStatus('waitBrake', 'the parking brake is set');
      // Start does the rest itself: release the brake (once; if the pilot releases it first, that is just as good).
      if (!S.brakeAsked) {
        S.brakeAsked = true;
        log('releasing the parking brake for you');
        releaseBrake();
      }
    } else beginSettling();
  }
  function beginSettling() {
    S.settleStart = Date.now();
    setStatus('settling', 'tug attached');
  }
  function beginDriving() {
    S.moved = true;
    S.startedAt = Date.now();
    S.cur = { speed: 0, yaw: 0 };
    S.poseFails = 0;
    S.lastLog = 0;
    setStatus('driving', '');
  }

  // Ease speed and turn to zero while still writing every tick (velocity is not sticky), then hold; `next` is where it goes afterwards.
  function beginStopping(reason, next) {
    if (S.follower && S.status === 'driving') {
      var learnedM = S.follower.state.pivotM,
        enough = S.follower.state.pvDen >= PS.follow.K.PIVOT_MIN_EVIDENCE; // turned enough this push to have measured it
      log(
        'pivot at the end of this drive: ' +
          PS.fmt.num(learnedM, 1) +
          ' m' +
          (enough ? ', kept for this aircraft' : ', too little turning to keep')
      );
      if (enough) PS.learned.save(S.info, learnedM);
    }
    S.stopNext = next || 'ready';
    S.stopQuietSince = 0;
    setStatus('stopping', reason || '');
  }
  function pause() {
    if (S.status === 'driving') {
      log('pause pressed');
      beginStopping('paused', 'paused');
    }
  }
  function resume() {
    if (S.status === 'paused' || (S.status === 'stopping' && S.stopNext === 'paused')) {
      log('resume pressed');
      S.stopNext = 'driving';
      if (S.status === 'paused') setStatus('driving', '');
      else updateToasts(true);
    }
  }
  function stop(why) {
    S.wantRun = false;
    if (S.status === 'driving' || S.status === 'paused' || S.status === 'brakeHold') {
      log('stop: ' + why);
      beginStopping(why, 'ready');
    } else if (S.status === 'stopping') {
      S.stopNext = 'ready';
    } else if (S.status === 'waitBrake' || S.status === 'settling' || S.status === 'attaching') {
      PS.tug.cancelAttach();
      setStatus(PS.tug.isAttached() ? 'ready' : 'idle', why);
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
    updateReturn();
    setStatus(PS.tug.isAttached() ? 'ready' : 'idle', why);
  }

  // A tug operator does not unhook until an engine is running well. Applies once the tug has moved the aircraft, unless switched off in Settings or the
  // aircraft's engines cannot be read.
  function engineGate() {
    if (!S.moved || !PS.settings.get('requireEngines')) return { ok: true, why: '' };
    // Back at a gate (a return to the gate, or just parked on a stand) the tug can come off whatever the engines are doing.
    var gd = PS.gate.detect();
    if (gd.known && gd.at) return { ok: true, why: '' };
    var e = PS.engines.status();
    if (!e.known || e.ok) return { ok: true, why: '' };
    return { ok: false, why: 'The tug stays on until an engine has started well. ' + e.text + '.' };
  }
  function toggleTug() {
    if (PS.tug.isAttached()) {
      var eg = engineGate();
      if (!eg.ok) {
        log('tug not dismissed: ' + eg.why);
        return;
      }
      emergencyStop('dismissing the tug');
      dismissTug();
    } else if (S.status === 'idle' || S.status === 'ready' || S.status === 'done') {
      setStatus('attaching', 'calling the tug');
      PS.tug.attach(function (r) {
        setStatus(r.ok ? 'ready' : 'idle', r.ok ? 'tug attached' : r.error);
        S.attached = PS.tug.isAttached();
        if (r.ok) S.brake = PS.brake.read(true);
      });
    }
  }
  function dismissTug() {
    PS.tug.detach();
    S.moved = false;
    setStatus('idle', 'tug dismissed');
  }
  // The brake toggle on the Push tab (a lesser option: Start and Finish do this themselves).
  function toggleBrake() {
    if (ACTIVE[S.status] && S.status !== 'waitBrake' && S.status !== 'brakeHold') return;
    S.brake = PS.brake.read(true);
    if (S.brake.set) releaseBrake();
    else setBrake();
  }
  // Finish: set the parking brake if it is not set and dismiss the tug if it is on. Whatever the pilot already did by hand is skipped, so doing
  // either first never leaves the other undone.
  function canFinish() {
    if (!{ idle: 1, ready: 1, done: 1 }[S.status]) return false;
    var b = PS.brake.read(false);
    if (PS.tug.isAttached()) return engineGate().ok; // the tug comes off (after the brake goes on), but only after a good engine start
    return b.ok && !b.set;
  }
  function finishPush() {
    if (!canFinish()) return false;
    PS.toasts.dismiss('push-done');
    function dismiss() {
      if (PS.tug.isAttached()) {
        log('finish: dismissing the tug');
        dismissTug();
      } else log('finish: the tug was already dismissed');
    }
    var b = PS.brake.read(true);
    S.brake = b;
    if (b.ok && !b.set) {
      log('finish: setting the parking brake, then dismissing the tug');
      PS.brake.set(function (r) {
        log('finish: parking brake ' + (r.ok ? 'set (' + r.how + ')' : 'would not set: ' + r.how));
        S.brake = PS.brake.read(true);
        dismiss();
      });
    } else {
      log('finish: the parking brake was already set');
      dismiss();
    }
    return true;
  }

  // ---------------- the loop ----------------
  function slowChecks(now) {
    S.attached = PS.tug.isAttached();
    if (!S.attached && S.moved && S.status !== 'attaching') S.moved = false; // the tug is gone: stop watching the engines for it
    if (S.attached || S.moved) PS.engines.update(false);
    var live = { settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 }[S.status];
    if (live && !S.attached) {
      emergencyStop('the sim detached the tug');
      return;
    }
    if (S.status === 'ready' && !S.attached) {
      setStatus('idle', 'the tug is no longer attached');
      return;
    }
    if (live && S.startedAt && now - S.startedAt > S.runLimitMs) {
      emergencyStop('the push has run for ' + Math.round(S.runLimitMs / 60000) + ' minutes');
      return;
    }
    // The brake, read every half second while it matters.
    if (now - S.lastBrakeCheck >= 500 && (live || S.status === 'ready' || S.status === 'waitBrake')) {
      S.lastBrakeCheck = now;
      S.brake = PS.brake.read(false);
      if (S.status === 'driving' && S.brake.set) {
        log('the parking brake was set during the push');
        beginStopping('the parking brake was set', 'brakeHold');
      }
    }
    if (S.status === 'driving' || S.status === 'stopping') {
      var g = onGround();
      if (g.ok && (!g.ground || (typeof g.agl === 'number' && g.agl > AGL_ABORT_FT))) emergencyStop('the aircraft left the ground');
    }
    updateToasts(false);
  }

  function tick() {
    var now = Date.now(),
      gapMs = now - S.lastTick,
      dt = clamp(gapMs / 1000, 0.01, 0.12);
    // The timer stalled (the sim throttled a background app): the tug was left on its last speed command, so stop rather than carry on blind.
    if (gapMs > STALL_MS && (S.status === 'driving' || S.status === 'settling' || S.status === 'stopping')) {
      S.lastTick = now;
      emergencyStop("the app's timer stalled for " + Math.round(gapMs) + ' ms');
      return;
    }
    S.lastTick = now;
    if (now - S.lastSlow >= 250) {
      S.lastSlow = now;
      slowChecks(now);
    }
    switch (S.status) {
      case 'waitBrake':
        if (now - S.lastBrakeCheck < 400) break;
        S.lastBrakeCheck = now;
        S.brake = PS.brake.read(false);
        if (!S.brake.set) {
          log('the parking brake is off');
          beginSettling();
        }
        break;
      case 'settling':
        if (PS.tug.attachedMs() >= SETTLE_MS && now - S.settleStart >= 1000) beginDriving();
        break;
      case 'driving':
        driveTick(now, dt);
        break;
      case 'stopping':
        stopTick(now, dt);
        break;
      case 'brakeHold':
        PS.tug.zeroAndHold();
        if (S.brake && !S.brake.set) {
          log('the parking brake is off again: carrying on');
          S.cur = { speed: 0, yaw: 0 };
          setStatus('driving', '');
        }
        break;
      case 'paused':
        PS.tug.zeroAndHold();
        break;
      default:
        break;
    }
  }

  function driveTick(now, dt) {
    var pose = readPose();
    if (!pose) {
      S.poseFails++;
      if (S.poseFails > 20) emergencyStop('the aircraft position cannot be read');
      return;
    }
    S.poseFails = 0;
    if (now - S.driveAt > 1000) S.follower.rearm(); // coming back from a pause or a brake hold
    S.driveAt = now;
    pose.t = (now - S.startedAt) / 1000;
    var out = S.follower.update(pose, dt, S.cur.speed);
    S.last = {
      remainingM: out.remainingM,
      leg: out.leg,
      legCount: out.legCount,
      phase: out.phase,
      cte: out.cte,
      alphaDeg: out.alphaDeg,
      speedFtS: out.speedFtS,
      yawDegS: out.yawDegS,
      note: out.note,
      why: out.why
    };
    if (out.stop) {
      log('stopping: ' + out.stop);
      S.wantRun = false;
      beginStopping(out.stop, 'ready');
      return;
    }
    if (out.done) {
      log('route finished');
      beginStopping('', 'done');
      return;
    }
    S.cur.speed = approach(S.cur.speed, out.speedFtS, SPEED_RAMP * dt);
    S.cur.yaw = approach(S.cur.yaw, out.yawDegS, (Math.abs(out.yawDegS) < Math.abs(S.cur.yaw) ? YAW_RAMP_DOWN : YAW_RAMP) * dt);
    var w = PS.tug.write(S.cur.speed, S.cur.yaw);
    S.writes++;
    if (!w.ok) {
      S.failures++;
      S.lastError = w.error;
    }
    if (PS.setFailRun >= 40) {
      emergencyStop('the sim is refusing the tug commands (' + PS.setFailRun + ' failed writes in a row)'); // about 2 s of ticks
      return;
    }
    // measured nose turn rate and a log line each second, for tuning against the sim
    if (S.prevHdg !== null && now - S.prevHdgAt >= 1000) {
      S.measuredYaw = PS.geo.angleDiff(S.prevHdg, pose.hdgDeg) / ((now - S.prevHdgAt) / 1000);
      S.prevHdg = pose.hdgDeg;
      S.prevHdgAt = now;
    } else if (S.prevHdg === null) {
      S.prevHdg = pose.hdgDeg;
      S.prevHdgAt = now;
    }
    if (now - S.lastLog >= 1000) {
      S.lastLog = now;
      var gs = PS.getVar('GROUND VELOCITY', 'knots'),
        vz = PS.getVar('VELOCITY BODY Z', 'feet per second');
      PS.logv(
        'push',
        'drive t=' +
          PS.fmt.num(pose.t, 0) +
          's ' +
          out.phase +
          ' leg ' +
          (out.leg + 1) +
          '/' +
          out.legCount +
          ' left ' +
          PS.fmt.num(out.remainingM, 1) +
          ' m | speed target ' +
          PS.fmt.num(out.speedFtS, 2) +
          ' ramped ' +
          PS.fmt.num(S.cur.speed, 2) +
          ' read ' +
          PS.fmt.num(vz.value, 2) +
          ' ft/s, GS ' +
          PS.fmt.num(gs.value, 2) +
          ' kt | yaw target ' +
          PS.fmt.num(out.yawDegS, 2) +
          ' ramped ' +
          PS.fmt.num(S.cur.yaw, 2) +
          ' measured ' +
          PS.fmt.num(S.measuredYaw, 2) +
          ' deg/s | off path ' +
          PS.fmt.num(out.cte, 2) +
          ' m, aim ' +
          PS.fmt.num(out.alphaDeg, 1) +
          ' deg, heading ' +
          PS.fmt.num(pose.hdgDeg, 1) +
          ', pivot ' +
          PS.fmt.num(out.pivotM, 1) +
          ' m' +
          ' | writes ' +
          S.writes +
          ' failed ' +
          S.failures +
          (out.note ? ' | ' + out.note : '')
      );
    }
  }

  function stopTick(now, dt) {
    S.cur.speed = approach(S.cur.speed, 0, SPEED_RAMP * dt);
    S.cur.yaw = approach(S.cur.yaw, 0, YAW_RAMP_DOWN * dt);
    var w = PS.tug.write(S.cur.speed, S.cur.yaw);
    S.writes++;
    if (!w.ok) {
      S.failures++;
      S.lastError = w.error;
    }
    if (S.cur.speed === 0 && S.cur.yaw === 0) {
      if (!S.stopQuietSince) S.stopQuietSince = now;
      if (now - S.stopQuietSince >= 600) {
        PS.tug.zeroAndHold();
        var next = S.stopNext;
        if (next === 'driving') {
          setStatus('driving', '');
          return;
        }
        if (next === 'done') {
          S.last.remainingM = 0;
          var doneText = 'the route is finished';
          if (S.isReturn) {
            S.returnPlan = null;
            var gd = PS.gate.detect(),
              left = S.gateLeft;
            if (gd.known && gd.at && (!left || !left.known || left.name === gd.name)) {
              doneText = 'back at gate ' + gd.name;
              S.moved = false;
            } else if (gd.known) {
              doneText =
                'back where the push started, but ' +
                PS.gate.describe(gd) +
                (left && left.known && left.name ? ' (it left gate ' + left.name + ')' : '');
            } else {
              doneText = 'back where the push started';
              S.moved = false;
            } // no stand data to check against: trust the retrace
            log('return finished: ' + doneText);
          } else updateReturn();
          if (PS.plan.count()) {
            PS.plan.clear();
            log('the push is finished: the pins were deleted');
          }
          setStatus('done', doneText);
          return;
        }
        if (next === 'ready') updateReturn();
        setStatus(
          next,
          next === 'paused' ? 'held still' : next === 'brakeHold' ? 'waiting for the parking brake to be released' : S.reason
        );
      }
    } else S.stopQuietSince = 0;
  }

  // Leaving for another EFB app only pauses this one: its timers keep running (measured in the sim), so a push carries on. Closing it stops the push.
  PS.closeHooks.push(function (why) {
    if (why === 'app paused') {
      if (S.status === 'driving') log('the app is in the background: the push carries on');
      return;
    }
    emergencyStop('the app was ' + (why || 'closed'));
  });

  // What the Push tab shows.
  function view() {
    var l = S.last,
      leg = S.follower ? S.follower.legs[Math.min(l.leg, S.follower.legs.length - 1)] : null;
    return {
      status: S.status,
      reason: S.reason,
      attached: S.attached,
      brake: S.brake,
      plan: S.plan,
      totalM: S.totalM,
      runLimitMs: S.runLimitMs,
      speedPercent: S.speedPercent,
      cruiseUnits: cruiseUnits(),
      remainingM: l.remainingM,
      leg: l.leg,
      legCount: l.legCount,
      phase: l.phase,
      cte: l.cte,
      alphaDeg: l.alphaDeg,
      speedFtS: S.cur.speed,
      yawDegS: S.cur.yaw,
      measuredYaw: S.measuredYaw,
      direction: leg ? (leg.sign < 0 ? 'push back' : 'drive forward') : '',
      elapsedS:
        S.startedAt && (S.status === 'driving' || S.status === 'stopping' || S.status === 'paused' || S.status === 'brakeHold')
          ? (Date.now() - S.startedAt) / 1000
          : 0,
      writes: S.writes,
      failures: S.failures,
      lastError: S.lastError,
      note: l.note,
      why: l.why || '',
      isReturn: !!S.isReturn,
      canFinish: canFinish(),
      engines: PS.engines.status(),
      engineGate: engineGate(),
      gate: PS.gate.detect(),
      gateLeft: S.gateLeft,
      canReturn: canReturn(),
      returnM: S.returnPlan ? S.returnPlan.totalM : 0,
      progress: S.totalM > 0 ? clamp(1 - l.remainingM / S.totalM, 0, 1) : 0
    };
  }

  function setSpeedPercent(p) {
    S.speedPercent = clamp(Math.round(p), 10, 100);
    try {
      window.localStorage.setItem(SPEED_KEY, String(S.speedPercent));
    } catch (e1) {
      /* not saved */
    }
    log('cruise speed set to ' + S.speedPercent + '% (speed factor ' + cruiseUnits() + ')');
    if (S.follower && S.follower.setCruise) S.follower.setCruise(cruiseUnits());
  }

  // Look at the tug once when the app starts, so the tab opens showing the truth.
  S.attached = PS.tug.isAttached();
  if (S.attached) {
    S.status = 'ready';
    S.reason = 'the tug is already attached';
    ensureLoop();
  }

  return {
    view: view,
    isActive: function () {
      return !!ACTIVE[S.status];
    },
    finishMode: finishMode,
    canStart: canStart,
    canReturn: canReturn,
    requestStart: requestStart,
    pause: pause,
    resume: resume,
    stop: stop,
    emergencyStop: emergencyStop,
    toggleTug: toggleTug,
    dismissTug: dismissTug,
    toggleBrake: toggleBrake,
    finish: finishPush,
    releaseBrake: releaseBrake,
    setBrake: setBrake,
    setSpeedPercent: setSpeedPercent,
    route: function () {
      return S.plan;
    },
    forgetLoop: forgetLoop
  };
})();
