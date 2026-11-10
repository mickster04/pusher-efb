// Derived in part from the original Pusher app (MIT, (c) Palm Coasty Simulations): see THIRD_PARTY_NOTICES.md.
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
    LOOK_FWD: 10,
    LOOK_REV: 8,
    LOOK_SHARP_FWD: 8.5,
    LOOK_SHARP_REV: 7,
    MIN_LOOK: 4,
    MAX_LOOK: 12,
    OFF_PATH_LOOK: 7,
    OFF_PATH_LOOK_TRIGGER: 2.5,
    END_LOOK_MIN: 2.5,
    END_LOOK_FRACTION: 0.45,
    CURVE_AHEAD_SHARP_DEG: 30,
    AIM_MIN: 0.8,
    MAX_ALPHA_DEG: 90,
    ROT_PER_CURVATURE: 30.48, // rotation setting per 1/m: the tug's turn radius is 30.5 / rotation (the original's RotPerCurvature)
    ROT_LIMIT_FWD: 2.0,
    ROT_LIMIT_REV: 1.8,
    ROT_LIMIT_RECOVER_FWD: 2.4,
    ROT_LIMIT_RECOVER_REV: 2.2,
    END_ROT_LIMIT: 1.8,
    END_ROT_LIMIT_DIST: 12,
    RECOVER_OFF: 3.5,
    YAW_PER_ROT_PER_FTS: (0.002 * 5 * 180) / Math.PI / 1, // degrees per second per rotation setting per ft/s: rot x 0.002 x (speed units = ft/s / 0.2) x 57.3
    YAW_GAIN: 2.3,
    YAW_DEADBAND_DEG_S: 0.3, // the nose turns at gain x commanded - deadband. Fitted to the first real pushes (Fenix A320 at NZCH): measured about 2.0 to 2.4 x the command (the original app's 0.77 did not hold)
    SMOOTH_KEEP_AT_50MS: 0.78, // steering smoothing, about a 200 ms time constant
    UNITS_TO_FTS: 0.2, // one speed unit is 0.2 ft/s (the original's SpeedUnitToFtPerSec)
    MIN_AUTO_UNITS: 8,
    REVERSE_FRACTION: 0.75,
    CURVE_FWD_FRACTION: 0.6,
    CURVE_REV_FRACTION: 0.55,
    CURVE_SLOW_BEND_DEG: 20,
    CURVE_SLOW_WITHIN_M: 50,
    TURN_SLOW_FULL_ALPHA_DEG: 60,
    MIN_TURN_FRACTION: 0.5,
    OFF_PATH_FRACTION: 0.6,
    OFF_PATH_M: 5,
    END_BRAKE_START_M: 24,
    END_BRAKE_MIN_FRACTION: 0.18,
    END_CREEP_M: 3.5,
    END_CREEP_FRACTION: 0.1,
    END_DONE_M: 1.5, // done within this much of the end: the plan's end point is a target, not a tolerance of centimetres
    PASS_END_M: 3, // a route that is still heading for another pin stops anyway when the aircraft is this near the END pin, facing the way it should
    PASS_END_HEADING_DEG: 8, // (within this of the planned end heading)
    PASS_END_MIN_DRIVEN_M: 5, // and has already driven this far, so a start beside the end pin is not an instant finish
    END_HEADING_SLACK_DEG: 3, // and a heading error this small at the end is left alone rather than steered out
    RADIUS_SLOW_REF_M: 40, // arcs planned tighter than this slow the tug in proportion (the plan may tighten a cramped corner)
    // Speed profile along a leg: a limit at each point from the path's curvature, then braking and acceleration passes so the tug is slowed in
    // time for a curve or the stop, and speeds up no faster than is comfortable. Curve speeds are the original's (0.6 and 0.55 of its default
    // cruise of 5 ft/s) and are kept in absolute terms, so a faster setting speeds up the straights without making curves faster than proven.
    CURVE_BASE_FWD_FTS: 3.0,
    CURVE_BASE_REV_FTS: 2.75,
    CURVE_REF_R_M: 40, // curve speed at a 40 m radius or wider; tighter radii are slower, to half at 20 m
    STRAIGHT_R_M: 200,
    CURVE_FULL_R_M: 60, // wider than 200 m counts as straight; tighter than 60 m gets the full curve speed
    DECEL_MS2: 0.35,
    ACCEL_MS2: 0.5, // comfortable braking and acceleration (m/s per second); the tug's own ramp (14 ft/s per s) is far quicker
    PROFILE_DS_M: 0.5,
    CURV_WINDOW_M: 10, // wide enough to span several of the planner's chords (about 3.5 m long on a 40 m arc), or the estimated radius flickers
    END_HOLD_M: 14,
    END_HOLD_FULL_M: 6,
    END_HOLD_LOOK_M: 14, // the last stretch steers to the END HEADING, not the path: a tug a metre off the line finishes a metre off, but facing right
    END_SPEED_BASE_FTS: 1.6,
    END_SPEED_SLOPE: 0.45, // top speed in the last metres: base + slope x metres to go (ft/s), so the nose is not swung at speed
    LOOK_FEATURE_M: 80,
    CUSP_STOP_FTS: 0.05,
    CUSP_STOP_SECONDS: 0.5,
    CUSP_HOLD_SECONDS: 1.0,
    LOST_CTE_M: 15,
    LOST_SECONDS: 3,
    STUCK_SECONDS: 8,
    STUCK_MIN_ADVANCE_M: 0.3,
    // The position the sim reports is not the point the aircraft turns about: on a big aircraft it is metres ahead of it (pivotM, signed, along the nose).
    // The path is followed by the pivot, or the reported position swings sideways every time the nose turns and the steering hunts (A330: 10 m).
    PIVOT_MIN_M: 0.5,
    PIVOT_MAX_M: 25,
    PIVOT_MIN_SPEED_FTS: 0.5,
    PIVOT_FORGET_S: 30,
    PIVOT_MIN_EVIDENCE: 5e-4, // sum of (turn in radians)^2 needed before the estimate is believed (a few seconds of turning)
    PIVOT_BLEND_PER_S: 0.4
  };

  function wrap180(d) {
    return G.angleDiff(0, d);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function brgXY(ax, ay, bx, by) {
    return G.normDeg(G.deg(Math.atan2(bx - ax, by - ay)));
  } // x east, y north: bearing clockwise from north

  // A leg's points in metres east and north of `origin`, with the distance along the path at each point.
  function buildPath(points, origin) {
    var xy = [],
      cum = [],
      total = 0;
    points.forEach(function (p) {
      var q = G.toXY(origin.lat, origin.lon, p[0], p[1]);
      if (xy.length) {
        var last = xy[xy.length - 1],
          d = Math.sqrt((q.x - last[0]) * (q.x - last[0]) + (q.y - last[1]) * (q.y - last[1]));
        if (d < 0.05) return; // the same point twice
        total += d;
      }
      xy.push([q.x, q.y]);
      cum.push(total);
    });
    return { xy: xy, cum: cum, total: total, origin: origin };
  }

  // The same path carried straight on past its end, for steering the pivot: when reversing the pivot is ahead of the reported position, so over the
  // last metres it is already beyond the path's end and would have no path to aim at (the aim angle pinned at 90 degrees, a hard swing at the finish).
  function extendEnd(path, m) {
    var n = path.xy.length;
    if (n < 2) return path;
    var a = path.xy[n - 2],
      b = path.xy[n - 1],
      d = Math.sqrt((b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]));
    if (d < 1e-6) return path;
    return {
      xy: path.xy.concat([[b[0] + ((b[0] - a[0]) / d) * m, b[1] + ((b[1] - a[1]) / d) * m]]),
      cum: path.cum.concat([path.total + m]),
      total: path.total + m,
      origin: path.origin
    };
  }

  // Where on the path an (x, y) is: the closest point searched around the last one (so it cannot jump to another part of a looping path).
  function locate(path, x, y, hint) {
    var n = path.xy.length,
      best = null;
    if (n < 2) return { i: 0, s: 0, d: 0, cte: 0, tangent: 0 };
    hint = clamp(hint, 0, n - 2); // a hint left over from a longer leg must not push the search past the end of this one (it found nothing and threw)
    var lo = Math.max(0, hint - 4),
      hi = Math.min(n - 2, hint + 24);
    for (var i = lo; i <= hi; i++) {
      var ax = path.xy[i][0],
        ay = path.xy[i][1],
        bx = path.xy[i + 1][0],
        by = path.xy[i + 1][1];
      var dx = bx - ax,
        dy = by - ay,
        l2 = dx * dx + dy * dy;
      var t = l2 < 1e-9 ? 0 : clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
      var qx = ax + dx * t,
        qy = ay + dy * t,
        d = Math.sqrt((x - qx) * (x - qx) + (y - qy) * (y - qy));
      if (!best || d < best.d - 1e-9) {
        var len = Math.sqrt(l2);
        // Signed offset: positive when the point is to the left of the direction of the path.
        var cte = len > 1e-9 ? ((x - qx) * -dy + (y - qy) * dx) / len : 0;
        best = { i: i, s: path.cum[i] + t * len, d: d, cte: cte, tangent: brgXY(ax, ay, bx, by) };
      }
    }
    return best;
  }

  function pointAt(path, s) {
    var n = path.xy.length;
    if (s <= 0)
      return {
        x: path.xy[0][0],
        y: path.xy[0][1],
        i: 0,
        tangent: n > 1 ? brgXY(path.xy[0][0], path.xy[0][1], path.xy[1][0], path.xy[1][1]) : 0
      };
    for (var i = 0; i + 1 < n; i++) {
      if (path.cum[i + 1] >= s) {
        var len = path.cum[i + 1] - path.cum[i],
          t = len > 1e-9 ? (s - path.cum[i]) / len : 0;
        return {
          x: path.xy[i][0] + (path.xy[i + 1][0] - path.xy[i][0]) * t,
          y: path.xy[i][1] + (path.xy[i + 1][1] - path.xy[i][1]) * t,
          i: i,
          tangent: brgXY(path.xy[i][0], path.xy[i][1], path.xy[i + 1][0], path.xy[i + 1][1])
        };
      }
    }
    var e = path.xy[n - 1];
    return { x: e[0], y: e[1], i: n - 2, tangent: n > 1 ? brgXY(path.xy[n - 2][0], path.xy[n - 2][1], e[0], e[1]) : 0 };
  }

  // How much the path turns between s and s + ahead (degrees, absolute).
  function bendAhead(path, s, ahead) {
    var a = pointAt(path, s),
      b = pointAt(path, Math.min(path.total, s + ahead));
    return Math.abs(wrap180(b.tangent - a.tangent));
  }

  // The speed (ft/s, magnitude) the tug should have at each half metre along a leg, and why. straightFts is the top speed on straights.
  function buildProfile(path, reverse, straightFts) {
    var ds = K.PROFILE_DS_M,
      total = path.total,
      n = Math.max(2, Math.ceil(total / ds) + 1),
      i;
    var straight = straightFts * (reverse ? K.REVERSE_FRACTION : 1),
      curveBase = reverse ? K.CURVE_BASE_REV_FTS : K.CURVE_BASE_FWD_FTS;
    var minF = K.MIN_AUTO_UNITS * K.UNITS_TO_FTS,
      cap = [],
      ccap = [],
      radius = [];
    for (i = 0; i < n; i++) {
      var s0 = Math.min(i * ds, total),
        sa = Math.max(0, s0 - K.CURV_WINDOW_M),
        sb = Math.min(total, s0 + K.CURV_WINDOW_M);
      var k = sb - sa > 0.5 ? G.rad(Math.abs(wrap180(pointAt(path, sb).tangent - pointAt(path, sa).tangent))) / (sb - sa) : 0; // rad per metre
      var R = k > 1e-6 ? 1 / k : Infinity,
        v = straight;
      if (R < K.STRAIGHT_R_M) {
        var vc = Math.min(straight, curveBase * clamp(R / K.CURVE_REF_R_M, 0.5, 1));
        v = straight + (vc - straight) * clamp((K.STRAIGHT_R_M - R) / (K.STRAIGHT_R_M - K.CURVE_FULL_R_M), 0, 1);
      }
      ccap.push(Math.max(minF, v));
      cap.push(Math.max(minF, Math.min(v, K.END_SPEED_BASE_FTS + K.END_SPEED_SLOPE * Math.max(0, total - s0))));
      radius.push(R);
    }
    var vm = cap.map(function (f) {
      return f * 0.3048;
    }); // metres per second for the passes
    var floorMs = minF * 0.3048;
    vm[n - 1] = 0; // stop at the end of the leg
    for (i = n - 2; i >= 0; i--) vm[i] = Math.min(vm[i], Math.sqrt(vm[i + 1] * vm[i + 1] + 2 * K.DECEL_MS2 * ds)); // braking: slow in time
    vm[0] = Math.min(vm[0], floorMs); // from (nearly) rest
    for (i = 1; i < n; i++) vm[i] = Math.min(vm[i], Math.sqrt(vm[i - 1] * vm[i - 1] + 2 * K.ACCEL_MS2 * ds)); // speeding up gently
    for (i = 0; i < n; i++) {
      if (total - i * ds > K.END_DONE_M + 0.2) vm[i] = Math.max(vm[i], floorMs);
    } // never slower than a crawl until the end
    return {
      ds: ds,
      n: n,
      total: total,
      straight: straight,
      cap: cap,
      ccap: ccap,
      radius: radius,
      v: vm.map(function (m) {
        return m / 0.3048;
      })
    };
  }
  // { v (ft/s), why } at distance s along the leg.
  function profileAt(prof, s) {
    var x = clamp(s / prof.ds, 0, prof.n - 1),
      i0 = Math.floor(x),
      i1 = Math.min(prof.n - 1, i0 + 1),
      f = x - i0;
    var v = prof.v[i0] + (prof.v[i1] - prof.v[i0]) * f,
      capHere = prof.ccap[i0] + (prof.ccap[i1] - prof.ccap[i0]) * f;
    var kt = function (fts) {
      return PS.fmt.num(fts * 0.5925, 1) + ' kt';
    };
    var why;
    if (capHere < prof.straight - 0.25) why = 'in a curve (radius ' + Math.round(prof.radius[i0]) + ' m): ' + kt(v);
    else if (v >= prof.straight - 0.1) why = 'straight: top speed ' + kt(v);
    else {
      // slowing for something ahead: the next curve if there is one before the end, otherwise the stop
      var limit = Math.min(prof.n - 1, i0 + Math.ceil(K.LOOK_FEATURE_M / prof.ds)),
        j,
        curveAt = -1;
      for (j = i0; j <= limit; j++) {
        if (prof.ccap[j] < prof.straight - 0.25) {
          curveAt = j;
          break;
        }
      }
      if (curveAt >= 0 && curveAt < prof.n - 1)
        why =
          (v > prof.v[Math.min(prof.n - 1, i0 + 2)] ? 'slowing' : 'speeding up') +
          ' for the curve in ' +
          Math.round((curveAt - x) * prof.ds) +
          ' m: ' +
          kt(v);
      else
        why =
          (v > prof.v[Math.min(prof.n - 1, i0 + 2)] ? 'slowing for the stop' : 'speeding up') +
          ' (' +
          Math.round(prof.total - s) +
          ' m to go): ' +
          kt(v);
    }
    return { v: v, why: why };
  }

  // segments: [{ sign (-1 reverse, +1 forward), points [[lat, lon], ...], radiusM? }] from the planner. settings: { cruiseUnits }.
  // Returns a follower; call update() every tick.
  function create(segments, settings) {
    settings = settings || {};
    var cruiseUnits = settings.cruiseUnits || 25;
    var yawGain = settings.yawGain || K.YAW_GAIN;
    var legs = segments.map(function (sg) {
      return { sign: sg.sign < 0 ? -1 : 1, points: sg.points, radiusM: sg.radiusM || K.RADIUS_SLOW_REF_M };
    });
    var origin = { lat: legs[0].points[0][0], lon: legs[0].points[0][1] };
    legs.forEach(function (l) {
      l.path = buildPath(l.points, origin);
      l.pathQ = extendEnd(l.path, K.PIVOT_MAX_M + K.MAX_LOOK);
      l.prof = buildProfile(l.path, l.sign < 0, cruiseUnits * K.UNITS_TO_FTS);
    });
    var totalM = 0;
    legs.forEach(function (l) {
      totalM += l.path.total;
    });

    var st = {
      leg: 0,
      phase: 'run',
      hint: 0,
      s: 0,
      smoothYaw: 0,
      stopSince: null,
      holdSince: null,
      offSince: null,
      progressAt: null,
      progressS: 0,
      done: false,
      pivotM: clamp(settings.pivotM || 0, -K.PIVOT_MAX_M, K.PIVOT_MAX_M), // seeded from the aircraft's profile, then learned
      hintQ: 0,
      prev: null, // the last pose, for learning the pivot
      pvNum: 0,
      pvDen: 0
    };

    // Learn how far ahead of its turning point the reported position is: while the nose turns by dpsi the reported position moves sideways by
    // pivot x dpsi (the pivot itself only moves along the nose). A running least squares over the last PIVOT_FORGET_S seconds.
    function learnPivot(p, hdg, dt, speedFtS) {
      var pr = st.prev;
      st.prev = { x: p.x, y: p.y, hdg: hdg };
      if (!pr || dt <= 0 || Math.abs(speedFtS) < K.PIVOT_MIN_SPEED_FTS) return;
      var dpsi = G.rad(G.angleDiff(pr.hdg, hdg)),
        mid = G.rad(pr.hdg) + dpsi / 2;
      var lateral = (p.x - pr.x) * Math.cos(mid) - (p.y - pr.y) * Math.sin(mid); // along the right-hand side of the nose
      var keep = Math.exp(-dt / K.PIVOT_FORGET_S);
      st.pvNum = st.pvNum * keep + lateral * dpsi;
      st.pvDen = st.pvDen * keep + dpsi * dpsi;
      if (st.pvDen < K.PIVOT_MIN_EVIDENCE) return;
      var est = clamp(st.pvNum / st.pvDen, -K.PIVOT_MAX_M, K.PIVOT_MAX_M);
      st.pivotM += (est - st.pivotM) * Math.min(1, K.PIVOT_BLEND_PER_S * dt);
    }

    function remainingFrom(legIndex, s) {
      var r = Math.max(0, legs[legIndex].path.total - s);
      for (var i = legIndex + 1; i < legs.length; i++) r += legs[i].path.total;
      return r;
    }

    // pose: { lat, lon, hdgDeg }; dt in seconds; speedFtS: the aircraft's present signed speed (the ramped command or what was read back).
    // Returns { speedFtS (signed target), yawDegS (target nose turn rate, clockwise positive), phase, leg, legCount, remainingM, cte, alphaDeg,
    //           done, stop (a reason to stop, or ''), note }
    function update(pose, dt, speedFtS) {
      var out = {
        why: '',
        speedFtS: 0,
        yawDegS: 0,
        phase: st.phase,
        leg: st.leg,
        legCount: legs.length,
        remainingM: 0,
        cte: 0,
        alphaDeg: 0,
        done: st.done,
        stop: '',
        note: '',
        pivotM: st.pivotM
      };
      if (st.done) {
        out.remainingM = 0;
        out.phase = 'finished';
        return out;
      }
      var leg = legs[st.leg],
        path = leg.path,
        reverse = leg.sign < 0;
      var p = G.toXY(origin.lat, origin.lon, pose.lat, pose.lon);
      var loc = locate(path, p.x, p.y, st.hint);
      st.hint = loc.i;
      if (loc.s > st.s) st.s = loc.s; // progress only moves forward (a small step back from noise is ignored)
      var s = Math.max(st.s, loc.s - 2);
      var remaining = Math.max(0, path.total - s);
      out.remainingM = remainingFrom(st.leg, s);
      out.cte = loc.cte;
      out.leg = st.leg;
      var now = pose.t !== undefined ? pose.t : 0;

      // ---- between legs: brake to a stop, hold, then the next leg ----
      if (st.phase === 'cuspStop') {
        out.phase = 'cuspStop';
        out.speedFtS = 0;
        out.yawDegS = 0;
        st.smoothYaw = 0;
        if (Math.abs(speedFtS) < K.CUSP_STOP_FTS) {
          if (st.stopSince === null) st.stopSince = now;
          if (now - st.stopSince >= K.CUSP_STOP_SECONDS) {
            st.phase = 'cuspHold';
            st.holdSince = now;
          }
        } else st.stopSince = null;
        return out;
      }
      if (st.phase === 'cuspHold') {
        out.phase = 'cuspHold';
        out.speedFtS = 0;
        out.yawDegS = 0;
        if (now - st.holdSince >= K.CUSP_HOLD_SECONDS) {
          st.leg++;
          st.phase = 'run';
          st.hint = 0;
          st.hintQ = 0;
          st.s = 0;
          st.stopSince = null;
          st.progressAt = null;
          st.offSince = null;
          st.prev = null;
          out.note = 'next leg: ' + (legs[st.leg].sign < 0 ? 'push back' : 'drive forward');
          out.phase = 'run';
          out.leg = st.leg;
          out.remainingM = remainingFrom(st.leg, 0);
        }
        return out;
      }

      // ---- the end pin reached on the way to another pin (a turnaround pin beyond it, say): stop here, that is where the push was meant to end ----
      if (st.phase === 'run' && st.leg < legs.length - 1) {
        var lastLeg = legs[legs.length - 1],
          endPt = pointAt(lastLeg.path, lastLeg.path.total),
          endHdg = lastLeg.sign < 0 ? G.normDeg(endPt.tangent + 180) : endPt.tangent;
        if (
          Math.sqrt((p.x - endPt.x) * (p.x - endPt.x) + (p.y - endPt.y) * (p.y - endPt.y)) <= K.PASS_END_M &&
          Math.abs(G.angleDiff(pose.hdgDeg, endHdg)) <= K.PASS_END_HEADING_DEG &&
          totalM - out.remainingM >= K.PASS_END_MIN_DRIVEN_M
        ) {
          st.done = true;
          out.done = true;
          out.phase = 'finished';
          out.remainingM = 0;
          out.note = 'the end pin was reached on the way to another pin: stopping here';
          return out;
        }
      }

      // ---- end of this leg ----
      if (remaining <= K.END_DONE_M) {
        if (st.leg >= legs.length - 1) {
          st.done = true;
          out.done = true;
          out.phase = 'finished';
          out.remainingM = 0;
          return out;
        }
        st.phase = 'cuspStop';
        st.stopSince = null;
        out.phase = 'cuspStop';
        out.note = 'end of leg ' + (st.leg + 1) + ': stopping to change direction';
        return out;
      }

      // ---- steering: pure pursuit to a point a little way along the path ----
      learnPivot(p, pose.hdgDeg, dt, speedFtS);
      var offPath = Math.abs(loc.cte);
      // The point that is steered: the pivot, which is pivotM behind the reported position along the nose (so ahead of it when reversing).
      var q = p,
        sq = s,
        pathQ = path;
      if (Math.abs(st.pivotM) >= K.PIVOT_MIN_M) {
        q = {
          x: p.x - st.pivotM * Math.sin(G.rad(pose.hdgDeg)),
          y: p.y - st.pivotM * Math.cos(G.rad(pose.hdgDeg))
        };
        if (st.hintQ === 0) st.hintQ = st.hint;
        pathQ = leg.pathQ;
        var lq = locate(pathQ, q.x, q.y, st.hintQ);
        st.hintQ = lq.i;
        sq = lq.s;
      } else st.hintQ = 0;
      var sharp = bendAhead(path, s, 10) > K.CURVE_AHEAD_SHARP_DEG;
      var look = reverse ? (sharp ? K.LOOK_SHARP_REV : K.LOOK_REV) : sharp ? K.LOOK_SHARP_FWD : K.LOOK_FWD;
      if (offPath > K.OFF_PATH_LOOK_TRIGGER) look = Math.min(look, K.OFF_PATH_LOOK);
      look = clamp(look, K.MIN_LOOK, K.MAX_LOOK);
      look = Math.min(look, Math.max(K.END_LOOK_MIN, K.END_LOOK_FRACTION * remaining));
      var aim = pointAt(pathQ, Math.min(pathQ.total, sq + look));
      var aimDist = Math.sqrt((aim.x - q.x) * (aim.x - q.x) + (aim.y - q.y) * (aim.y - q.y));
      var travelHdg = reverse ? G.normDeg(pose.hdgDeg + 180) : pose.hdgDeg;
      var toAim = aimDist > K.AIM_MIN ? brgXY(q.x, q.y, aim.x, aim.y) : aim.tangent;
      var alpha = clamp(wrap180(toAim - travelHdg), -K.MAX_ALPHA_DEG, K.MAX_ALPHA_DEG);
      var kappa = (2 * Math.sin(G.rad(alpha))) / Math.max(aimDist, K.MIN_LOOK); // 1/m, clockwise
      // The last stretch of the last leg steers by the nose, not the position: ease from following the path to turning toward the path's end heading
      // (gently: a long look-ahead), so the aircraft finishes facing the way the plan says even if it is a little off the line.
      if (st.leg >= legs.length - 1 && remaining < K.END_HOLD_M) {
        var wHold = clamp((K.END_HOLD_M - remaining) / (K.END_HOLD_M - K.END_HOLD_FULL_M), 0, 1);
        var endTan = pointAt(path, path.total).tangent;
        var alphaH = clamp(wrap180(endTan - travelHdg), -60, 60);
        alphaH = alphaH > 0 ? Math.max(0, alphaH - K.END_HEADING_SLACK_DEG) : Math.min(0, alphaH + K.END_HEADING_SLACK_DEG);
        var kappaH = (2 * Math.sin(G.rad(alphaH))) / K.END_HOLD_LOOK_M;
        kappa = kappa * (1 - wHold) + kappaH * wHold;
        out.alphaDeg = alphaH * wHold + alpha * (1 - wHold);
      }
      out.alphaDeg = alpha;

      // ---- speed: from the leg's profile (fast on straights, slower through curves, braking in time for curves and the stop), then slowed further
      // only if the tug is not where it should be: pointing well away from the aim point, or off the path ----
      var minFts = K.MIN_AUTO_UNITS * K.UNITS_TO_FTS,
        cruiseFts = cruiseUnits * K.UNITS_TO_FTS;
      var pv = profileAt(leg.prof, s),
        mag = pv.v;
      var turnFactor = 1 - (1 - K.MIN_TURN_FRACTION) * clamp(Math.abs(alpha) / K.TURN_SLOW_FULL_ALPHA_DEG, 0, 1);
      if (turnFactor < 1) {
        mag = Math.max(minFts, mag * turnFactor);
      }
      if (offPath > K.OFF_PATH_M) {
        mag = Math.max(minFts, Math.min(mag, cruiseFts * K.OFF_PATH_FRACTION));
        pv.why = 'off the path by ' + PS.fmt.num(offPath, 1) + ' m: slowed';
      }
      out.speedFtS = (reverse ? -1 : 1) * mag;
      out.why = pv.why;

      // ---- turn rate: curvature x speed, within the steering limits, then the tug's measured response is allowed for ----
      var recovering = offPath > K.RECOVER_OFF;
      var rotLimit = recovering
        ? reverse
          ? K.ROT_LIMIT_RECOVER_REV
          : K.ROT_LIMIT_RECOVER_FWD
        : reverse
          ? K.ROT_LIMIT_REV
          : K.ROT_LIMIT_FWD;
      if (st.leg === legs.length - 1 && remaining < K.END_ROT_LIMIT_DIST) rotLimit = Math.min(rotLimit, K.END_ROT_LIMIT);
      var v = Math.abs(speedFtS) > 0.05 ? Math.abs(speedFtS) : Math.abs(out.speedFtS); // the speed it is really going (ramping up from rest uses the target)
      var wantYaw = (kappa * v * 0.3048 * 180) / Math.PI; // degrees per second the path needs
      var maxYaw = rotLimit * K.YAW_PER_ROT_PER_FTS * v; // what the steering limit allows at this speed
      var limited = Math.abs(wantYaw) > maxYaw;
      var yaw = clamp(wantYaw, -maxYaw, maxYaw);
      // Feed forward: the nose turns at gain x commanded - deadband, so ask for more; the aim-point feedback trims what is left.
      var fade = Math.abs(yaw) < 1e-3 ? 0 : Math.tanh(Math.abs(yaw) / 0.6);
      var raw = (yaw + (yaw >= 0 ? 1 : -1) * K.YAW_DEADBAND_DEG_S * fade) / yawGain;
      raw = clamp(raw, -maxYaw / yawGain - 1, maxYaw / yawGain + 1);
      var keep = Math.pow(K.SMOOTH_KEEP_AT_50MS, dt / 0.05);
      st.smoothYaw = st.smoothYaw * keep + raw * (1 - keep);
      out.yawDegS = st.smoothYaw;
      if (limited) out.note = 'steering at its limit (the path needs a tighter turn than the tug can make at this speed)';

      // ---- watchdogs: lost the path, or not moving ----
      if (offPath > K.LOST_CTE_M) {
        if (st.offSince === null) st.offSince = now;
        if (now - st.offSince > K.LOST_SECONDS) out.stop = 'the tug is ' + Math.round(offPath) + ' m off the planned path';
      } else st.offSince = null;
      if (st.progressAt === null) {
        st.progressAt = now;
        st.progressS = s;
      } else if (s - st.progressS > K.STUCK_MIN_ADVANCE_M) {
        st.progressAt = now;
        st.progressS = s;
      } else if (now - st.progressAt > K.STUCK_SECONDS && Math.abs(out.speedFtS) > 0.5)
        out.stop = 'the aircraft is not moving along the path (parking brake, or the tug is not driving it)';
      return out;
    }

    // A new top speed mid-push: rebuild each leg's speed profile (the position along the path is unchanged).
    function setCruise(units) {
      cruiseUnits = units;
      legs.forEach(function (l) {
        l.prof = buildProfile(l.path, l.sign < 0, cruiseUnits * K.UNITS_TO_FTS);
      });
    }
    // The route as driven so far, and what is still to drive, as legs of [lat, lon] points (for a return to the gate, or finishing one).
    function cut(path, s0, s1) {
      var pts = [pointAt(path, s0)],
        k;
      for (k = 0; k < path.xy.length; k++) {
        if (path.cum[k] > s0 + 0.01 && path.cum[k] < s1 - 0.01) pts.push({ x: path.xy[k][0], y: path.xy[k][1] });
      }
      pts.push(pointAt(path, s1));
      return pts.map(function (q) {
        return G.fromXY(origin.lat, origin.lon, q.x, q.y);
      });
    }
    function travelled() {
      var out = [];
      for (var i = 0; i <= st.leg && i < legs.length; i++) {
        var end = i < st.leg || st.done ? legs[i].path.total : st.s;
        if (end >= 0.5)
          out.push({ sign: legs[i].sign, points: cut(legs[i].path, 0, end), radiusM: legs[i].radiusM, index: i, lengthM: end });
      }
      return out;
    }
    function ahead() {
      var out = [];
      if (st.done) return out;
      for (var i = st.leg; i < legs.length; i++) {
        var from = i === st.leg ? st.s : 0,
          total = legs[i].path.total;
        if (total - from >= 0.5)
          out.push({
            sign: legs[i].sign,
            points: cut(legs[i].path, from, total),
            radiusM: legs[i].radiusM,
            index: i,
            lengthM: total - from
          });
      }
      return out;
    }
    // The push was not being driven for a while (paused, brake held): forget the "not moving" and "off the path" timers, which kept counting.
    function rearm() {
      st.progressAt = null;
      st.offSince = null;
      st.prev = null;
    }
    return {
      update: update,
      rearm: rearm,
      setCruise: setCruise,
      travelled: travelled,
      ahead: ahead,
      totalM: totalM,
      legCount: legs.length,
      state: st,
      legs: legs
    };
  }

  // The planner's evaluated plan (PS.plan.evaluate) as the legs the follower drives. The radius it was planned with goes with each leg.
  function legsFromPlan(plan) {
    return plan.segments.map(function (sg) {
      return { sign: sg.sign, points: sg.points, radiusM: plan.radiusM };
    });
  }

  return {
    create: create,
    K: K,
    buildPath: buildPath,
    locate: locate,
    pointAt: pointAt,
    legsFromPlan: legsFromPlan,
    buildProfile: buildProfile,
    profileAt: profileAt
  };
})();
