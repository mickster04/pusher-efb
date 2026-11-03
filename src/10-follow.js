// Path follower: turns "where is the aircraft and which way does it point" into a speed and a turn rate that keep it on the planned route.
// Pure logic (no sim access), so it can be tested against a simulated tug. Based on the original bridge's pure-pursuit steering
// (bridge/PushbackController.cs, bridge/Constants.cs) but simpler: no learned yaw calibration yet, no straight-stretch slack, and the route is
// the planner's legs, each driven in one direction (forward or in reverse), with a stop and hold between legs (a cusp).
//
// Conventions (all from the original): angles clockwise-positive; a positive turn rate turns the nose to the right; the nose turns at
// (path curvature x ground speed) whether the tug goes forward or in reverse, because the aircraft's heading changes the same way
// either way; speed is signed (negative = reverse) in feet per second, as the sim wants it.

PS.follow = (function () {
  var G = PS.geo;
  var K = {
    LOOK_FWD: 10, LOOK_REV: 8, LOOK_SHARP_FWD: 8.5, LOOK_SHARP_REV: 7, MIN_LOOK: 4, MAX_LOOK: 12, OFF_PATH_LOOK: 7, OFF_PATH_LOOK_TRIGGER: 2.5,
    END_LOOK_MIN: 2.5, END_LOOK_FRACTION: 0.45, CURVE_AHEAD_SHARP_DEG: 30, AIM_MIN: 0.8, MAX_ALPHA_DEG: 90,
    ROT_PER_CURVATURE: 30.48,                   // rotation setting per 1/m: the tug's turn radius is 30.5 / rotation (the original's RotPerCurvature)
    ROT_LIMIT_FWD: 2.0, ROT_LIMIT_REV: 1.8, ROT_LIMIT_RECOVER_FWD: 2.4, ROT_LIMIT_RECOVER_REV: 2.2, END_ROT_LIMIT: 1.8, END_ROT_LIMIT_DIST: 12, RECOVER_OFF: 3.5,
    YAW_PER_ROT_PER_FTS: 0.002 * 5 * 180 / Math.PI / 1,  // degrees per second per rotation setting per ft/s: rot x 0.002 x (speed units = ft/s / 0.2) x 57.3
    YAW_GAIN: 0.77, YAW_DEADBAND_DEG_S: 0.30,   // the original's fit: the nose turns at gain x commanded - deadband (ground friction)
    SMOOTH_KEEP_AT_50MS: 0.78,                  // steering smoothing, about a 200 ms time constant
    UNITS_TO_FTS: 0.2,                          // one speed unit is 0.2 ft/s (the original's SpeedUnitToFtPerSec)
    MIN_AUTO_UNITS: 8, REVERSE_FRACTION: 0.75, CURVE_FWD_FRACTION: 0.6, CURVE_REV_FRACTION: 0.55, CURVE_SLOW_BEND_DEG: 20, CURVE_SLOW_WITHIN_M: 50,
    TURN_SLOW_FULL_ALPHA_DEG: 60, MIN_TURN_FRACTION: 0.5, OFF_PATH_FRACTION: 0.6, OFF_PATH_M: 5,
    END_BRAKE_START_M: 24, END_BRAKE_MIN_FRACTION: 0.18, END_CREEP_M: 3.5, END_CREEP_FRACTION: 0.1, END_DONE_M: 0.8,
    RADIUS_SLOW_REF_M: 40,                      // arcs planned tighter than this slow the tug in proportion (the plan may tighten a cramped corner)
    CUSP_STOP_FTS: 0.05, CUSP_STOP_SECONDS: 0.5, CUSP_HOLD_SECONDS: 1.0,
    LOST_CTE_M: 15, LOST_SECONDS: 3, STUCK_SECONDS: 8, STUCK_MIN_ADVANCE_M: 0.3
  };

  function wrap180(d) { return G.angleDiff(0, d); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function brgXY(ax, ay, bx, by) { return G.normDeg(G.deg(Math.atan2(bx - ax, by - ay))); }   // x east, y north: bearing clockwise from north

  // A leg's points in metres east and north of `origin`, with the distance along the path at each point.
  function buildPath(points, origin) {
    var xy = [], cum = [], total = 0;
    points.forEach(function (p) {
      var q = G.toXY(origin.lat, origin.lon, p[0], p[1]);
      if (xy.length) {
        var last = xy[xy.length - 1], d = Math.sqrt((q.x - last[0]) * (q.x - last[0]) + (q.y - last[1]) * (q.y - last[1]));
        if (d < 0.05) return;                    // the same point twice
        total += d;
      }
      xy.push([q.x, q.y]); cum.push(total);
    });
    return { xy: xy, cum: cum, total: total, origin: origin };
  }

  // Where on the path an (x, y) is: the closest point searched around the last one (so it cannot jump to another part of a looping path).
  function locate(path, x, y, hint) {
    var n = path.xy.length, best = null;
    if (n < 2) return { i: 0, s: 0, d: 0, cte: 0, tangent: 0 };
    var lo = Math.max(0, hint - 4), hi = Math.min(n - 2, hint + 24);
    for (var i = lo; i <= hi; i++) {
      var ax = path.xy[i][0], ay = path.xy[i][1], bx = path.xy[i + 1][0], by = path.xy[i + 1][1];
      var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      var t = l2 < 1e-9 ? 0 : clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
      var qx = ax + dx * t, qy = ay + dy * t, d = Math.sqrt((x - qx) * (x - qx) + (y - qy) * (y - qy));
      if (!best || d < best.d - 1e-9) {
        var len = Math.sqrt(l2);
        // Signed offset: positive when the point is to the left of the direction of the path.
        var cte = len > 1e-9 ? ((x - qx) * (-dy) + (y - qy) * dx) / len : 0;
        best = { i: i, s: path.cum[i] + t * len, d: d, cte: cte, tangent: brgXY(ax, ay, bx, by) };
      }
    }
    return best;
  }

  function pointAt(path, s) {
    var n = path.xy.length;
    if (s <= 0) return { x: path.xy[0][0], y: path.xy[0][1], i: 0, tangent: n > 1 ? brgXY(path.xy[0][0], path.xy[0][1], path.xy[1][0], path.xy[1][1]) : 0 };
    for (var i = 0; i + 1 < n; i++) {
      if (path.cum[i + 1] >= s) {
        var len = path.cum[i + 1] - path.cum[i], t = len > 1e-9 ? (s - path.cum[i]) / len : 0;
        return { x: path.xy[i][0] + (path.xy[i + 1][0] - path.xy[i][0]) * t, y: path.xy[i][1] + (path.xy[i + 1][1] - path.xy[i][1]) * t, i: i,
          tangent: brgXY(path.xy[i][0], path.xy[i][1], path.xy[i + 1][0], path.xy[i + 1][1]) };
      }
    }
    var e = path.xy[n - 1];
    return { x: e[0], y: e[1], i: n - 2, tangent: n > 1 ? brgXY(path.xy[n - 2][0], path.xy[n - 2][1], e[0], e[1]) : 0 };
  }

  // How much the path turns between s and s + ahead (degrees, absolute).
  function bendAhead(path, s, ahead) {
    var a = pointAt(path, s), b = pointAt(path, Math.min(path.total, s + ahead));
    return Math.abs(wrap180(b.tangent - a.tangent));
  }

  // segments: [{ sign (-1 reverse, +1 forward), points [[lat, lon], ...], radiusM? }] from the planner. settings: { cruiseUnits }.
  // Returns a follower; call update() every tick.
  function create(segments, settings) {
    settings = settings || {};
    var cruiseUnits = settings.cruiseUnits || 25;
    var legs = segments.map(function (sg) { return { sign: sg.sign < 0 ? -1 : 1, points: sg.points, radiusM: sg.radiusM || K.RADIUS_SLOW_REF_M }; });
    var origin = { lat: legs[0].points[0][0], lon: legs[0].points[0][1] };
    legs.forEach(function (l) { l.path = buildPath(l.points, origin); });
    var totalM = 0;
    legs.forEach(function (l) { totalM += l.path.total; });

    var st = { leg: 0, phase: 'run', hint: 0, s: 0, smoothYaw: 0, stopSince: null, holdSince: null, offSince: null, progressAt: null, progressS: 0, done: false };

    function remainingFrom(legIndex, s) {
      var r = Math.max(0, legs[legIndex].path.total - s);
      for (var i = legIndex + 1; i < legs.length; i++) r += legs[i].path.total;
      return r;
    }

    // pose: { lat, lon, hdgDeg }; dt in seconds; speedFtS: the aircraft's present signed speed (the ramped command or what was read back).
    // Returns { speedFtS (signed target), yawDegS (target nose turn rate, clockwise positive), phase, leg, legCount, remainingM, cte, alphaDeg,
    //           done, stop (a reason to stop, or ''), note }
    function update(pose, dt, speedFtS) {
      var out = { speedFtS: 0, yawDegS: 0, phase: st.phase, leg: st.leg, legCount: legs.length, remainingM: 0, cte: 0, alphaDeg: 0, done: st.done, stop: '', note: '' };
      if (st.done) { out.remainingM = 0; out.phase = 'finished'; return out; }
      var leg = legs[st.leg], path = leg.path, reverse = leg.sign < 0;
      var p = G.toXY(origin.lat, origin.lon, pose.lat, pose.lon);
      var loc = locate(path, p.x, p.y, st.hint);
      st.hint = loc.i;
      if (loc.s > st.s) st.s = loc.s;                       // progress only moves forward (a small step back from noise is ignored)
      var s = Math.max(st.s, loc.s - 2);
      var remaining = Math.max(0, path.total - s);
      out.remainingM = remainingFrom(st.leg, s); out.cte = loc.cte; out.leg = st.leg;
      var now = pose.t !== undefined ? pose.t : 0;

      // ---- between legs: brake to a stop, hold, then the next leg ----
      if (st.phase === 'cuspStop') {
        out.phase = 'cuspStop'; out.speedFtS = 0; out.yawDegS = 0; st.smoothYaw = 0;
        if (Math.abs(speedFtS) < K.CUSP_STOP_FTS) {
          if (st.stopSince === null) st.stopSince = now;
          if (now - st.stopSince >= K.CUSP_STOP_SECONDS) { st.phase = 'cuspHold'; st.holdSince = now; }
        } else st.stopSince = null;
        return out;
      }
      if (st.phase === 'cuspHold') {
        out.phase = 'cuspHold'; out.speedFtS = 0; out.yawDegS = 0;
        if (now - st.holdSince >= K.CUSP_HOLD_SECONDS) {
          st.leg++; st.phase = 'run'; st.hint = 0; st.s = 0; st.stopSince = null; st.progressAt = null; st.offSince = null;
          out.note = 'next leg: ' + (legs[st.leg].sign < 0 ? 'push back' : 'drive forward');
          out.phase = 'run'; out.leg = st.leg; out.remainingM = remainingFrom(st.leg, 0);
        }
        return out;
      }

      // ---- end of this leg ----
      if (remaining <= K.END_DONE_M) {
        if (st.leg >= legs.length - 1) { st.done = true; out.done = true; out.phase = 'finished'; out.remainingM = 0; return out; }
        st.phase = 'cuspStop'; st.stopSince = null; out.phase = 'cuspStop'; out.note = 'end of leg ' + (st.leg + 1) + ': stopping to change direction';
        return out;
      }

      // ---- steering: pure pursuit to a point a little way along the path ----
      var offPath = Math.abs(loc.cte);
      var sharp = bendAhead(path, s, 10) > K.CURVE_AHEAD_SHARP_DEG;
      var look = reverse ? (sharp ? K.LOOK_SHARP_REV : K.LOOK_REV) : (sharp ? K.LOOK_SHARP_FWD : K.LOOK_FWD);
      if (offPath > K.OFF_PATH_LOOK_TRIGGER) look = Math.min(look, K.OFF_PATH_LOOK);
      look = clamp(look, K.MIN_LOOK, K.MAX_LOOK);
      look = Math.min(look, Math.max(K.END_LOOK_MIN, K.END_LOOK_FRACTION * remaining));
      var aim = pointAt(path, Math.min(path.total, s + look));
      var aimDist = Math.sqrt((aim.x - p.x) * (aim.x - p.x) + (aim.y - p.y) * (aim.y - p.y));
      var travelHdg = reverse ? G.normDeg(pose.hdgDeg + 180) : pose.hdgDeg;
      var toAim = aimDist > K.AIM_MIN ? brgXY(p.x, p.y, aim.x, aim.y) : aim.tangent;
      var alpha = clamp(wrap180(toAim - travelHdg), -K.MAX_ALPHA_DEG, K.MAX_ALPHA_DEG);
      var kappa = 2 * Math.sin(G.rad(alpha)) / Math.max(aimDist, K.MIN_LOOK);     // 1/m, clockwise
      out.alphaDeg = alpha;

      // ---- speed ----
      var cruiseFts = cruiseUnits * K.UNITS_TO_FTS, minFts = K.MIN_AUTO_UNITS * K.UNITS_TO_FTS;
      var mag = cruiseFts * (reverse ? K.REVERSE_FRACTION : 1);
      var turnFactor = 1 - (1 - K.MIN_TURN_FRACTION) * clamp(Math.abs(alpha) / K.TURN_SLOW_FULL_ALPHA_DEG, 0, 1);
      mag = Math.max(minFts, mag * turnFactor);
      if (bendAhead(path, s, K.CURVE_SLOW_WITHIN_M) > K.CURVE_SLOW_BEND_DEG) mag = Math.max(minFts, Math.min(mag, cruiseFts * (reverse ? K.CURVE_REV_FRACTION : K.CURVE_FWD_FRACTION)));
      // An arc planned tighter than the usual radius is driven slower in proportion (the same yaw rate costs less lag at low speed).
      if (leg.radiusM < K.RADIUS_SLOW_REF_M - 0.5) mag = Math.max(minFts, mag * clamp(leg.radiusM / K.RADIUS_SLOW_REF_M, 0.5, 1));
      if (offPath > K.OFF_PATH_M) mag = Math.max(minFts, Math.min(mag, cruiseFts * K.OFF_PATH_FRACTION));
      // Braking onto the end of the leg.
      if (remaining < K.END_BRAKE_START_M) {
        var f = clamp((remaining - 4) / (K.END_BRAKE_START_M - 4), 0, 1);
        var endMag = cruiseFts * (K.END_BRAKE_MIN_FRACTION + (1 - K.END_BRAKE_MIN_FRACTION) * f);
        if (remaining < K.END_CREEP_M) endMag = Math.min(endMag, cruiseFts * K.END_CREEP_FRACTION);
        mag = Math.max(minFts * 0.6, Math.min(mag, endMag));
      }
      out.speedFtS = (reverse ? -1 : 1) * mag;

      // ---- turn rate: curvature x speed, within the steering limits, then the tug's measured response is allowed for ----
      var recovering = offPath > K.RECOVER_OFF;
      var rotLimit = recovering ? (reverse ? K.ROT_LIMIT_RECOVER_REV : K.ROT_LIMIT_RECOVER_FWD) : (reverse ? K.ROT_LIMIT_REV : K.ROT_LIMIT_FWD);
      if (st.leg === legs.length - 1 && remaining < K.END_ROT_LIMIT_DIST) rotLimit = Math.min(rotLimit, K.END_ROT_LIMIT);
      var v = Math.abs(speedFtS) > 0.05 ? Math.abs(speedFtS) : Math.abs(out.speedFtS);          // the speed it is really going (ramping up from rest uses the target)
      var wantYaw = kappa * v * 0.3048 * 180 / Math.PI;                                          // degrees per second the path needs
      var maxYaw = rotLimit * K.YAW_PER_ROT_PER_FTS * v;                                         // what the steering limit allows at this speed
      var limited = Math.abs(wantYaw) > maxYaw;
      var yaw = clamp(wantYaw, -maxYaw, maxYaw);
      // Feed forward: the nose turns at gain x commanded - deadband, so ask for more; the aim-point feedback trims what is left.
      var fade = Math.abs(yaw) < 1e-3 ? 0 : Math.tanh(Math.abs(yaw) / 0.6);
      var raw = (yaw + (yaw >= 0 ? 1 : -1) * K.YAW_DEADBAND_DEG_S * fade) / K.YAW_GAIN;
      raw = clamp(raw, -maxYaw / K.YAW_GAIN - 1, maxYaw / K.YAW_GAIN + 1);
      var keep = Math.pow(K.SMOOTH_KEEP_AT_50MS, dt / 0.05);
      st.smoothYaw = st.smoothYaw * keep + raw * (1 - keep);
      out.yawDegS = st.smoothYaw;
      if (limited) out.note = 'steering at its limit (the path needs a tighter turn than the tug can make at this speed)';

      // ---- watchdogs: lost the path, or not moving ----
      if (offPath > K.LOST_CTE_M) { if (st.offSince === null) st.offSince = now; if (now - st.offSince > K.LOST_SECONDS) out.stop = 'the tug is ' + Math.round(offPath) + ' m off the planned path'; } else st.offSince = null;
      if (st.progressAt === null) { st.progressAt = now; st.progressS = s; }
      else if (s - st.progressS > K.STUCK_MIN_ADVANCE_M) { st.progressAt = now; st.progressS = s; }
      else if (now - st.progressAt > K.STUCK_SECONDS && Math.abs(out.speedFtS) > 0.5) out.stop = 'the aircraft is not moving along the path (parking brake, or the tug is not driving it)';
      return out;
    }

    return { update: update, totalM: totalM, legCount: legs.length, state: st, legs: legs };
  }

  // The planner's evaluated plan (PS.plan.evaluate) as the legs the follower drives. The radius it was planned with goes with each leg.
  function legsFromPlan(plan) {
    return plan.segments.map(function (sg) { return { sign: sg.sign, points: sg.points, radiusM: plan.radiusM }; });
  }

  return { create: create, K: K, buildPath: buildPath, locate: locate, pointAt: pointAt, legsFromPlan: legsFromPlan };
})();
