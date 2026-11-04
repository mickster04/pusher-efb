// The push plan: the pins the pushback will follow, and what the planner makes of them. Pure logic (no DOM), shared by the Plan tab and,
// later, the Push tab, which drives the route this module evaluates.
//
// Pins are waypoints in the original app's shape: { id, label, lat, lon, seq, terminal, headingDeg, headingUser, drive, leadInM }.
// A pin's heading is Auto (headingDeg null: the planner works out the nose it ends with) until you rotate it with its handle (headingUser
// true: the route then arrives along that heading, with a turnaround pin added by the planner if one leg cannot do it).

PS.plan = (function () {
  var P = PS.planner, G = PS.geo;
  var pins = [];
  var selected = -1;
  var seq = 0;
  var cache = { key: '', value: null };
  // Turn radius. The tug's radius is 30.5 / rotation setting metres whatever its speed (the yaw rate is tied to the speed), so slowing down
  // does not tighten an arc by itself; it only shrinks the lag and overshoot the steering has to correct. The original plans at 40 m, which
  // needs rotation 0.76 of a limit of about 1.8 to 2.0, leaving room for corrections; at 26 m it once ran wide, when the steering limits were
  // lower than they are now. So the plan uses 40 m, and where a corner is too cramped for that it tries smaller radii, down to
  // minRadiusM (a setting), taking the first that plans without a warning.
  var turn = { radiusM: P.PATH_TURN_RADIUS_M, minRadiusM: 26 };
  function setMinRadius(m) { turn.minRadiusM = Math.max(10, Math.min(turn.radiusM, m)); changed(); }

  function newId() { seq++; return 'pin-' + Date.now() + '-' + seq; }
  function copyPin(w) {
    return { id: w.id || newId(), label: w.label || '', lat: w.lat, lon: w.lon, seq: 0, terminal: false,
      headingDeg: w.headingUser && w.headingDeg !== undefined ? w.headingDeg : null, headingUser: !!w.headingUser, drive: w.drive || 'auto',
      leadInM: w.leadInM !== undefined ? w.leadInM : undefined };
  }
  // The last pin is the end pin. Labels follow position unless the pin carries a name of its own.
  function relabel() {
    pins.forEach(function (w, i) {
      w.seq = i;
      w.terminal = i === pins.length - 1;
      if (!w.custom) w.label = w.terminal ? 'End position' : 'Pin ' + (i + 1);
      if (!w.headingUser) w.headingDeg = null;
    });
  }
  function changed() { cache.key = ''; cache.value = null; }

  function add(lat, lon) {
    pins.push({ id: newId(), label: '', lat: lat, lon: lon, seq: 0, terminal: false, headingDeg: null, headingUser: false, drive: 'auto' });
    relabel(); changed();
    selected = pins.length - 1;
    return selected;
  }
  function move(i, lat, lon) { if (!pins[i]) return; pins[i].lat = lat; pins[i].lon = lon; changed(); }
  function remove(i) {
    if (!pins[i]) return;
    pins.splice(i, 1);
    relabel(); changed();
    selected = selected === i ? -1 : (selected > i ? selected - 1 : selected);
  }
  // The direction of the taxiway centreline nearest (lat, lon) within maxM, as the nose heading closest to refDeg (a taxiway runs both ways, and the
  // way with the smaller turn from where the aircraft is already pointing is the one to default to). Runways are not snapped to.
  var SNAP_MAX_M = 50;          // the default reach; Settings can change it
  function snapReach() { var m = PS.settings && PS.settings.get('snapM'); return typeof m === 'number' && m > 0 ? m : SNAP_MAX_M; }
  var lastSnapMiss = null;     // why the last snap found nothing: { nearestM, nearestName, items, off }
  function snapAt(lat, lon, refDeg, maxM) {
    var taxi = PS.state && PS.state.taxi, best = null, nearest = null, usable = 0;
    lastSnapMiss = { nearestM: null, nearestName: '', items: taxi && taxi.items ? taxi.items.length : 0, noData: !taxi || !taxi.items };
    if (!taxi || !taxi.items) return null;
    taxi.items.forEach(function (it) {
      if (!it.points || it.points.length < 2 || it.category === 'Runway') return;
      usable++;
      for (var i = 1; i < it.points.length; i++) {
        var a = it.points[i - 1], b = it.points[i];
        var A = G.toXY(lat, lon, a[0], a[1]), B = G.toXY(lat, lon, b[0], b[1]);
        var dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy;
        if (len2 < 1) continue;
        var t = Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2)), px = A.x + t * dx, py = A.y + t * dy, d = Math.sqrt(px * px + py * py);
        if (!nearest || d < nearest.d) nearest = { d: d, name: it.name || '' };
        if (d <= (maxM || snapReach()) && (!best || d < best.distM)) best = { distM: d, bearing: G.bearingDeg(a[0], a[1], b[0], b[1]), name: it.name || '' };
      }
    });
    if (nearest) { lastSnapMiss.nearestM = nearest.d; lastSnapMiss.nearestName = nearest.name; }
    lastSnapMiss.usable = usable;
    if (!best) return null;
    var other = G.normDeg(best.bearing + 180);
    var hdg = Math.abs(G.angleDiff(best.bearing, refDeg)) <= Math.abs(G.angleDiff(other, refDeg)) ? best.bearing : other;
    return { headingDeg: Math.round(G.normDeg(hdg)), otherDeg: Math.round(G.normDeg(hdg === best.bearing ? other : best.bearing)), refDeg: Math.round(G.normDeg(refDeg)), name: best.name, distM: best.distM };
  }
  // Give pin i the heading of the taxiway it sits on (if there is one close by). It stays "snapped" so moving the pin re-snaps it, until the pin
  // is rotated by hand. refDeg is where the aircraft points before this pin: the previous pin's heading, else the aircraft's own.
  function snapPin(i, ownHdgDeg) {
    var w = pins[i]; if (!w) return null;
    if (PS.settings && !PS.settings.get('snap')) { lastSnapMiss = { off: true }; return null; }
    var prev = pins[i - 1], ref = prev && prev.headingUser && prev.headingDeg !== null ? prev.headingDeg : ownHdgDeg;
    var r = snapAt(w.lat, w.lon, ref || 0);
    if (!r) { if (w.snapped) { w.snapped = false; w.headingUser = false; w.headingDeg = null; changed(); } return null; }
    w.headingDeg = r.headingDeg; w.headingUser = true; w.snapped = true; changed();
    return r;
  }
  // Turn pin i's nose round to the opposite way along the taxiway it is on (the snap can only guess which way is wanted when the turn is near 90 degrees).
  function flip(i) { var w = pins[i]; if (!w) return; var cur = w.headingDeg; if (cur === null || cur === undefined) return; setHeading(i, cur + 180); }
  function clear() { pins.length = 0; selected = -1; changed(); }
  function setHeading(i, deg) { if (!pins[i]) return; pins[i].snapped = false; pins[i].headingDeg = Math.round(G.normDeg(deg)); pins[i].headingUser = true; changed(); }
  function resetHeading(i) { if (!pins[i]) return; pins[i].snapped = false; pins[i].headingDeg = null; pins[i].headingUser = false; pins[i].leadInM = undefined; changed(); }
  // Replace the plan (for example with a suggestion's waypoints). Pins the planner added itself (turnaround pins) are dropped: it adds them again.
  function setAll(waypoints) {
    pins.length = 0;
    waypoints.forEach(function (w) { if (w.label !== P.TURNAROUND_PIN_LABEL) pins.push(copyPin(w)); });
    relabel(); changed();
    selected = -1;
  }
  function select(i) { selected = i >= -1 && i < pins.length ? i : -1; }

  // The heading (degrees) a drag of the heading handle means: the handle sits behind the tail, so the nose points from the handle through
  // the pin. Screen coordinates (y grows downward).
  function headingFromHandle(pinX, pinY, handleX, handleY) {
    return G.normDeg(G.deg(Math.atan2(pinX - handleX, -(pinY - handleY))));
  }

  // One plan at a given turn radius: the effective waypoints (with any turnaround pin), legs, warnings and the line to draw.
  function planAt(origin, radius) {
    var prev = P.getRadius();
    P.setRadius(radius);
    try {
      var o = { lat: origin.lat, lon: origin.lon, hdgDeg: origin.hdgDeg };
      var r = P.withTurnaroundPin(o, P.ensureTerminal(pins));
      var segs = P.plannedRouteSegments(o, r.waypoints);
      var out = { radiusM: radius, waypoints: r.waypoints, turnaroundAdded: r.added, info: r.info, segments: segs, legs: [], warnings: [], totalM: 0, route: [[origin.lat, origin.lon]] };
      segs.forEach(function (g, n) {
        var len = P.pathLengthM(g.points), warn = P.segmentWarning(g, radius);
        out.legs.push({ sign: g.sign, lengthM: len, endHdgDeg: g.endHdgDeg, warning: warn, pinIdx: g.pinIdx, tightestRadiusM: g.tightestRadiusM });
        out.totalM += len;
        if (warn) out.warnings.push('Leg ' + (n + 1) + ': ' + warn);
        g.points.forEach(function (pt, i) { if (!(i === 0 && out.route.length > 1)) out.route.push(pt); });
      });
      return out;
    } finally { P.setRadius(prev); }
  }

  // Log what the planner made of the pins whenever it changes, and every warning in full with the pins that led to it.
  var lastLogged = '';
  function logResult(res, origin) {
    if (res.empty) { if (lastLogged !== 'empty') { lastLogged = 'empty'; PS.log('plan', 'no pins: no route'); } return; }
    var sig = res.warnings.join('|') + '#' + res.legs.map(function (l) { return l.sign + ':' + Math.round(l.lengthM / 5); }).join(',') + '#' + Math.round(res.radiusM) + '#' + pins.map(function (w) { return w.id + (w.headingUser ? w.headingDeg : ''); }).join(',');
    if (sig === lastLogged) return;
    lastLogged = sig;
    var legs = res.legs.map(function (l, n) {
      return 'leg ' + (n + 1) + ' ' + (l.sign < 0 ? 'back' : 'forward') + ' ' + Math.round(l.lengthM) + ' m, ends ' + Math.round(l.endHdgDeg) + '°, tightest ' + (l.tightestRadiusM ? Math.round(l.tightestRadiusM) + ' m' : '-');
    });
    PS.log('plan', 'route: ' + Math.round(res.totalM) + ' m, ' + res.legs.length + ' leg(s), radius ' + Math.round(res.radiusM) + ' m' + (res.adapted ? ' (tightened)' : '') + (res.turnaroundAdded ? ', turnaround pin added' : '') + ' | ' + legs.join('; '));
    if (res.turnaroundAdded && res.info) PS.log('plan', 'turnaround pin: ' + res.info);
    if (res.warnings.length) {
      res.warnings.forEach(function (w) { PS.log('plan', 'WARNING ' + w); });
      PS.log('plan', 'pins behind the warning (aircraft at heading ' + Math.round(origin.hdgDeg) + '°): ' + res.waypoints.map(function (w, i) {
        return (i + 1) + '=' + w.lat.toFixed(5) + ',' + w.lon.toFixed(5) + ' ' + (w.headingUser ? 'heading ' + Math.round(w.headingDeg) + '° (' + (w.snapped ? 'snapped' : 'set by you') + ')' : 'auto') + (w.label === P.TURNAROUND_PIN_LABEL ? ' [turnaround]' : '');
      }).join('; '));
    } else { PS.log('plan', 'route plans without a warning'); }
  }
  // The planned route for the pins, from the aircraft. origin: { lat, lon, hdgDeg }.
  // Returns { empty, waypoints (with any turnaround pin), segments, route ([[lat, lon], ...] from the aircraft), items, legs, totalM, warnings,
  //           turnaroundAdded, info, radiusM (the turn radius planned with), adapted (a tighter one than usual was needed) }
  // items: one per effective waypoint { wp, userIndex (-1 for a planner-added pin), headingDeg (the nose there), turnaround }.
  function evaluate(origin) {
    var key = JSON.stringify([pins.map(function (w) { return [w.id, w.lat, w.lon, w.headingDeg, w.headingUser, w.leadInM]; }),
      origin.lat.toFixed(6), origin.lon.toFixed(6), Math.round(origin.hdgDeg), turn.radiusM, turn.minRadiusM]);
    if (cache.key === key && cache.value) return cache.value;
    var res = { empty: pins.length === 0, waypoints: [], segments: [], route: [[origin.lat, origin.lon]], items: [], legs: [], totalM: 0, warnings: [], turnaroundAdded: false, info: '', radiusM: turn.radiusM, adapted: false };
    if (pins.length) {
      var best = planAt(origin, turn.radiusM);
      if (best.warnings.length && turn.minRadiusM < turn.radiusM - 0.5) {
        // Too cramped at the usual radius: step the radius down (about 12% at a time) to the tightest allowed, taking the first that is clean.
        var radii = [];
        for (var rr = turn.radiusM * 0.88; rr > turn.minRadiusM + 0.5; rr *= 0.88) radii.push(rr);
        radii.push(turn.minRadiusM);
        for (var i = 0; i < radii.length; i++) {
          var t = planAt(origin, radii[i]);
          if (!t.warnings.length) { best = t; break; }
        }
      }
      res.waypoints = best.waypoints; res.turnaroundAdded = best.turnaroundAdded; res.info = best.info; res.segments = best.segments;
      res.legs = best.legs; res.warnings = best.warnings; res.totalM = best.totalM; res.route = best.route;
      res.radiusM = best.radiusM; res.adapted = best.radiusM < turn.radiusM - 0.5;
      var headings = P.plannedPinHeadings(res.segments, res.waypoints);
      res.items = res.waypoints.map(function (w, idx) {
        var ui = -1;
        for (var k = 0; k < pins.length; k++) { if (pins[k].id === w.id) { ui = k; break; } }
        return { wp: w, userIndex: ui, headingDeg: w.headingUser && w.headingDeg !== null && w.headingDeg !== undefined ? w.headingDeg : headings[idx], turnaround: w.label === P.TURNAROUND_PIN_LABEL };
      });
    }
    cache.key = key; cache.value = res;
    logResult(res, origin);
    return res;
  }

  return {
    list: function () { return pins; }, count: function () { return pins.length; },
    selected: function () { return selected; }, select: select,
    add: add, move: move, remove: remove, clear: clear, setHeading: setHeading, resetHeading: resetHeading, setAll: setAll,
    headingFromHandle: headingFromHandle, snapAt: snapAt, snapPin: snapPin, snapMiss: function () { return lastSnapMiss; }, snapMaxM: snapReach, flip: flip, evaluate: evaluate,
    turn: function () { return turn; }, setMinRadius: setMinRadius
  };
})();
