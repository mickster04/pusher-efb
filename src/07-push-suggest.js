// Suggested pushbacks: a port of the original app's apps/windows/src/taxiSuggest.ts, built on the route planner in 06-route-planner.js.
//
// Same logic as the original: the nearest named taxiways, links and apron lanes; end pins slid along the centreline to where the planner
// says the tug can get there (turn radius, forward/reverse, hairpin detection, turnaround pins); "straight back to the taxiway"; "back
// then along it either way" following bends, with clear-of-link variants; the opposite direction; compass-pointing options; and the
// stand-connector fallback for airports with no named taxiways. Only options that plan without a warning are offered.
//
// Differences from the TypeScript: ES5 style, plain objects instead of Map/Set, PS.geo for the maths, and the layout is built from the
// EFB's extracted items (PS.taxi.extract: rawType and rawName are the sim's values) by layoutFrom.
//
// Suggestion: { id, title, detail, waypoints, route (planned line, [[lat, lon], ...]), segments, lengthM, facingDeg, warning }

PS.suggest = (function () {
  var G = PS.geo, P = PS.planner;
  var M_PER_DEG = 111320;
  var MAX_DIST_M = 250;            // taxiways further than this from the aircraft are not offered
  var MAX_TAXIWAYS = 2;            // how many different taxiways are offered (each in both directions)
  var SAMPLE_STEP_M = 8;           // end pins are tried every this far along the centreline
  var TURN_TRIES = 6;              // cheapest end points tried with their heading honoured when none arrives lined up
  var MAX_PUSH_FLOOR_M = 130;      // options longer than max(this, MAX_PUSH_FACTOR x the cheapest) are dropped
  var MAX_PUSH_FACTOR = 1.7;
  var MAX_CLEAR_PUSH_M = 200;      // ...except options that end clear of a link
  var MIN_DIST_M = 15;             // an end pin closer than this to the aircraft is not worth offering
  var MAX_ARRIVAL_OFF_DEG = 25;    // the path must arrive within this of the taxiway heading
  var COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  var LANE_KEY = '\u0001lane';
  var LANE_MAX_DIST_M = 200;
  var LINK_MAX_DIST_M = 200;
  var MAX_LINKS = 2;
  var JOIN_M = 3;
  var MAX_CHAIN_M = 300;
  var CONNECTOR_START_M = 40;
  var ENTRY_OFFSET_M = 20;         // first pin of a back-then-along plan sits this far along the taxiway
  var CLEAR_OF_LINK_M = 45;        // the aircraft's reference point ends this far past a link's junction with the taxiway
  var OPPOSITE_ALONG_M = [0, 20, -20, 40, -40];
  var CARDINAL_HEADINGS = [0, 90, 180, 270];
  var POINT_ALONG_M = [0, 20, -20, 40, -40];
  var JOIN_TAXI_M = 3;
  var MAX_WALK_M = 160;

  var idCounter = 0;
  function nextId() { idCounter++; return Date.now() + '-' + idCounter; }
  function wrap360(d) { return G.normDeg(d); }
  function wrap180(d) { return G.angleDiff(0, d); }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function initialBearing(a, b, c, d) { return G.bearingDeg(a, b, c, d); }
  function destPoint(lat, lon, brg, d) { return G.offset(lat, lon, brg, d); }
  function compass(deg) { return COMPASS[Math.round(wrap360(deg) / 45) % 8]; }
  function pad3(n) { var s = String(Math.round(wrap360(n))); while (s.length < 3) s = '0' + s; return s; }
  function extend(o, more) { var r = {}, k; for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; } if (more) { for (k in more) { if (Object.prototype.hasOwnProperty.call(more, k)) r[k] = more[k]; } } return r; }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } }); return out; }
  function dirKeyOfHdg(h) { return Math.round(wrap360(h) / 45) % 8; }

  // ---- path classification (the sim stores taxiways as TAXI (1) at some airports and PATH (4) at others; LINK names are apron connectors) ----
  function nm(p) { return String(p.name === undefined || p.name === null ? '' : p.name).trim(); }
  function isLinkName(key) { return /^link\b/i.test(key); }
  function isTaxiwayPath(p) { var n = nm(p); return (p.type === 1 || p.type === 4) && p.points.length >= 2 && !!n && !isLinkName(n); }
  function isLanePath(p) { return (p.type === 1 || p.type === 4) && p.points.length >= 2 && !nm(p); }
  function isNamedPath(p) { return (p.type === 1 || p.type === 4) && p.points.length >= 2 && !!nm(p); }
  function isLink(p) { return (p.type === 1 || p.type === 4) && isLinkName(nm(p)); }
  function inGroup(p, key) {
    if (key === LANE_KEY) return isLanePath(p);
    if (isLinkName(key)) return isNamedPath(p) && nm(p) === key;
    return isTaxiwayPath(p) && nm(p) === key;
  }
  function groupTitle(key) { return key === LANE_KEY ? 'Apron lane' : (isLinkName(key) ? key : 'Taxiway ' + key); }
  function groupWhere(key) { return key === LANE_KEY ? 'the apron lane' : (isLinkName(key) ? key : 'taxiway ' + key); }
  function maxDistFor(key) { return key === LANE_KEY || isLinkName(key) ? LANE_MAX_DIST_M : MAX_DIST_M; }
  function kindOf(name) { return name === LANE_KEY ? 'lane' : (isLinkName(name) ? 'link' : 'taxiway'); }

  // Layout in the original's shape from the extracted items: only taxi-module paths (they carry the sim's raw type), split into
  // two-point stretches. Parking is passed through.
  function layoutFrom(items, parking) {
    var paths = [];
    (items || []).forEach(function (it) {
      var type = it.rawType;
      if (type === undefined || type === null) type = it.category === 'Taxiway' ? 1 : (it.category === 'Parking connector' ? 3 : null);
      if (type === null || !it.points || it.points.length < 2) return;
      var name = it.rawName !== undefined ? it.rawName : (it.name === '(unnamed)' ? '' : (it.name || ''));
      for (var i = 0; i + 1 < it.points.length; i++) paths.push({ name: String(name), type: type, widthM: it.widthM || 0, points: [it.points[i], it.points[i + 1]] });
    });
    return { paths: paths, parking: parking || [] };
  }

  // ---- geometry helpers ([lat, lon] points) ----
  function distM(a, b) {
    var cos = Math.cos(a[0] * Math.PI / 180);
    return hyp((b[1] - a[1]) * M_PER_DEG * cos, (b[0] - a[0]) * M_PER_DEG);
  }

  // The closest point on one straight stretch of centreline to the aircraft, and which way the stretch runs there.
  function nearestOnPath(a, b, lat, lon) {
    var cos = Math.cos(lat * Math.PI / 180);
    function toXy(p) { return { x: (p[1] - lon) * M_PER_DEG * cos, y: (p[0] - lat) * M_PER_DEG }; }
    var pa = toXy(a), pb = toXy(b);
    var dx = pb.x - pa.x, dy = pb.y - pa.y;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1) return null;
    var t = Math.max(0, Math.min(1, -(pa.x * dx + pa.y * dy) / len2));
    var x = pa.x + t * dx, y = pa.y + t * dy;
    return { name: '', lat: lat + y / M_PER_DEG, lon: lon + x / (M_PER_DEG * cos), distM: hyp(x, y), bearingDeg: initialBearing(a[0], a[1], b[0], b[1]) };
  }

  // ---- planner questions ----
  // A end pin whose heading has to be honoured: plan it with the heading set so the path curves in along it, let the planner add a
  // turnaround pin if one leg cannot do it, and accept it only if nothing is tight.
  function evaluateWithTurn(ac, lat, lon, hdg, leadInM) {
    var end = { id: 'wp-taxi-' + nextId() + '-' + Math.round(hdg), label: 'End position', lat: lat, lon: lon, seq: 0, terminal: true,
      headingDeg: Math.round(wrap360(hdg)), headingUser: true, drive: 'auto' };
    if (leadInM !== undefined && leadInM !== null) end.leadInM = leadInM;
    var origin = { lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg };
    var r = P.withTurnaroundPin(origin, [end]);
    var segs = P.plannedRouteSegments(origin, r.waypoints);
    if (!segs.length || segs.some(function (g) { return P.segmentWarning(g) !== null; })) return null;
    var cost = 0;
    segs.forEach(function (g) { cost += P.pathLengthM(g.points); });
    return { waypoints: r.waypoints, costM: cost, pinAdded: r.added };
  }

  // Plan the single leg to a trial end pin the way the app will, and say whether the tug can make it.
  function evaluate(ac, lat, lon, hdg) {
    var segs = P.plannedRouteSegments({ lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg }, [{ lat: lat, lon: lon, headingDeg: hdg, headingUser: false, drive: 'auto' }]);
    if (segs.length !== 1) return null;
    var s = segs[0];
    var arrivalOffDeg = Math.abs(wrap180(s.endHdgDeg - hdg));
    var pathOk = P.segmentWarning(s) === null;
    return { costM: P.pathLengthM(s.points), arrivalOffDeg: arrivalOffDeg, pathOk: pathOk, clean: pathOk && arrivalOffDeg <= MAX_ARRIVAL_OFF_DEG };
  }

  // ---- tail axis (the line straight back from the aircraft) ----
  // Distance back along the tail axis to the first path (among those `pick` accepts) it crosses, if within range.
  function tailAxisHit(layout, ac, pick) {
    var cos = Math.cos(ac.lat * Math.PI / 180);
    var back = wrap360(ac.hdgDeg + 180) * Math.PI / 180;
    var dx = Math.sin(back), dy = Math.cos(back);
    var hit = null;
    layout.paths.forEach(function (p) {
      if (!pick(p) || p.points.length < 2) return;
      var ax = (p.points[0][1] - ac.lon) * M_PER_DEG * cos, ay = (p.points[0][0] - ac.lat) * M_PER_DEG;
      var bx = (p.points[1][1] - ac.lon) * M_PER_DEG * cos, by = (p.points[1][0] - ac.lat) * M_PER_DEG;
      var ex = bx - ax, ey = by - ay;
      var den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-6) return;
      var t = (ax * ey - ay * ex) / den;           // distance back along the tail axis
      var u = (ax * dy - ay * dx) / den;           // position along the centreline stretch
      // A little slack on u: the tail axis often passes exactly through the joint between two stretches, and rounding must not drop it.
      if (u < -1e-4 || u > 1 + 1e-4 || t < MIN_DIST_M || t > MAX_DIST_M) return;
      if (!hit || t < hit.t) {
        hit = { t: t, name: nm(p), lat: ac.lat + (dy * t) / M_PER_DEG, lon: ac.lon + (dx * t) / (M_PER_DEG * cos),
          bearing: initialBearing(p.points[0][0], p.points[0][1], p.points[1][0], p.points[1][1]), segA: [p.points[0][0], p.points[0][1]], segB: [p.points[1][0], p.points[1][1]] };
      }
    });
    return hit;
  }

  // A straight push back along the aircraft's tail axis to where it meets the nearest named taxiway centreline; the nose stays as it is.
  function straightBackToTaxiway(layout, ac, ok, key) {
    var hit = tailAxisHit(layout, ac, function (p) { return key ? inGroup(p, key) : isTaxiwayPath(p); });
    if (!hit || (key && maxDistFor(key) < hit.t)) return null;
    var hdg = Math.round(wrap360(ac.hdgDeg));
    if (!ok(hit.lat, hit.lon, hdg)) return null;
    var wp = { id: 'wp-taxi-' + nextId() + '-back', label: 'End position', lat: hit.lat, lon: hit.lon, seq: 0, terminal: true, headingDeg: hdg, headingUser: false, drive: 'auto' };
    return {
      group: key === LANE_KEY ? 'lane' : (key && isLinkName(key) ? 'link' : 'taxiway'), kind: 'straight',
      id: 'taxi-straight-' + (key === LANE_KEY ? 'lane' : hit.name.replace(/\s+/g, '')) + '-' + Math.round(hit.lat * 1e5),
      title: key === LANE_KEY ? 'Straight back to the apron lane' : (key && isLinkName(key) ? 'Straight back to ' + hit.name : 'Straight back to taxiway ' + hit.name),
      detail: Math.round(hit.t) + ' m straight back; the nose stays ' + pad3(hdg) + '°',
      waypoints: P.ensureTerminal([wp])
    };
  }

  // ---- walking along a taxiway ----
  // Walk along a taxiway from a point on one of its stretches, following the connected stretches through its bends, until maxDist
  // metres of path are covered (or it ends). Returns the vertices from the start point on.
  function walkAlong(same, start, segA, segB, forward, maxDist) {
    var pts = [start];
    var cur = forward ? segB : segA;
    var from = start;
    pts.push(cur);
    var dist = distM(start, cur);
    var used = [];
    same.forEach(function (p) { if (distM(p.points[0], segA) <= 0.5 && distM(p.points[1], segB) <= 0.5) used.push(p); });
    for (var guard = 0; guard < 80 && dist < maxDist; guard++) {
      var inBr = initialBearing(from[0], from[1], cur[0], cur[1]);
      var best = null;
      for (var i = 0; i < same.length; i++) {
        var p = same[i];
        if (used.indexOf(p) >= 0) continue;
        var nearA = distM(cur, p.points[0]) <= JOIN_TAXI_M, nearB = distM(cur, p.points[1]) <= JOIN_TAXI_M;
        if (!nearA && !nearB) continue;
        var far = nearA ? p.points[1] : p.points[0];
        var br = initialBearing(cur[0], cur[1], far[0], far[1]);
        // No incoming direction while the start sits on a stretch's end (the bearing of a near-zero vector is arbitrary).
        var turn = isFinite(inBr) && isFinite(br) && distM(from, cur) > 0.5 ? Math.abs(wrap180(br - inBr)) : 0;
        if (!best || turn < best.turn) best = { p: p, far: far, turn: turn };
      }
      if (!best || best.turn > 100) break;       // the taxiway ends, or doubles back
      used.push(best.p);
      from = cur;
      cur = best.far;
      pts.push(cur);
      dist += distM(from, cur);
    }
    return pts;
  }

  // The point d metres along a polyline, and which way it runs there; null if the polyline is shorter.
  function pointAlong(pts, d) {
    var acc = 0;
    for (var i = 0; i + 1 < pts.length; i++) {
      var len = distM(pts[i], pts[i + 1]);
      if (acc + len >= d - 1e-6 && len > 1e-6) {
        var f = (d - acc) / len;
        return { lat: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, lon: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f, brg: initialBearing(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) };
      }
      acc += len;
    }
    return null;
  }

  // How far along a polyline the point nearest q is, if q is within tol metres of it.
  function distanceAlong(pts, q, tol) {
    var acc = 0, best = null;
    for (var i = 0; i + 1 < pts.length; i++) {
      var n = nearestOnPath(pts[i], pts[i + 1], q[0], q[1]);
      if (n && n.distM <= tol) {
        var here = acc + distM(pts[i], [n.lat, n.lon]);
        if (best === null || here < best) best = here;
      }
      acc += distM(pts[i], pts[i + 1]);
    }
    return best;
  }

  // Push straight back to where the tail axis meets the taxiway, then along it in either direction, following its bends: pins a little
  // way along it, at each bend, and at the end point, all on auto heading. A variant ends far enough along to be clear of a link that
  // joins the taxiway there, so the aircraft isn't left across it.
  function alongTaxiwayOptions(layout, ac, name) {
    var hit = tailAxisHit(layout, ac, function (p) { return inGroup(p, name); });
    if (!hit || !isFinite(hit.bearing)) return [];
    var same = layout.paths.filter(function (p) { return inGroup(p, name); });
    var start = [hit.lat, hit.lon];
    var fwdPts = walkAlong(same, start, hit.segA, hit.segB, true, MAX_WALK_M);
    var backPts = walkAlong(same, start, hit.segA, hit.segB, false, MAX_WALK_M);
    // Links that join this taxiway (their end on it), for the clear-of-link variant.
    var junctions = [];
    layout.paths.forEach(function (l) {
      if (!isLink(l) || l.points.length < 2) return;
      l.points.slice(0, 2).forEach(function (pt) {
        var onIt = distanceAlong(fwdPts, [pt[0], pt[1]], 4) !== null || distanceAlong(backPts, [pt[0], pt[1]], 4) !== null;
        if (onIt) junctions.push({ name: nm(l), at: [pt[0], pt[1]] });
      });
    });
    var out = [];
    [[fwdPts, backPts], [backPts, fwdPts]].forEach(function (pair) {
      var pts = pair[0], otherPts = pair[1];
      // How far along this direction each junction lies (negative: behind).
      var along = junctions.map(function (j) {
        var ahead = distanceAlong(pts, j.at, 4), behind = distanceAlong(otherPts, j.at, 4);
        return { name: j.name, at: j.at, s: ahead !== null ? ahead : (behind !== null ? -behind : NaN) };
      }).filter(function (j) { return isFinite(j.s) && Math.abs(j.s) <= 80; }).sort(function (x, y) { return Math.abs(x.s) - Math.abs(y.s); });
      var variants = [{ d: 60 }, { d: 80 }, { d: 110 }];
      if (along[0]) variants.push({ d: Math.max(60, Math.round(CLEAR_OF_LINK_M + along[0].s + ENTRY_OFFSET_M)), clearOf: along[0].name });
      // A variant that is already clear of the link need not be listed twice (insertion order kept, later keys merge into earlier).
      var merged = [];
      variants.forEach(function (v) {
        for (var q = 0; q < merged.length; q++) { if (merged[q].d === v.d) { merged[q] = extend(merged[q], v); return; } }
        merged.push(extend(v));
      });
      merged.forEach(function (v) {
        if (v.d > MAX_WALK_M) return;
        var entry = pointAlong(pts, ENTRY_OFFSET_M);
        var end = pointAlong(pts, v.d);
        if (!entry || !end) return;     // the taxiway is shorter than this variant
        // Pins: a little way along it (not exactly where the tail axis meets it: a taxiway at right angles to the push would make the
        // second leg exactly 90 degrees from the nose, where the forward/reverse rule can flip to a stop-and-go), each real bend
        // between there and the end, then the end point.
        var pins = [[entry.lat, entry.lon]];
        var acc = 0;
        for (var i = 1; i + 1 < pts.length; i++) {
          acc += distM(pts[i - 1], pts[i]);
          if (acc <= ENTRY_OFFSET_M + 3 || acc >= v.d - 3) continue;
          var inB = initialBearing(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
          var outB = initialBearing(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (isFinite(inB) && isFinite(outB) && Math.abs(wrap180(outB - inB)) >= 4) pins.push(pts[i]);
        }
        pins.push([end.lat, end.lon]);
        var wps = P.ensureTerminal(pins.map(function (pt, k) {
          return { id: 'wp-taxi-' + nextId() + '-' + k, label: k === pins.length - 1 ? 'End position' : 'Waypoint ' + (k + 1), lat: pt[0], lon: pt[1], seq: k, terminal: k === pins.length - 1, headingDeg: null, drive: 'auto' };
        }));
        var segs = P.plannedRouteSegments({ lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg }, wps);
        if (!segs.length || segs.some(function (g) { return P.segmentWarning(g) !== null; })) return;
        // The nose the plan ends with is the heading the end pin gets (on auto), so the two always agree.
        var facing = wrap360(segs[segs.length - 1].endHdgDeg);
        wps[wps.length - 1].headingDeg = Math.round(facing);
        var cost = 0;
        segs.forEach(function (g) { cost += P.pathLengthM(g.points); });
        cost += 20 * (segs.length - 1);
        var h = Math.round(facing);
        out.push({
          name: name, lat: end.lat, lon: end.lon, hdg: facing, costM: cost, arrivalOffDeg: 0, clean: true, pathOk: true,
          turn: { waypoints: wps, costM: cost, pinAdded: false },
          title: groupTitle(name) + ', facing ' + compass(h) + (v.clearOf ? ', clear of ' + v.clearOf : ''),
          detail: Math.round(cost) + ' m: straight back to ' + groupWhere(name) + ', then ' + v.d + ' m along it' + (pins.length > 2 ? ' (round its bend' + (pins.length > 3 ? 's' : '') + ')' : '') +
            (v.clearOf ? ', ending beyond ' + v.clearOf + " so the link isn't blocked" : '') + '; ends facing ' + pad3(h) + '°'
        });
      });
    });
    return out;
  }

  // The other way along the taxiway: for each offered end point, try the opposite heading at the same spot and a little either side
  // along the taxiway, and offer the cheapest that plans cleanly, unless something within 30 degrees of that heading is already offered.
  function oppositeOptions(layout, ac, name, mine) {
    if (!mine.length) return [];
    var same = layout.paths.filter(function (p) { return inGroup(p, name); });
    function onTaxiway(lat, lon) {
      return same.some(function (p) { var n = nearestOnPath(p.points[0], p.points[1], lat, lon); return (n ? n.distM : Infinity) <= 4; });
    }
    var have = mine.map(function (c) { return c.hdg; });
    var out = [];
    mine.forEach(function (c) {
      var opp = wrap360(c.hdg + 180);
      if (have.some(function (h) { return Math.abs(wrap180(h - opp)) < 30; }) || out.some(function (o) { return Math.abs(wrap180(o.hdg - opp)) < 30; })) return;
      var best = null;
      OPPOSITE_ALONG_M.forEach(function (along) {
        var ll = along === 0 ? [c.lat, c.lon] : destPoint(c.lat, c.lon, c.hdg, along);
        if (along !== 0 && !onTaxiway(ll[0], ll[1])) return;
        var leads = [undefined, 20, 10];
        for (var li = 0; li < leads.length; li++) {
          var t = evaluateWithTurn(ac, ll[0], ll[1], opp, leads[li]);
          if (!t) continue;
          if (!best || t.costM < best.costM) {
            best = { name: name, lat: ll[0], lon: ll[1], hdg: opp, costM: t.costM, arrivalOffDeg: 0, clean: true, pathOk: true, turn: t,
              title: groupTitle(name) + ', facing ' + compass(Math.round(opp)),
              detail: Math.round(t.costM) + ' m of push; ends on the centreline heading ' + pad3(Math.round(opp)) + '° along it' + (t.pinAdded ? ', with a turnaround pin to get lined up' : ', curving in to line up') };
          }
          break;
        }
      });
      if (best) out.push(best);
    });
    return out;
  }

  // Pointing options: the end pin sits on the taxiway (at, or a little along from, where the tail axis meets it) and is rotated to face
  // north, east, south or west. Only offered when the plan is clean (a shorter final straight is tried when the default one loops).
  function pointOptions(layout, ac, name, haveHeadings) {
    var hit = tailAxisHit(layout, ac, function (p) { return inGroup(p, name); });
    if (!hit || !isFinite(hit.bearing)) return [];
    var same = layout.paths.filter(function (p) { return inGroup(p, name); });
    function onTaxiway(lat, lon) {
      return same.some(function (p) { var n = nearestOnPath(p.points[0], p.points[1], lat, lon); return (n ? n.distM : Infinity) <= 4; });
    }
    var out = [];
    CARDINAL_HEADINGS.forEach(function (hdg) {
      if (haveHeadings.some(function (h) { return Math.abs(wrap180(h - hdg)) < 30; })) return;   // already offered
      var best = null;
      POINT_ALONG_M.forEach(function (along) {
        var ll = along === 0 ? [hit.lat, hit.lon] : destPoint(hit.lat, hit.lon, hit.bearing, along);
        if (along !== 0 && !onTaxiway(ll[0], ll[1])) return;
        var leads = [undefined, 20, 10];
        for (var li = 0; li < leads.length; li++) {
          var t = evaluateWithTurn(ac, ll[0], ll[1], hdg, leads[li]);
          if (!t) continue;
          if (!best || t.costM < best.costM) {
            best = { name: name, lat: ll[0], lon: ll[1], hdg: hdg, costM: t.costM, arrivalOffDeg: 0, clean: true, pathOk: true, turn: t,
              title: groupTitle(name) + ', pointing ' + compass(hdg),
              detail: Math.round(t.costM) + ' m: back to ' + groupWhere(name) + ', ending on it turned to point ' + compass(hdg) + ' (' + Math.round(Math.abs(wrap180(hdg - ac.hdgDeg))) + '° from the nose)' + (t.pinAdded ? ', with a turnaround pin' : '') };
          }
          break;      // the longest straight that plans for this position
        }
      });
      if (best) out.push(best);
    });
    return out;
  }

  // The stand the aircraft is on: the nearest parking spot, if the aircraft is within (about) its radius.
  function currentStand(layout, ac) {
    if (!layout || !ac || !layout.parking || !layout.parking.length) return null;
    var cos = Math.cos(ac.lat * Math.PI / 180), best = null;
    layout.parking.forEach(function (k) {
      if (typeof k.lat !== 'number' || typeof k.lon !== 'number') return;
      var d = hyp((k.lon - ac.lon) * M_PER_DEG * cos, (k.lat - ac.lat) * M_PER_DEG);
      var within = d <= Math.max(25, (k.radiusM || 0) * 1.2);
      if (within && (!best || d < best.distM)) best = { name: k.name, lat: k.lat, lon: k.lon, distM: d, headingDeg: k.headingDeg };
    });
    return best;
  }

  // For airports with no named taxiways: follow the stand's connector (the sim's lead-in from the stand to the taxiway network) to where
  // it joins the taxiway, and offer to push there, heading along the taxiway there (or across the connector when the sim gives no
  // direction). The place is a guess that it is a taxiway, labelled as such.
  function suggestFromStandConnector(layout, ac) {
    var here = [ac.lat, ac.lon];
    var stand = currentStand(layout, ac);
    var origin = stand ? [stand.lat, stand.lon] : here;
    var links = layout.paths.filter(function (p) { return (p.type === 1 || p.type === 3 || p.type === 4) && p.points.length >= 2; });
    var connectors = links.filter(function (p) { return p.type === 3 && Math.min(distM(origin, p.points[0]), distM(origin, p.points[1])) <= (stand ? 15 : CONNECTOR_START_M); });
    var out = [];
    var seen = {};
    var acNow = { lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg };
    connectors.forEach(function (c) {
      // Walk from the stand along unnamed links to the end of the spur.
      var cur = distM(origin, c.points[0]) <= distM(origin, c.points[1]) ? c.points[1] : c.points[0];
      var prevDir = initialBearing(origin[0], origin[1], cur[0], cur[1]);
      var used = [c];
      var walked = distM(origin, cur);
      for (var guard = 0; guard < 40 && walked < MAX_CHAIN_M; guard++) {
        var next = links.filter(function (p) { return used.indexOf(p) < 0 && (distM(cur, p.points[0]) <= JOIN_M || distM(cur, p.points[1]) <= JOIN_M); });
        // Stop at a junction, a named taxiway or the end of the line.
        if (next.length !== 1 || nm(next[0])) break;
        var n = next[0];
        var far = distM(cur, n.points[0]) <= JOIN_M ? n.points[1] : n.points[0];
        used.push(n);
        prevDir = initialBearing(cur[0], cur[1], far[0], far[1]);
        walked += distM(cur, far);
        cur = far;
      }
      // Headings there: along whatever joins the end (both ways), else across the connector.
      var headings = [];
      links.forEach(function (p) {
        if (used.indexOf(p) >= 0) return;
        [[p.points[0], p.points[1]], [p.points[1], p.points[0]]].forEach(function (pair) {
          if (distM(cur, pair[0]) <= JOIN_M) {
            var brg = initialBearing(cur[0], cur[1], pair[1][0], pair[1][1]);
            if (isFinite(brg)) { headings.push(Math.round(wrap360(brg))); headings.push(Math.round(wrap360(brg + 180))); }
          }
        });
      });
      headings = uniq(headings);
      // Pushing straight back to that point, nose unchanged, is always worth offering first.
      var straightHdg = Math.round(wrap360(ac.hdgDeg));
      var straightEv = evaluate(acNow, cur[0], cur[1], straightHdg);
      if (straightEv && straightEv.pathOk) {
        var skey = Math.round(cur[0] * 1e5) + '-' + Math.round(cur[1] * 1e5) + '-straight';
        if (!seen[skey]) {
          seen[skey] = true;
          out.push({
            group: 'connector', kind: 'straight', id: 'taxi-conn-' + skey, title: 'Straight back to the end of the stand connector',
            detail: Math.round(straightEv.costM) + " m of push to where the stand's lead-in meets the taxiway (no named taxiway here, so this is a guess); the nose stays " + pad3(straightHdg) + '°',
            waypoints: P.ensureTerminal([{ id: 'wp-taxi-' + nextId() + '-back', label: 'End position', lat: cur[0], lon: cur[1], seq: 0, terminal: true, headingDeg: straightHdg, headingUser: false, drive: 'auto' }])
          });
        }
      }
      if (!headings.length && isFinite(prevDir)) { headings.push(Math.round(wrap360(prevDir + 90))); headings.push(Math.round(wrap360(prevDir - 90))); }
      headings.forEach(function (hdg) {
        var key = Math.round(cur[0] * 1e5) + '-' + Math.round(cur[1] * 1e5) + '-' + dirKeyOfHdg(hdg);
        if (seen[key]) return;
        seen[key] = true;
        var ev = evaluate(acNow, cur[0], cur[1], hdg);
        if (!ev) return;
        if (!ev.clean) {
          var t = evaluateWithTurn(acNow, cur[0], cur[1], hdg);
          if (t) {
            out.push({
              group: 'connector', kind: 'along', id: 'taxi-conn-' + key, title: 'End of the stand connector, facing ' + compass(hdg),
              detail: Math.round(t.costM) + " m of push to where the stand's lead-in meets the taxiway (no named taxiway here, so this is a guess); heading " + pad3(hdg) + '°' + (t.pinAdded ? ', with a turnaround pin to get lined up' : ', curving in to line up'),
              waypoints: t.waypoints
            });
          }
        }
        // Not clean even with a turnaround pin or a curve: not offered.
      });
    });
    return out.slice(0, 4);
  }

  // ---- the suggester ----
  // Default pushbacks that end on the nearest taxiways: per taxiway and direction, the cheapest end pin the planner says the tug can reach,
  // plus straight back, back-then-along, the opposite direction and compass-pointing options.
  function suggestPushbacks(layout, ac) {
    if (!layout || !ac || !isFinite(ac.lat) || !isFinite(ac.lon)) return [];
    var cos = Math.cos(ac.lat * Math.PI / 180);

    // Which taxiways are close, by name, nearest first.
    var near = {};
    layout.paths.forEach(function (p) {
      // Only named taxiways: an unnamed path is a spur or connector, not somewhere to push to.
      if (!isTaxiwayPath(p)) return;
      var n = nearestOnPath(p.points[0], p.points[1], ac.lat, ac.lon);
      if (!n || n.distM > MAX_DIST_M) return;
      var key = nm(p);
      near[key] = Math.min(near[key] === undefined ? Infinity : near[key], n.distM);
    });
    var named = Object.keys(near).sort(function (x, y) { return near[x] - near[y]; }).slice(0, MAX_TAXIWAYS);
    // Apron lanes: taxiway-type paths with no name, offered after the named taxiways.
    var laneNear = false;
    for (var li = 0; li < layout.paths.length; li++) {
      var lp = layout.paths[li];
      if (!isLanePath(lp)) continue;
      var ln = nearestOnPath(lp.points[0], lp.points[1], ac.lat, ac.lon);
      if (ln && ln.distM <= LANE_MAX_DIST_M) { laneNear = true; break; }
    }
    // Links: the nearest by name.
    var linkNear = {};
    layout.paths.forEach(function (p) {
      if (!isNamedPath(p) || !isLinkName(nm(p))) return;
      var n = nearestOnPath(p.points[0], p.points[1], ac.lat, ac.lon);
      if (!n || n.distM > LINK_MAX_DIST_M) return;
      var k = nm(p);
      linkNear[k] = Math.min(linkNear[k] === undefined ? Infinity : linkNear[k], n.distM);
    });
    var links = Object.keys(linkNear).sort(function (x, y) { return linkNear[x] - linkNear[y]; }).slice(0, MAX_LINKS);
    var names = named.concat(laneNear ? [LANE_KEY] : [], links);
    // Some airports have nothing to push to by name or lane: then use where the stand's connector meets the taxiway network instead.
    if (!names.length) return suggestFromStandConnector(layout, ac);

    var out = [];   // { cand, score }
    names.forEach(function (name) {
      // Best end pin per direction along this taxiway: the cheapest clean one, else the least bad.
      var bestClean = {}, bestAny = {}, misses = [];
      var cleanOrder = [], anyOrder = [];   // first-insertion order of each map (the original's Map iterates in that order, objects would sort numeric keys)
      function dirKeyOf(c) { return dirKeyOfHdg(c.hdg); }
      layout.paths.forEach(function (p) {
        if (!inGroup(p, name)) return;
        var a = p.points[0], b = p.points[1];
        var dx = (b[1] - a[1]) * M_PER_DEG * cos, dy = (b[0] - a[0]) * M_PER_DEG;
        var len = hyp(dx, dy);
        var brg = initialBearing(a[0], a[1], b[0], b[1]);
        if (len < 1 || !isFinite(brg)) return;
        var steps = Math.max(1, Math.round(len / (name === LANE_KEY || isLinkName(name) ? SAMPLE_STEP_M * 2 : SAMPLE_STEP_M)));
        for (var k = 0; k <= steps; k++) {
          var t = k / steps;
          var lat = a[0] + (b[0] - a[0]) * t, lon = a[1] + (b[1] - a[1]) * t;
          var dist = hyp((lon - ac.lon) * M_PER_DEG * cos, (lat - ac.lat) * M_PER_DEG);
          if (dist < MIN_DIST_M || dist > maxDistFor(name)) continue;
          [brg, wrap360(brg + 180)].forEach(function (hdg) {
            var dirKey = dirKeyOfHdg(hdg);
            var ev = evaluate(ac, lat, lon, hdg);
            if (!ev) return;
            var cand = extend(ev, { name: name, lat: lat, lon: lon, hdg: hdg });
            if (!ev.clean) misses.push(cand);
            var any = bestAny[dirKey];
            if (!any || ev.costM + ev.arrivalOffDeg * 2 < any.costM + any.arrivalOffDeg * 2) { if (!any) anyOrder.push(dirKey); bestAny[dirKey] = cand; }
            if (ev.clean) {
              var c = bestClean[dirKey];
              if (!c || ev.costM < c.costM) { if (!c) cleanOrder.push(dirKey); bestClean[dirKey] = cand; }
            }
          });
        }
      });
      // Where no end point arrives already lined up, try the best few with the heading honoured (curve in, turnaround pin if needed).
      uniq(misses.map(dirKeyOf)).forEach(function (dirKey) {
        if (bestClean[dirKey]) return;
        var tries = misses.filter(function (c) { return dirKeyOf(c) === dirKey && c.pathOk; }).sort(function (x, y) { return x.costM - y.costM; }).slice(0, TURN_TRIES);
        var bestTurn = null;
        tries.forEach(function (c) {
          var t = evaluateWithTurn(ac, c.lat, c.lon, c.hdg);
          if (t && (!bestTurn || t.costM < bestTurn.turn.costM)) bestTurn = extend(c, { costM: t.costM, arrivalOffDeg: 0, clean: true, pathOk: true, turn: t });
        });
        if (bestTurn) { cleanOrder.push(dirKey); bestClean[dirKey] = bestTurn; }
      });
      // Push back to the taxiway then along it comes first: per direction the cheapest plain one, and the cheapest that is clear of a link.
      var alongOpts = alongTaxiwayOptions(layout, ac, name);
      var covered = {};
      uniq(alongOpts.map(dirKeyOf)).forEach(function (dirKey) {
        var here = alongOpts.filter(function (c) { return dirKeyOf(c) === dirKey; });
        var plain = here.filter(function (c) { return c.title.indexOf('clear of') < 0; }).sort(function (x, y) { return x.costM - y.costM; })[0];
        var clear = here.filter(function (c) { return c.title.indexOf('clear of') >= 0; }).sort(function (x, y) { return x.costM - y.costM; })[0];
        [clear, plain].forEach(function (c) { if (c) out.push({ cand: c, score: c.costM }); });
        covered[dirKey] = true;
      });
      // Other directions (the taxiway bends away from the tail axis): the sampled end points.
      uniq(cleanOrder.concat(anyOrder)).forEach(function (dirKey) {
        if (covered[dirKey]) return;
        var cand = bestClean[dirKey] || bestAny[dirKey];
        out.push({ cand: cand, score: cand.costM + (cand.clean ? 0 : 1000) });
      });
      // Every direction offered along this taxiway comes with the opposite one (the other way along it), planned with the heading honoured
      // and a turnaround pin if one leg can't do it, so an option isn't offered one way and missing the other.
      var mine = out.filter(function (o) { return o.cand.name === name && o.cand.clean; }).map(function (o) { return o.cand; });
      oppositeOptions(layout, ac, name, mine).forEach(function (cand) { out.push({ cand: cand, score: cand.costM + 15 }); });
      // The end pin stays on this taxiway but points a compass direction that is not along it: the turn can be more than 90 degrees.
      // Only directions with no option already close to them are added, ranked after the along-the-taxiway ones.
      var have = out.filter(function (o) { return o.cand.name === name; }).map(function (o) { return o.cand.hdg; });
      pointOptions(layout, ac, name, have).forEach(function (cand) { out.push({ cand: cand, score: cand.costM + 25 }); });
    });

    // Pushing straight back until the tail meets the nearest named taxiway is often the best default: the nose stays as it is.
    function cleanAt(lat, lon, hdg) { var e = evaluate(ac, lat, lon, hdg); return !!e && e.clean === true; }
    var straight = straightBackToTaxiway(layout, ac, cleanAt);
    var straightLane = laneNear ? straightBackToTaxiway(layout, ac, cleanAt, LANE_KEY) : null;
    var straightLink = links.length > 0 ? straightBackToTaxiway(layout, ac, cleanAt, links[0]) : null;

    // Only end points the tug can reach without a warning are offered; if there are none, nothing is.
    var clean = out.filter(function (o) { return o.cand.clean; });
    // A long push is rarely what is wanted: drop options much further than the cheapest in their group.
    var straightHit = tailAxisHit(layout, ac, function (p) { return isTaxiwayPath(p); });
    var laneHit = laneNear ? tailAxisHit(layout, ac, function (p) { return isLanePath(p); }) : null;
    var linkHit = links.length > 0 ? tailAxisHit(layout, ac, function (p) { return isNamedPath(p) && links.indexOf(nm(p)) >= 0; }) : null;
    function pick(kind, hitT, limit) {
      var group = clean.filter(function (o) { return kindOf(o.cand.name) === kind; });
      var cheapest = Infinity;
      group.forEach(function (o) { if (o.cand.costM < cheapest) cheapest = o.cand.costM; });
      if (hitT !== undefined && hitT !== null && hitT < cheapest) cheapest = hitT;
      return group
        // (Options that get clear of a link are allowed to be a little longer: that is their point.)
        .filter(function (o) { return o.cand.costM <= Math.max(MAX_PUSH_FLOOR_M, MAX_PUSH_FACTOR * cheapest) || (o.cand.title && o.cand.title.indexOf('clear of') >= 0 && o.cand.costM <= MAX_CLEAR_PUSH_M); })
        .sort(function (x, y) { return x.score - y.score; })
        .slice(0, limit);
    }
    var namedChosen = pick('taxiway', straightHit ? straightHit.t : undefined, 5);
    var laneChosen = pick('lane', laneHit ? laneHit.t : undefined, 2);
    var linkChosen = pick('link', linkHit ? linkHit.t : undefined, 4);

    function toSuggestion(o) {
      var c = o.cand;
      var hdg = Math.round(wrap360(c.hdg));
      var key = c.name === LANE_KEY ? 'lane' : (c.name || 'x').replace(/\s+/g, '');
      var wps = c.turn ? c.turn.waypoints : P.ensureTerminal([{ id: 'wp-taxi-' + nextId() + '-' + hdg, label: 'End position', lat: c.lat, lon: c.lon, seq: 0, terminal: true, headingDeg: hdg, headingUser: !c.clean, drive: 'auto' }]);
      return {
        group: kindOf(c.name), kind: c.title && c.title.indexOf(', pointing ') >= 0 ? 'pointing' : 'along',
        id: 'taxi-' + key + '-' + hdg + '-' + Math.round(c.lat * 1e5),
        title: c.title || (groupTitle(c.name) + ', facing ' + compass(hdg) + (c.clean ? '' : ' (tight)')),
        detail: c.detail || (Math.round(c.costM) + ' m of push; ends on the centreline heading ' + pad3(hdg) + '° along it' + (c.turn ? (c.turn.pinAdded ? ', with a turnaround pin to get lined up' : ', curving in to line up') : '') + (c.clean ? '' : '. The tug may not manage this one: no cleaner end point found')),
        waypoints: wps
      };
    }
    var res = [];
    if (straight) res.push(straight);
    namedChosen.forEach(function (o) { res.push(toSuggestion(o)); });
    if (straightLane) res.push(straightLane);
    laneChosen.forEach(function (o) { res.push(toSuggestion(o)); });
    if (straightLink) res.push(straightLink);
    linkChosen.forEach(function (o) { res.push(toSuggestion(o)); });
    return res;
  }

  // The planned line, its length and the nose it ends with, for drawing and listing.
  function decorate(s, ac) {
    var origin = { lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg };
    var segs = P.plannedRouteSegments(origin, s.waypoints);
    var route = [[ac.lat, ac.lon]], len = 0, warning = null;
    segs.forEach(function (g) {
      g.points.forEach(function (pt, i) { if (!(i === 0 && route.length > 1)) route.push(pt); });
      len += P.pathLengthM(g.points);
      if (!warning) warning = P.segmentWarning(g);
    });
    var minR = Infinity, maxOff = 0;
    segs.forEach(function (g) { if (g.tightestRadiusM < minR) minR = g.tightestRadiusM; if (g.startOffDeg > maxOff) maxOff = g.startOffDeg; });
    s.tightestRadiusM = minR === Infinity ? P.PATH_TURN_RADIUS_M : minR; s.maxStartOffDeg = maxOff;
    s.segments = segs; s.route = route; s.lengthM = len; s.warning = warning;
    s.facingDeg = segs.length ? wrap360(segs[segs.length - 1].endHdgDeg) : wrap360(ac.hdgDeg);
    s.pins = s.waypoints.map(function (w) { return [w.lat, w.lon]; });
    return s;
  }

  // items: PS.taxi.extract items; ac: { lat, lon, hdgDeg }; parking: PS.taxi.extract parking. Returns decorated suggestions.
  // Differences from the original's list, chosen after trying it in the sim:
  //  - compass-pointing options ("Taxiway A, pointing north") are dropped: the along-the-taxiway options are what is wanted;
  //  - apron lanes and links are only offered when no named taxiway has an option;
  //  - an option whose tightest arc is under MIN_ARC_RADIUS_M, or whose first stretch starts more than MAX_START_OFF_DEG off the aircraft's
  //    axis, is left out (the planner accepts down to 60% of the tug radius, which draws as a cramped arc). If that would leave nothing,
  //    the unfiltered list (minus pointing) is used so there is still something to pick.
  var MIN_ARC_RADIUS_M = 32;
  var MAX_START_OFF_DEG = 45;
  function filterOptions(all) {
    var nonPointing = all.filter(function (s) { return s.kind !== 'pointing'; });
    var good = nonPointing.filter(function (s) { return s.tightestRadiusM >= MIN_ARC_RADIUS_M && s.maxStartOffDeg <= MAX_START_OFF_DEG; });
    var pool = good.length ? good : nonPointing;
    var onTaxiway = pool.some(function (s) { return s.group === 'taxiway'; });
    return onTaxiway ? pool.filter(function (s) { return s.group === 'taxiway'; }) : pool;
  }
  function suggest(items, ac, parking) {
    if (!ac || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return [];
    var list = suggestPushbacks(layoutFrom(items, parking), { lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg || 0 });
    var all = list.map(function (s) { return decorate(s, { lat: ac.lat, lon: ac.lon, hdgDeg: ac.hdgDeg || 0 }); });
    var kept = filterOptions(all);
    kept.forEach(function (s) { s.detail += '. Tightest arc ' + Math.round(s.tightestRadiusM) + ' m (tug turns at ' + P.PATH_TURN_RADIUS_M + ' m)'; });
    return kept;
  }

  return { suggest: suggest, suggestPushbacks: suggestPushbacks, layoutFrom: layoutFrom, currentStand: currentStand, compass: compass,
    isTaxiwayPath: isTaxiwayPath, isLanePath: isLanePath };
})();
