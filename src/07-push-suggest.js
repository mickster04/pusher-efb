// Suggested pushbacks, drawn on the plot. A SIMPLIFIED port of the original app's apps/windows/src/taxiSuggest.ts.
//
// What is ported: nearest named taxiways, apron links and lanes; "straight back to the taxiway" (the nose stays as it is);
// "back to the taxiway, then along it either way" (following its bends) with end points 60 m and 110 m along.
// What is not: the tug's path planner. The original asks it (plannedRouteSegments, withTurnaroundPin, segmentWarning) whether the
// tug can make each end point and adds turnaround pins; here a route is straight legs, and an option is dropped when the turn at
// the taxiway would be sharper than MAX_TURN_DEG. Also not ported: pointing at compass directions, the opposite-direction option
// that needs a turnaround, and the stand-connector fallback for airports with no named taxiways. See docs/implementation/pusher-internals.md.
//
// Geometry is done in metres east/north of the aircraft (x east, y north), then converted back to lat/lon for drawing.

PS.suggest = (function () {
  var G = PS.geo;
  var MAX_DIST_M = 250;       // named taxiways further than this are not offered
  var LANE_DIST_M = 200;      // links and lanes are dense, so a shorter reach
  var MIN_DIST_M = 15;        // an end closer than this to the aircraft is not worth offering
  var ENTRY_M = 20;           // first pin this far along the taxiway from where the tail axis meets it (not exactly at the junction)
  var MAX_WALK_M = 160;
  var JOIN_M = 3;             // stretches whose ends are within this are connected
  var MAX_TAXIWAYS = 2;
  var MAX_LINKS = 1;
  var MAX_TURN_DEG = 110;     // sharper than this between pushing back and going along the taxiway: not offered
  var VARIANT_M = [60, 110];  // end points this far along the taxiway
  var COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

  function compass(d) { return COMPASS[Math.round(G.normDeg(d) / 45) % 8]; }
  function dist(a, b) { var dx = b[0] - a[0], dy = b[1] - a[1]; return Math.sqrt(dx * dx + dy * dy); }
  function brg(a, b) { return G.normDeg(G.deg(Math.atan2(b[0] - a[0], b[1] - a[1]))); } // [x, y] points
  function pathLen(pts) { var t = 0; for (var i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; }
  function isLink(name) { return /^link\b/i.test(name); }
  function pad3(n) { var s = String(Math.round(G.normDeg(n))); while (s.length < 3) s = '0' + s; return s; }

  // Taxiway-type stretches only: type 1 (taxi) or 4 (path) with two or more points. Runways, parking connectors, paint and roads are left out.
  // Each item from PS.taxi.extract carries rawType and rawName; older data falls back to its category and name.
  function stretchesOf(items, ac) {
    var res = [];
    (items || []).forEach(function (it) {
      var type = it.rawType !== undefined ? it.rawType : (it.category === 'Taxiway' ? 1 : null);
      if ((type !== 1 && type !== 4) || !it.points || it.points.length < 2) return;
      var name = it.rawName !== undefined ? it.rawName : (it.name === '(unnamed)' ? '' : (it.name || ''));
      name = String(name).trim();
      var kind = !name ? 'lane' : (isLink(name) ? 'link' : 'taxiway');
      var xy = it.points.map(function (p) { var q = G.toXY(ac.lat, ac.lon, p[0], p[1]); return [q.x, q.y]; });
      for (var i = 0; i + 1 < xy.length; i++) res.push({ name: name, kind: kind, a: xy[i], b: xy[i + 1] });
    });
    return res;
  }

  // Distance from the aircraft (the origin) to a stretch.
  function distToStretch(s) {
    var dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? Math.max(0, Math.min(1, -(s.a[0] * dx + s.a[1] * dy) / len2)) : 0;
    var px = s.a[0] + t * dx, py = s.a[1] + t * dy;
    return Math.sqrt(px * px + py * py);
  }

  // Where the line straight back from the aircraft (along its tail axis) first meets one of `list`.
  function tailHit(list, backDir, maxT) {
    var dx = backDir[0], dy = backDir[1], hit = null;
    list.forEach(function (s) {
      var ex = s.b[0] - s.a[0], ey = s.b[1] - s.a[1];
      var den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-6) return;                     // parallel
      var t = (s.a[0] * ey - s.a[1] * ex) / den;            // distance back along the tail axis
      var u = (s.a[0] * dy - s.a[1] * dx) / den;            // position along the stretch
      // A little slack on u: the tail line often passes exactly through the joint between two stretches, and rounding must not drop it.
      if (u < -1e-4 || u > 1 + 1e-4 || t < MIN_DIST_M || t > maxT) return;
      if (!hit || t < hit.t) hit = { t: t, p: [dx * t, dy * t], seg: s };
    });
    return hit;
  }

  // Walk along a group from `start` (on stretch `seg`), following connected stretches through bends, until maxDist metres.
  function walkAlong(list, start, seg, forward, maxDist) {
    var pts = [start], cur = forward ? seg.b : seg.a, from = start;
    pts.push(cur);
    var d = dist(start, cur);
    var used = [seg];
    for (var guard = 0; guard < 80 && d < maxDist; guard++) {
      // No incoming direction while the start sits on the stretch's end (the bearing of a near-zero vector is arbitrary).
      var inB = dist(from, cur) > 0.5 ? brg(from, cur) : null, best = null;
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (used.indexOf(s) >= 0) continue;
        var nearA = dist(cur, s.a) <= JOIN_M, nearB = dist(cur, s.b) <= JOIN_M;
        if (!nearA && !nearB) continue;
        var far = nearA ? s.b : s.a;
        var turn = inB === null ? 0 : Math.abs(G.angleDiff(inB, brg(cur, far)));
        if (!best || turn < best.turn) best = { s: s, far: far, turn: turn };
      }
      if (!best || best.turn > 100) break;                  // the taxiway ends or doubles back
      used.push(best.s);
      from = cur; cur = best.far; pts.push(cur);
      d += dist(from, cur);
    }
    // Drop repeated points: when the start sits on a stretch's end the first leg has no length, and its "bearing" would read as north.
    var clean = [pts[0]];
    for (var j = 1; j < pts.length; j++) { if (dist(clean[clean.length - 1], pts[j]) > 0.5) clean.push(pts[j]); }
    return clean;
  }

  // The point d metres along a polyline, or null if it is shorter.
  function pointAlong(pts, d) {
    var acc = 0;
    for (var i = 0; i + 1 < pts.length; i++) {
      var len = dist(pts[i], pts[i + 1]);
      if (acc + len >= d - 1e-6 && len > 1e-6) {
        var f = (d - acc) / len;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
      }
      acc += len;
    }
    return null;
  }

  function title(kind, name) { return kind === 'lane' ? 'Apron lane' : (kind === 'link' ? name : 'Taxiway ' + name); }
  function where(kind, name) { return kind === 'lane' ? 'the apron lane' : (kind === 'link' ? name : 'taxiway ' + name); }
  function reachOf(kind) { return kind === 'taxiway' ? MAX_DIST_M : LANE_DIST_M; }

  // items: PS.taxi.extract items. ac: { lat, lon, hdgDeg }. Returns [{ id, title, detail, kind, route, pins, lengthM, facingDeg, turnDeg }]
  // route and pins are [[lat, lon], ...]: route starts at the aircraft; pins are the waypoints (no start point).
  function suggest(items, ac) {
    if (!ac || typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return [];
    var stretches = stretchesOf(items, ac);
    if (!stretches.length) return [];
    var hdg = ac.hdgDeg || 0;
    var back = G.rad(G.normDeg(hdg + 180));
    var backDir = [Math.sin(back), Math.cos(back)];
    var backBrg = G.normDeg(hdg + 180);

    // Group by kind and name, with the distance of the nearest stretch.
    var groups = {};
    stretches.forEach(function (s) {
      var key = s.kind + '|' + s.name;
      var g = groups[key] || (groups[key] = { kind: s.kind, name: s.name, list: [], nearest: Infinity });
      g.list.push(s);
      var d = distToStretch(s);
      if (d < g.nearest) g.nearest = d;
    });

    // Nearest first, but only groups the tail line actually reaches count towards the limit: a taxiway the aircraft is alongside, or one
    // that is close but off to the side, would otherwise use up a slot and push out one that can be pushed to.
    var ordered = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.nearest - b.nearest; });
    var limit = { taxiway: MAX_TAXIWAYS, lane: 1, link: MAX_LINKS }, taken = { taxiway: 0, lane: 0, link: 0 };
    var chosen = [];
    ordered.forEach(function (g) {
      if (g.nearest > reachOf(g.kind) || taken[g.kind] >= limit[g.kind]) return;
      var hit = tailHit(g.list, backDir, reachOf(g.kind));
      if (!hit) return;
      taken[g.kind]++;
      chosen.push({ g: g, hit: hit });
    });

    var out = [];
    function toLatLon(p) { return G.fromXY(ac.lat, ac.lon, p[0], p[1]); }
    function add(g, id, ttl, detail, routeXY, pinsXY, facing, turn) {
      out.push({
        id: id, kind: g.kind, title: ttl, detail: detail,
        route: routeXY.map(toLatLon), pins: pinsXY.map(toLatLon),
        lengthM: pathLen(routeXY), facingDeg: facing, turnDeg: turn
      });
    }

    chosen.forEach(function (c) {
      var g = c.g, hit = c.hit;
      var key = g.kind + '-' + g.name.replace(/\s+/g, '');
      var origin = [0, 0];
      // Straight back: the nose stays as it is.
      add(g, 'back-' + key, 'Straight back to ' + where(g.kind, g.name),
        Math.round(hit.t) + ' m straight back; the nose stays ' + pad3(hdg) + '°',
        [origin, hit.p], [hit.p], G.normDeg(hdg), 0);
      if (g.kind === 'lane') return;
      // Back to the taxiway, then along it either way.
      [true, false].forEach(function (forward) {
        var pts = walkAlong(g.list, hit.p, hit.seg, forward, MAX_WALK_M);
        if (pts.length < 2) return;
        var turn = Math.abs(G.angleDiff(backBrg, brg(hit.p, pts[1])));
        if (turn > MAX_TURN_DEG) return;                      // the tug would have to swing too sharply here
        var entry = pointAlong(pts, ENTRY_M);
        if (!entry) return;
        VARIANT_M.forEach(function (d) {
          var end = pointAlong(pts, d);
          if (!end) return;
          // Pins: a little way along, each real bend before the end, then the end.
          var pins = [entry], acc = 0;
          for (var i = 1; i + 1 < pts.length; i++) {
            acc += dist(pts[i - 1], pts[i]);
            if (acc <= ENTRY_M + 3 || acc >= d - 3) continue;
            if (Math.abs(G.angleDiff(brg(pts[i - 1], pts[i]), brg(pts[i], pts[i + 1]))) >= 4) pins.push(pts[i]);
          }
          pins.push(end);
          var route = [origin, hit.p].concat(pins);
          var last = pins.length > 1 ? pins[pins.length - 2] : hit.p;
          // Pushing back the whole way, so the nose ends opposite to the last leg's direction of travel.
          var facing = G.normDeg(brg(last, end) + 180);
          var f = Math.round(facing);
          add(g, 'along-' + key + '-' + (forward ? 'f' : 'b') + '-' + d, title(g.kind, g.name) + ', facing ' + compass(f),
            Math.round(pathLen(route)) + ' m: straight back to ' + where(g.kind, g.name) + ', then ' + d + ' m along it' +
              (pins.length > 2 ? ' (round its bend' + (pins.length > 3 ? 's' : '') + ')' : '') + '; ends facing ' + pad3(f) + '°' +
              (turn > 70 ? '. Sharp turn at the taxiway (' + Math.round(turn) + '°)' : ''),
            route, pins, facing, turn);
        });
      });
    });

    // Straight-back options first, then shortest first.
    out.sort(function (a, b) {
      var sa = a.id.indexOf('back-') === 0 ? 0 : 1, sb = b.id.indexOf('back-') === 0 ? 0 : 1;
      return sa !== sb ? sa - sb : a.lengthM - b.lengthM;
    });
    return out.slice(0, 10);
  }

  return { suggest: suggest, compass: compass };
})();
