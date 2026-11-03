// Plot geometry shared by the map page and its tests: a north-up view centred on a point, and pin hit-testing.

// View of a w x h canvas centred on `center` ({ lat, lon }) that shows `rangeM` metres from the centre to the nearest edge.
PS.plotView = function (w, h, center, rangeM) {
  var cx = w / 2, cy = h / 2, scale = Math.min(cx, cy) / rangeM; // px per metre
  return {
    w: w, h: h, cx: cx, cy: cy, scale: scale, rangeM: rangeM,
    toPx: function (lat, lon) {
      var p = PS.geo.toXY(center.lat, center.lon, lat, lon);
      return [cx + p.x * scale, cy - p.y * scale];
    },
    fromPx: function (px, py) {
      return PS.geo.fromXY(center.lat, center.lon, (px - cx) / scale, (cy - py) / scale); // [lat, lon]
    }
  };
};

// Index of the pin nearest (px, py) within radiusPx, or -1. pins: [{ lat, lon }].
PS.nearestPin = function (view, pins, px, py, radiusPx) {
  var best = -1, bestD = radiusPx;
  for (var i = 0; i < pins.length; i++) {
    var q = view.toPx(pins[i].lat, pins[i].lon);
    var d = Math.sqrt((q[0] - px) * (q[0] - px) + (q[1] - py) * (q[1] - py));
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
};

// Legs of a route from `start` ({ lat, lon }) through `pins`: [{ distM, bearingDeg }] and the total length.
PS.routeLegs = function (start, pins) {
  var legs = [], total = 0, prev = start;
  for (var i = 0; i < pins.length; i++) {
    var d = PS.geo.distanceM(prev.lat, prev.lon, pins[i].lat, pins[i].lon);
    legs.push({ distM: d, bearingDeg: PS.geo.bearingDeg(prev.lat, prev.lon, pins[i].lat, pins[i].lon) });
    total += d; prev = pins[i];
  }
  return { legs: legs, totalM: total };
};

// Tap calibration: samples are taps aimed at known spots on the canvas. Each sample { exp: [x, y] (where it was aimed, canvas pixels),
// rect: [x, y] (where the client position against the canvas rectangle put it), off: [x, y] or null (from offsetX/offsetY) }.
// For each way of measuring, fit  expected = scale * measured + shift  per axis by least squares. Returns { best, rect, offset }, each
// { method, ax, bx, ay, by, rms, n } (rms: the residual in canvas pixels after the fit), best being the measure that fits better.
PS.fitTapCalibration = function (samples) {
  function fit1(m, e) {
    var n = m.length, sm = 0, se = 0, smm = 0, sme = 0, i;
    for (i = 0; i < n; i++) { sm += m[i]; se += e[i]; smm += m[i] * m[i]; sme += m[i] * e[i]; }
    var den = n * smm - sm * sm, a = Math.abs(den) < 1e-9 ? 1 : (n * sme - sm * se) / den;
    if (!isFinite(a) || a < 0.5 || a > 2) a = 1;     // a wild scale is a sign of a bad tap, not a real one
    var b = (se - a * sm) / n, sse = 0;
    for (i = 0; i < n; i++) { var r = a * m[i] + b - e[i]; sse += r * r; }
    return { a: a, b: b, sse: sse };
  }
  function measure(key, name) {
    var mx = [], my = [], ex = [], ey = [];
    samples.forEach(function (s) { var v = s[key]; if (!v) return; mx.push(v[0]); my.push(v[1]); ex.push(s.exp[0]); ey.push(s.exp[1]); });
    if (mx.length < 2) return null;
    var fx = fit1(mx, ex), fy = fit1(my, ey);
    return { method: name, ax: fx.a, bx: fx.b, ay: fy.a, by: fy.b, rms: Math.sqrt((fx.sse + fy.sse) / (2 * mx.length)), n: mx.length };
  }
  var rect = measure('rect', 'rect'), offset = measure('off', 'offset'), hit = measure('hit', 'hit');
  // Lowest residual wins; within half a pixel, the measure that needs the smaller correction (its raw reading was already closer to right).
  function correction(m) { return Math.abs(m.ax - 1) * 900 + Math.abs(m.ay - 1) * 540 + Math.abs(m.bx) + Math.abs(m.by); }
  var best = null;
  [rect, offset, hit].forEach(function (m) {
    if (!m) return;
    if (!best || m.rms < best.rms - 0.5 || (m.rms <= best.rms + 0.5 && correction(m) < correction(best))) best = m;
  });
  return { best: best, rect: rect, offset: offset, hit: hit };
};
