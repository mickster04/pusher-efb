// Geometry helpers. Local frame: x = east (m), y = north (m), equirectangular around a reference point.

PS.geo = (function () {
  var R = 6371000;
  var KT_TO_MS = 0.514444;

  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }
  function normDeg(d) { return ((d % 360) + 360) % 360; }
  // signed smallest difference b - a in (-180, 180]
  function angleDiff(a, b) {
    var d = normDeg(b - a);
    return d > 180 ? d - 360 : d;
  }
  function distanceM(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function bearingDeg(lat1, lon1, lat2, lon2) {
    var y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    var x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    return normDeg(deg(Math.atan2(y, x)));
  }
  function toXY(refLat, refLon, lat, lon) {
    return {
      x: rad(lon - refLon) * R * Math.cos(rad(refLat)),
      y: rad(lat - refLat) * R
    };
  }
  // Inverse of toXY: the lat/lon of a point x metres east and y metres north of the reference.
  function fromXY(refLat, refLon, x, y) {
    return [refLat + deg(y / R), refLon + deg(x / (R * Math.cos(rad(refLat))))];
  }
  function offset(lat, lon, brgDeg, distM) {
    var b = rad(brgDeg);
    var dLat = distM * Math.cos(b) / R;
    var dLon = distM * Math.sin(b) / (R * Math.cos(rad(lat)));
    return [lat + deg(dLat), lon + deg(dLon)];
  }
  // points: [[lat, lon], ...]
  function polylineLengthM(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
      total += distanceM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
    return total;
  }
  // Nearest point on a polyline to (lat, lon): { distM, point: [lat, lon] }. Projects onto each segment in the local frame.
  function nearestOnPolyline(points, lat, lon) {
    if (!points.length) return null;
    var best = null;
    if (points.length === 1) {
      return { distM: distanceM(lat, lon, points[0][0], points[0][1]), point: points[0] };
    }
    for (var i = 1; i < points.length; i++) {
      var a = toXY(lat, lon, points[i - 1][0], points[i - 1][1]);
      var b = toXY(lat, lon, points[i][0], points[i][1]);
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      var t = len2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2)) : 0;
      var px = a.x + t * dx, py = a.y + t * dy;
      var d = Math.sqrt(px * px + py * py);
      if (!best || d < best.distM) {
        best = {
          distM: d,
          point: [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t]
        };
      }
    }
    return best;
  }

  return {
    KT_TO_MS: KT_TO_MS, rad: rad, deg: deg, normDeg: normDeg, angleDiff: angleDiff,
    distanceM: distanceM, bearingDeg: bearingDeg, toXY: toXY, fromXY: fromXY, offset: offset,
    polylineLengthM: polylineLengthM, nearestOnPolyline: nearestOnPolyline
  };
})();
