// Route planner: a port of the original app's planned-route code (apps/windows/src/mapGeo.ts, "Planned route" to the end), which mirrors
// the bridge's FilletPath planner (bridge/Constants.cs). It answers "what line does the tug follow through these pins, in which direction
// does it drive each stretch, and can it make it?". The suggested pushes are built on it, and so is the pin route drawn on the plot.
//
// Waypoints are plain objects like the original's WaypointFile:
//   { id, label, lat, lon, seq, terminal, headingDeg (or null), headingUser (bool), drive ('auto'|'forward'|'reverse'), leadInM }
// Differences from the TypeScript: ES5 style, PS.geo for the maths (flat-earth offsets instead of great-circle; the difference is far
// below a metre at airport scale), and withAutoOrientation is not ported (the suggester does not use it).

PS.planner = (function () {
  var G = PS.geo;
  var M_PER_DEG = 111320;

  // Keep these in sync with PathTurnRadiusM / Fillet* in bridge/Constants.cs (and mapGeo.ts).
  var PATH_TURN_RADIUS_M = 40;      // the usual planned radius (the tug's radius at its steering limit is about 15-17 m: 30.5 / rotation setting)
  var turnRadiusM = PATH_TURN_RADIUS_M;   // the radius in use; the plan tries smaller ones when a corner is too cramped for this one (setRadius)
  var FILLET_MAX_LEG_FRACTION = 0.5;
  var FILLET_MIN_DEFLECTION_DEG = 2;
  var FILLET_SMOOTH_TANGENT_M = 15;   // a light bend is spread over at least this much run each side
  var FILLET_MIN_RADIUS_M = 1;
  var FILLET_ARC_STEP_DEG = 10;
  var MIN_POINT_SPACING_M = 0.05;

  // Straight-first start (RouteTuning.AxisLead* / ForwardIfWithinDeg).
  var AXIS_LEAD_MIN_OFF_DEG = 1;
  var AXIS_LEAD_MAX_OFF_DEG = 90;
  var AXIS_LEAD_MIN_STRAIGHT_M = 2;
  var FORWARD_IF_WITHIN_DEG = 70;
  var FORWARD_IF_WITHIN_LATER_LEG_DEG = 90;
  var HEADING_LEAD_IN_M = 30;         // straight run lined up on a user-rotated end heading, before the pin
  var MIN_LEAD_IN_M = 10;
  var MAX_LEAD_IN_M = 200;

  var TIGHT_ARC_FRACTION = 0.6;
  var LOOP_TURN_DEG = 270;
  var HARD_START_OFF_DEG = 60;

  var TURNAROUND_PIN_LABEL = 'Turnaround pin';
  var HAIRPIN_TURN_DEG = 150;
  var HAIRPIN_LENGTH_RATIO = 2.2;
  var HAIRPIN_START_OFF_DEG = 100;
  var TURNAROUND_PREFERRED_START_OFF_DEG = 60;
  var TURNAROUND_PREFERRED_SLACK_M = 40;
  var HELPER_ALONG_M = [-160, -130, -100, -80, -60, -40, -25, -15, 15, 25, 40, 60, 80, 100, 130, 160];
  var HELPER_SIDE_M = [-80, -60, -40, -20, 0, 20, 40, 60, 80];
  var CUSP_PENALTY_M = 20;

  var idCounter = 0;
  function newId(seq) { idCounter++; return 'wp-' + Date.now() + '-' + seq + '-' + idCounter; }
  function wrap360(d) { return G.normDeg(d); }
  function wrap180(d) { return G.angleDiff(0, d); }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function haversineM(a, b, c, d) { return G.distanceM(a, b, c, d); }
  function initialBearing(a, b, c, d) { return G.bearingDeg(a, b, c, d); }
  function destPoint(lat, lon, brg, d) { return G.offset(lat, lon, brg, d); }
  function extend(o, more) { var r = {}, k; for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; } if (more) { for (k in more) { if (Object.prototype.hasOwnProperty.call(more, k)) r[k] = more[k]; } } return r; }

  // The last pin is the end pin; only it carries a default park heading, and any pin keeps a heading the user rotated it to.
  function ensureTerminal(waypoints) {
    return waypoints.map(function (w, i, arr) {
      var terminal = i === arr.length - 1;
      var label = String(w.label || '');
      return extend(w, {
        terminal: terminal,
        seq: i,
        headingDeg: terminal || w.headingUser ? w.headingDeg : null,
        label: terminal && (arr.length === 1 || w.terminal || label.indexOf('End') === 0) ? (w.label || 'End position') : w.label
      });
    });
  }

  // Straight legs joined by constant-radius arcs. stats.minRadiusM gets the tightest arc (0 when a corner could not be rounded).
  function filletPath(pts, radiusM, stats) {
    if (pts.length < 3 || radiusM <= 0) return pts.slice();
    var lat0 = pts[0][0], lon0 = pts[0][1];
    var cosLat = Math.cos(lat0 * Math.PI / 180);
    function toXy(p) { return { x: (p[1] - lon0) * M_PER_DEG * cosLat, y: (p[0] - lat0) * M_PER_DEG }; }
    function toLatLon(x, y) { return [lat0 + y / M_PER_DEG, lon0 + x / (M_PER_DEG * cosLat)]; }
    var xy = pts.map(toXy);
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = xy[i - 1], b = xy[i], c = xy[i + 1];
      var l1 = hyp(a.x - b.x, a.y - b.y), l2 = hyp(c.x - b.x, c.y - b.y);
      if (l1 < 1e-6 || l2 < 1e-6) { out.push(pts[i]); continue; }
      // Unit vectors from the corner back along each leg; interior angle phi between them.
      var u1x = (a.x - b.x) / l1, u1y = (a.y - b.y) / l1;
      var u2x = (c.x - b.x) / l2, u2y = (c.y - b.y) / l2;
      var phi = Math.acos(Math.min(1, Math.max(-1, u1x * u2x + u1y * u2y)));
      var deflection = Math.PI - phi;
      if (deflection < FILLET_MIN_DEFLECTION_DEG * Math.PI / 180) { out.push(pts[i]); continue; }
      // Tangent length for radius r is r*tan(deflection/2); capped to half of each adjacent leg.
      var tanHalf = Math.tan(deflection / 2);
      var cap1 = i - 1 === 0 ? 1 : FILLET_MAX_LEG_FRACTION;
      var cap2 = i + 1 === pts.length - 1 ? 1 : FILLET_MAX_LEG_FRACTION;
      var t = Math.min(Math.max(radiusM * tanHalf, FILLET_SMOOTH_TANGENT_M), cap1 * l1, cap2 * l2);
      var r = t / tanHalf;
      if (r < FILLET_MIN_RADIUS_M) { if (stats) stats.minRadiusM = 0; out.push(pts[i]); continue; }
      if (stats) stats.minRadiusM = Math.min(stats.minRadiusM, r);
      var t1 = { x: b.x + u1x * t, y: b.y + u1y * t };
      var t2 = { x: b.x + u2x * t, y: b.y + u2y * t };
      var bx = u1x + u2x, by = u1y + u2y;
      var bl = hyp(bx, by);
      if (bl < 1e-9) { out.push(pts[i]); continue; }
      var dc = r / Math.sin(phi / 2);
      var ctr = { x: b.x + (bx / bl) * dc, y: b.y + (by / bl) * dc };
      var ang1 = Math.atan2(t1.y - ctr.y, t1.x - ctr.x);
      var ang2 = Math.atan2(t2.y - ctr.y, t2.x - ctr.x);
      var sweep = Math.atan2(Math.sin(ang2 - ang1), Math.cos(ang2 - ang1)); // shortest signed
      var steps = Math.max(2, Math.ceil(Math.abs(sweep) / (FILLET_ARC_STEP_DEG * Math.PI / 180)));
      for (var k = 0; k <= steps; k++) {
        var ang = ang1 + (sweep * k) / steps;
        out.push(toLatLon(ctr.x + r * Math.cos(ang), ctr.y + r * Math.sin(ang)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // Forward when the leg is within FORWARD_IF_WITHIN_DEG of the nose, otherwise push back; advanced pins can force either.
  function signFor(pin, legBearing, noseHdg, advanced, firstLeg) {
    if (advanced) {
      var d = String(pin.drive || 'auto').trim().toLowerCase();
      if (d === 'forward' || d === 'fwd') return 1;
      if (d === 'reverse' || d === 'back' || d === 'backward') return -1;
    }
    // A heading the user set on the pin says which way the tug arrives: nose-first along it (forward) or tail-first (reverse).
    if (pin.headingUser && pin.headingDeg !== null && pin.headingDeg !== undefined && isFinite(pin.headingDeg)) {
      return Math.abs(wrap180(legBearing - pin.headingDeg)) < 90 ? 1 : -1;
    }
    if (noseHdg === null || noseHdg === undefined || !isFinite(noseHdg)) return -1;
    return Math.abs(wrap180(legBearing - noseHdg)) < (firstLeg ? FORWARD_IF_WITHIN_DEG : FORWARD_IF_WITHIN_LATER_LEG_DEG) ? 1 : -1;
  }

  // One segment's path: straight along the aircraft's own axis first, then a turn toward the first pin as late as a radiusM arc
  // allows, then the remaining pins with rounded corners.
  // The arrival line for a pin with a set heading starts where it crosses the aircraft's axis when that gives a neat straight-arc-straight path (see
  // buildSegment); where that does not fit, the older lead-in is used. Whichever ends on the heading with the gentler turn wins.
  function segmentPath(pose, sign, pins, radiusM, stats) {
    var sCross = { minRadiusM: radiusM }, crossed = { used: false };
    var withCross = buildSegment(pose, sign, pins, radiusM, sCross, true, crossed);
    if (!crossed.used) { if (stats) stats.minRadiusM = sCross.minRadiusM; return withCross; }
    var sOld = { minRadiusM: radiusM };
    var old = buildSegment(pose, sign, pins, radiusM, sOld, false, crossed);
    var lastPin = pins[pins.length - 1];
    function penalty(points, st) {
      var a = points[points.length - 2] || points[0], b = points[points.length - 1];
      var tg = initialBearing(a[0], a[1], b[0], b[1]), nose = sign > 0 ? tg : wrap360(tg + 180);
      var off = lastPin && lastPin.headingUser && lastPin.headingDeg !== null && lastPin.headingDeg !== undefined && isFinite(lastPin.headingDeg) ? Math.abs(wrap180(nose - lastPin.headingDeg)) : 0;
      return (off > 12 ? 100 + off : 0) + Math.max(0, radiusM - st.minRadiusM);
    }
    var useCross = penalty(withCross, sCross) <= penalty(old, sOld);
    if (stats) stats.minRadiusM = useCross ? sCross.minRadiusM : sOld.minRadiusM;
    return useCross ? withCross : old;
  }
  function buildSegment(pose, sign, pins, radiusM, stats, useCross, crossed) {
    var raw = [[pose.lat, pose.lon]];
    for (var n = 0; n < pins.length; n++) {
      var w = pins[n];
      // A pin the user rotated: arrive along that heading (tail-first when reversing) with a straight lead-in before it.
      if (w.headingUser && w.headingDeg !== null && w.headingDeg !== undefined && isFinite(w.headingDeg)) {
        var prevPt = raw[raw.length - 1];
        var travel = sign > 0 ? w.headingDeg : wrap360(w.headingDeg + 180);
        var reach = Math.max(MIN_LEAD_IN_M, 0.8 * haversineM(prevPt[0], prevPt[1], w.lat, w.lon));
        var lead = w.leadInM !== null && w.leadInM !== undefined ? w.leadInM : HEADING_LEAD_IN_M;
        var leadPointM = Math.min(Math.min(MAX_LEAD_IN_M, Math.max(MIN_LEAD_IN_M, lead)) + radiusM, reach);
        // Where the line the tug must arrive along crosses the aircraft's own axis: starting the arrival line there lets the path be one straight run
        // along the axis, one arc, and the run in to the pin, which is the neatest way when the pin is not far to the side. A lead-in longer than
        // that overshoots the crossing and forces a tight kink.
        if (useCross && raw.length === 1 && pose.hdgDeg !== null && pose.hdgDeg !== undefined && isFinite(pose.hdgDeg)) {
          var axisHdg = sign < 0 ? wrap360(pose.hdgDeg + 180) : wrap360(pose.hdgDeg);
          var cosP = Math.cos(pose.lat * Math.PI / 180);
          var px = (w.lon - pose.lon) * M_PER_DEG * cosP, py = (w.lat - pose.lat) * M_PER_DEG;   // pin relative to the aircraft (x east, y north)
          var ax = Math.sin(G.rad(axisHdg)), ay = Math.cos(G.rad(axisHdg)), tx = Math.sin(G.rad(travel)), ty = Math.cos(G.rad(travel));
          var det = ax * ty - ay * tx;                       // axis ray: s*(ax, ay) meets the arrival line pin - u*(tx, ty)
          if (Math.abs(det) > 0.2) {
            var sAxis = (px * ty - py * tx) / det, uLine = -(px * ay - py * ax) / det;
            if (sAxis > 0 && uLine > 0 && uLine < leadPointM && uLine >= MIN_POINT_SPACING_M) { leadPointM = uLine; crossed.used = true; }
          }
        }
        var lp = destPoint(w.lat, w.lon, wrap360(travel + 180), leadPointM);
        if (haversineM(prevPt[0], prevPt[1], lp[0], lp[1]) >= MIN_POINT_SPACING_M && haversineM(prevPt[0], prevPt[1], w.lat, w.lon) >= MIN_POINT_SPACING_M) raw.push([lp[0], lp[1]]);
      }
      var last = raw[raw.length - 1];
      if (haversineM(last[0], last[1], w.lat, w.lon) >= MIN_POINT_SPACING_M) raw.push([w.lat, w.lon]);
    }
    if (raw.length >= 2 && pose.hdgDeg !== null && pose.hdgDeg !== undefined && isFinite(pose.hdgDeg)) {
      var pLat = raw[1][0], pLon = raw[1][1];
      var br = initialBearing(pose.lat, pose.lon, pLat, pLon);
      var axis = sign < 0 ? wrap360(pose.hdgDeg + 180) : wrap360(pose.hdgDeg);
      var off = Math.abs(wrap180(br - axis));
      if (off >= AXIS_LEAD_MIN_OFF_DEG && off < AXIS_LEAD_MAX_OFF_DEG) {
        // Turn as late as a radiusM arc allows: a full 90 degrees level with the pin when there is at least R of sideways room,
        // a gentler turn starting earlier when there is less.
        var d = haversineM(pose.lat, pose.lon, pLat, pLon);
        var x = d * Math.cos(off * Math.PI / 180);
        var y = d * Math.sin(off * Math.PI / 180);
        var room = raw.length === 2 ? y : y * FILLET_MAX_LEG_FRACTION;
        var beta = room >= radiusM ? Math.PI / 2 : Math.acos(1 - room / radiusM);
        var along = x - y / Math.tan(beta);
        if (along >= AXIS_LEAD_MIN_STRAIGHT_M) raw.splice(1, 0, destPoint(pose.lat, pose.lon, axis, along));
      }
    }
    return filletPath(raw, radiusM, stats);
  }

  // The whole planned route as one segment per direction. Push back to pin 1 then pull forward into a gate is two segments: the tug
  // stops at pin 1 (a cusp), and the second leaves along the aircraft's nose axis before turning toward the next pin.
  // Returns [{ sign (-1 reverse, +1 forward), points, endHdgDeg, pinIdx, startOffDeg, tightestRadiusM }]
  function plannedRouteSegments(origin, waypoints, advanced, radiusM, firstLegBias) {
    if (advanced === undefined) advanced = false;
    if (radiusM === undefined) radiusM = turnRadiusM;
    if (firstLegBias === undefined) firstLegBias = true;
    var pins = [];
    waypoints.forEach(function (w, idx) {
      if (!isFinite(w.lat) || !isFinite(w.lon) || (w.lat === 0 && w.lon === 0)) return;
      pins.push({ lat: w.lat, lon: w.lon, drive: w.drive, idx: idx, headingDeg: w.headingDeg, headingUser: w.headingUser, leadInM: w.leadInM });
    });
    var segs = [];
    var pose = { lat: origin.lat, lon: origin.lon, hdgDeg: origin.hdgDeg === undefined ? null : origin.hdgDeg };
    var i = 0;
    while (i < pins.length) {
      var brFirst = initialBearing(pose.lat, pose.lon, pins[i].lat, pins[i].lon);
      var sign = signFor(pins[i], brFirst, pose.hdgDeg, advanced, firstLegBias && segs.length === 0);
      var j = i;
      while (j + 1 < pins.length) {
        // The nose the tug has when it stops at pin j is the end of the path planned to it, not the chord bearing.
        var trial = segmentPath(pose, sign, pins.slice(i, j + 1), radiusM);
        var ta = trial[trial.length - 2] || trial[0];
        var tb = trial[trial.length - 1];
        var tg0 = initialBearing(ta[0], ta[1], tb[0], tb[1]);
        var nose = sign > 0 ? tg0 : wrap360(tg0 + 180);
        var brNext = initialBearing(pins[j].lat, pins[j].lon, pins[j + 1].lat, pins[j + 1].lon);
        if (signFor(pins[j + 1], brNext, nose, advanced, false) !== sign) break;
        j++;
      }
      var stats = { minRadiusM: radiusM };
      var points = segmentPath(pose, sign, pins.slice(i, j + 1), radiusM, stats);
      var a = points[points.length - 2] || points[0];
      var b = points[points.length - 1];
      var tg = initialBearing(a[0], a[1], b[0], b[1]);
      var endHdgDeg = sign > 0 ? tg : wrap360(tg + 180);
      // How far the first stretch of the path points from the way the aircraft can actually start moving.
      var sa = points[0], sb = points[1] || points[0];
      var startBr = initialBearing(sa[0], sa[1], sb[0], sb[1]);
      var startAxis = pose.hdgDeg === null ? null : (sign > 0 ? pose.hdgDeg : wrap360(pose.hdgDeg + 180));
      var startOffDeg = startAxis === null || !isFinite(startBr) ? 0 : Math.abs(wrap180(startBr - startAxis));
      segs.push({ sign: sign, points: points, endHdgDeg: endHdgDeg, pinIdx: pins.slice(i, j + 1).map(function (p) { return p.idx; }), startOffDeg: startOffDeg, tightestRadiusM: stats.minRadiusM });
      pose = { lat: b[0], lon: b[1], hdgDeg: endHdgDeg };
      i = j + 1;
    }
    return segs;
  }

  function pathLengthM(pts) {
    var t = 0;
    for (var i = 1; i < pts.length; i++) t += haversineM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    return t;
  }

  // Total heading change along a path, in degrees.
  function pathTurnDeg(pts) {
    var t = 0;
    for (var i = 1; i < pts.length - 1; i++) {
      var b1 = initialBearing(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      var b2 = initialBearing(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (isFinite(b1) && isFinite(b2)) t += Math.abs(wrap180(b2 - b1));
    }
    return t;
  }

  // Why the tug may not manage a segment, or null when it should. The route is still driven; this only warns.
  function segmentWarning(seg, radiusM, opts) {
    if (radiusM === undefined) radiusM = turnRadiusM;
    var why = [];
    if (seg.tightestRadiusM < radiusM * TIGHT_ARC_FRACTION) {
      why.push('its tightest turn is about ' + Math.round(seg.tightestRadiusM) + ' m radius, but the tug needs ' + radiusM + ' m');
    }
    // A single run that turns through most of a circle or more is a loop, however wide its arcs.
    var turned = pathTurnDeg(seg.points);
    if (turned > LOOP_TURN_DEG) why.push('its path turns ' + Math.round(turned) + '° in total, which is a loop');
    // A leg that starts from a standstill has to swing out if it starts well off the axis.
    if (!(opts && opts.ignoreStartOff) && seg.startOffDeg > HARD_START_OFF_DEG) {
      why.push('it starts ' + Math.round(seg.startOffDeg) + '° away from the way the aircraft is pointing');
    }
    if (!why.length) return null;
    return 'The tug may not be able to make this ' + (seg.sign < 0 ? 'push back' : 'forward') + ' manoeuvre: ' + why.join(' and ') + '. Move a pin further away, or shorten the final straight with the heading handle.';
  }

  // What a planned route really costs to drive: its length, plus a turn-radius arc for each degree a leg starts off the aircraft's axis.
  function driveCostM(segs) {
    var t = 0;
    segs.forEach(function (sg) { t += pathLengthM(sg.points) + turnRadiusM * (sg.startOffDeg * Math.PI / 180); });
    return t;
  }

  // Planned nose heading at every waypoint, so a pin can be drawn facing the way the jet will point there.
  function plannedPinHeadings(segments, waypoints) {
    var out = waypoints.map(function () { return null; });
    segments.forEach(function (seg) {
      seg.pinIdx.forEach(function (idx) {
        var w = waypoints[idx];
        if (!w) return;
        var bestD = Infinity, bestTg = seg.endHdgDeg;
        for (var k = 0; k < seg.points.length - 1; k++) {
          var aLat = seg.points[k][0], aLon = seg.points[k][1], bLat = seg.points[k + 1][0], bLon = seg.points[k + 1][1];
          var cosLat = Math.cos(aLat * Math.PI / 180);
          var bx = (bLon - aLon) * M_PER_DEG * cosLat, by = (bLat - aLat) * M_PER_DEG;
          var px = (w.lon - aLon) * M_PER_DEG * cosLat, py = (w.lat - aLat) * M_PER_DEG;
          var l2 = bx * bx + by * by;
          var t = l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / l2));
          var d = hyp(px - bx * t, py - by * t);
          if (d < bestD - 1e-6) { bestD = d; bestTg = initialBearing(aLat, aLon, bLat, bLon); }
        }
        out[idx] = seg.sign > 0 ? bestTg : wrap360(bestTg + 180);
      });
    });
    return out;
  }

  // When the end pin has a heading the user set, one leg to it can leave the aircraft facing the wrong way or need a huge loop.
  // Then try a helper pin on the aircraft's own axis (straight ahead or back from where the last leg before the end leaves it), so the
  // route becomes two legs in opposite directions with modest turns, like a three-point turn. Only added if the two-leg route is
  // cheaper to drive. Labelled "Turnaround pin".
  function addHelperPinIfNeeded(origin, waypoints) {
    function none(info) { return { waypoints: waypoints, added: false, info: info }; }
    if (!waypoints.length) return none('no pins');
    var end = waypoints[waypoints.length - 1];
    if (!end.headingUser || end.headingDeg === null || end.headingDeg === undefined || !isFinite(end.headingDeg)) return none('end heading is Auto, so no turnaround pin is considered');
    if (waypoints.some(function (w) { return w.label === TURNAROUND_PIN_LABEL; })) return none('already has a turnaround pin');
    var direct = plannedRouteSegments(origin, waypoints);
    if (direct.length !== 1) return none('route already has ' + direct.length + ' legs, no pin needed');
    var pts = direct[0].points;
    var len = pathLengthM(pts);
    var directCost = driveCostM(direct);
    var chord = haversineM(origin.lat, origin.lon, end.lat, end.lon);
    var startsBackwards = direct[0].startOffDeg > HAIRPIN_START_OFF_DEG;
    var directTurn = pathTurnDeg(pts);
    if (!(startsBackwards || directTurn > HAIRPIN_TURN_DEG || len > HAIRPIN_LENGTH_RATIO * chord + 40)) return none('not a hairpin');

    var pre = waypoints.slice(0, -1);
    var pose = { lat: origin.lat, lon: origin.lon, hdgDeg: origin.hdgDeg };
    if (pre.length > 0) {
      var preSegs = plannedRouteSegments(origin, pre);
      var lastSeg = preSegs[preSegs.length - 1];
      var tail = lastSeg ? lastSeg.points[lastSeg.points.length - 1] : null;
      if (!lastSeg || !tail) return none('could not work out where the legs before the end leave the aircraft');
      pose = { lat: tail[0], lon: tail[1], hdgDeg: lastSeg.endHdgDeg };
    }

    var best = null, tried = 0, feasible = 0, slack = 0, clearanceUsed = 0, rejectedNear = 0, rejectedWarn = 0;
    // The pin has to be somewhere the tug can make the turn: neither leg may be so short that the cusp
    // sits inside the arc of the next turn. (An earlier version also kept the pin a full turn radius clear of the direct route, but that
    // route is a loop the tug cannot drive, and it pushed the pin far away for nothing.) The cheapest such pin wins.
    var clearances = [0];
    var MIN_LEG_M = 12;
    for (var ci = 0; ci < clearances.length && !(best && best.accepted); ci++) {
      var clr = clearances[ci];
      // Prefer a pin that leaves both legs starting close to the aircraft's axis; settle for a sharper swing only if none does.
      var maxStarts = [TURNAROUND_PREFERRED_START_OFF_DEG, HAIRPIN_START_OFF_DEG];
      for (var m = 0; m < maxStarts.length; m++) {
        var maxStartOff = maxStarts[m];
        tried = 0; feasible = 0; best = null;
        slack = maxStartOff === TURNAROUND_PREFERRED_START_OFF_DEG ? TURNAROUND_PREFERRED_SLACK_M : 0;
        for (var ai = 0; ai < HELPER_ALONG_M.length; ai++) {
          for (var si = 0; si < HELPER_SIDE_M.length; si++) {
            var along = HELPER_ALONG_M[ai], side = HELPER_SIDE_M[si];
            // `along` metres ahead (+) or behind (-) the aircraft's nose, and `side` metres to its right (+) or left (-).
            var ap = destPoint(pose.lat, pose.lon, pose.hdgDeg, along);
            var pp = side === 0 ? ap : destPoint(ap[0], ap[1], wrap360(pose.hdgDeg + 90), side);
            tried++;
            var pin = { id: newId(pre.length), label: TURNAROUND_PIN_LABEL, lat: pp[0], lon: pp[1], seq: 0, terminal: false, headingDeg: null, drive: 'auto' };
            var segs = plannedRouteSegments(origin, pre.concat([pin, end]));
            if (segs.length < 2) continue;
            if (segs.some(function (sg) { return sg.startOffDeg > maxStartOff || pathTurnDeg(sg.points) > HAIRPIN_TURN_DEG; })) continue;
            if (segs.some(function (sg) { return pathLengthM(sg.points) < MIN_LEG_M; })) { rejectedNear++; continue; }
            feasible++;
            var score = driveCostM(segs) + CUSP_PENALTY_M * (segs.length - 1);
            if (!best || score < best.score) best = { pin: pin, score: score, along: along, side: side };
          }
        }
        // The gentle pass may cost a little more than the single leg and still win.
        if (best && best.score < directCost + slack) { best.accepted = true; clearanceUsed = clr; break; }
      }
      if (best && !best.accepted && ci < clearances.length - 1) { /* keep looking with less clearance only if nothing better turns up */ }
    }
    if (!best) return none('hairpin but none of ' + tried + ' candidate pins gave a workable two-leg route');
    // A single leg that warns (a loop, or an arc tighter than the tug can steer) is not a route at all.
    var directWarns = direct.some(function (g) { return segmentWarning(g) !== null; });
    if (!directWarns && best.score >= directCost + slack) return none('hairpin but the best workable pin is not cheaper than the single leg');
    var why = 'the direct route is ' + Math.round(len) + ' m for a ' + Math.round(chord) + ' m gap, starts ' + Math.round(direct[0].startOffDeg) + ' deg off the aircraft\'s axis and turns ' + Math.round(directTurn) + ' deg' + (directWarns ? ' (and warns)' : '') + '; ';
    return { waypoints: ensureTerminal(pre.concat([best.pin, end])), added: true, info: why + 'added a turnaround pin ' + (best.along >= 0 ? best.along + ' m ahead of' : -best.along + ' m behind') + ' the nose and ' + Math.abs(best.side) + ' m ' + (best.side >= 0 ? 'right' : 'left') + ' (' + feasible + '/' + tried + ' candidates workable)' };
  }

  // Re-work the turnaround pin for a route: drop any the planner added earlier, then add one if the route needs it.
  function withTurnaroundPin(origin, waypoints) {
    var stripped = ensureTerminal(waypoints.filter(function (w) { return w.label !== TURNAROUND_PIN_LABEL; }));
    var r = addHelperPinIfNeeded(origin, stripped);
    var next = r.added ? r.waypoints : stripped;
    var same = next.length === waypoints.length && next.every(function (w, i) { return Math.abs(w.lat - waypoints[i].lat) < 1e-8 && Math.abs(w.lon - waypoints[i].lon) < 1e-8 && w.label === waypoints[i].label; });
    return { waypoints: same ? waypoints : next, added: r.added, changed: !same, info: r.info };
  }

  return {
    PATH_TURN_RADIUS_M: PATH_TURN_RADIUS_M, getRadius: function () { return turnRadiusM; }, setRadius: function (r) { turnRadiusM = r; }, TURNAROUND_PIN_LABEL: TURNAROUND_PIN_LABEL, MIN_LEAD_IN_M: MIN_LEAD_IN_M, MAX_LEAD_IN_M: MAX_LEAD_IN_M,
    filletPath: filletPath, plannedRouteSegments: plannedRouteSegments, segmentWarning: segmentWarning, pathLengthM: pathLengthM, pathTurnDeg: pathTurnDeg,
    plannedPinHeadings: plannedPinHeadings, addHelperPinIfNeeded: addHelperPinIfNeeded, withTurnaroundPin: withTurnaroundPin, ensureTerminal: ensureTerminal
  };
})();
