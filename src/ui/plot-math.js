// Plot geometry shared by the map page and its tests: a north-up view centred on a point, and pin hit-testing.

// View of a w x h canvas centred on `center` ({ lat, lon }) that shows `rangeM` metres from the centre to the nearest edge.
PS.plotView = function (w, h, center, rangeM) {
  var cx = w / 2,
    cy = h / 2,
    scale = Math.min(cx, cy) / rangeM; // px per metre
  return {
    w: w,
    h: h,
    cx: cx,
    cy: cy,
    scale: scale,
    rangeM: rangeM,
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
  var best = -1,
    bestD = radiusPx;
  for (var i = 0; i < pins.length; i++) {
    var q = view.toPx(pins[i].lat, pins[i].lon);
    var d = Math.sqrt((q[0] - px) * (q[0] - px) + (q[1] - py) * (q[1] - py));
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
};

// Legs of a route from `start` ({ lat, lon }) through `pins`: [{ distM, bearingDeg }] and the total length.
PS.routeLegs = function (start, pins) {
  var legs = [],
    total = 0,
    prev = start;
  for (var i = 0; i < pins.length; i++) {
    var d = PS.geo.distanceM(prev.lat, prev.lon, pins[i].lat, pins[i].lon);
    legs.push({ distM: d, bearingDeg: PS.geo.bearingDeg(prev.lat, prev.lon, pins[i].lat, pins[i].lon) });
    total += d;
    prev = pins[i];
  }
  return { legs: legs, totalM: total };
};
