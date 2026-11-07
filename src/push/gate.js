// Is the aircraft at a gate? A stand from the airport's parking data close enough to the aircraft, with the aircraft stopped and roughly lined up
// with it. The Push tab shows it, the push records the gate it left, and Return to gate checks against that gate (a retrace alone can end anywhere).

PS.gate = (function () {
  var NEAR_M = 15; // the aircraft's position this close to a stand's marker counts as on it
  var HEADING_OFF_DEG = 40; // and pointing within this of the stand's heading (when the stand has one)
  var SLOW_KT = 2; // stopped, or nearly

  // The nearest stand to (lat, lon): { name, distM, headingOffDeg (or null), spot } or null when there is no parking data.
  function nearest(lat, lon, hdgDeg) {
    var taxi = PS.state && PS.state.taxi,
      list = taxi && taxi.parking,
      best = null;
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      var d = PS.geo.distanceM(lat, lon, p.lat, p.lon);
      if (!best || d < best.distM) best = { name: p.name || '(stand)', distM: d, spot: p };
    }
    if (best) {
      var h = best.spot.headingDeg;
      best.headingOffDeg =
        typeof h === 'number' && isFinite(h) && typeof hdgDeg === 'number' ? Math.abs(PS.geo.angleDiff(hdgDeg, h)) : null;
    }
    return best;
  }

  // The state now, or for a given pose: { known (parking data and a position), at, name, distM, headingOffDeg, stopped, nearestName }.
  function detect(pose, gsKt) {
    var own = pose || PS.readOwn();
    if (!own) return { known: false, at: false };
    var gs = typeof gsKt === 'number' ? gsKt : own.gsKt || 0;
    var n = nearest(own.lat, own.lon, own.hdgDeg);
    if (!n) return { known: false, at: false, stopped: gs <= SLOW_KT };
    var near = n.distM <= NEAR_M,
      lined = n.headingOffDeg === null || n.headingOffDeg <= HEADING_OFF_DEG,
      stopped = gs <= SLOW_KT;
    return {
      known: true,
      at: near && lined && stopped,
      name: n.name,
      distM: n.distM,
      headingOffDeg: n.headingOffDeg,
      stopped: stopped,
      near: near,
      lined: lined,
      lat: n.spot.lat,
      lon: n.spot.lon,
      spotHeadingDeg: n.spot.headingDeg
    };
  }
  function describe(g) {
    if (!g || !g.known) return 'no gate data';
    if (g.at) return 'at gate ' + g.name + ' (' + PS.fmt.num(g.distM, 0) + ' m from its marker)';
    var why = !g.near
      ? PS.fmt.num(g.distM, 0) + ' m from the nearest stand, ' + g.name
      : !g.lined
        ? 'the nose is ' + PS.fmt.num(g.headingOffDeg, 0) + ' deg off gate ' + g.name
        : 'still moving';
    return 'not at a gate: ' + why;
  }
  return { detect: detect, describe: describe };
})();
