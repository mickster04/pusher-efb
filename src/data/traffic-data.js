// Traffic maths: relative geometry between own aircraft and a contact, closest approach, and sample contacts.

PS.traffic = (function () {
  var G = PS.geo;

  // own / contact: { lat, lon, hdgDeg, gsKt, altFt }
  function analyse(own, c) {
    var p = G.toXY(own.lat, own.lon, c.lat, c.lon);
    var dist = Math.sqrt(p.x * p.x + p.y * p.y);
    var brg = G.bearingDeg(own.lat, own.lon, c.lat, c.lon);
    var rel = G.angleDiff(own.hdgDeg || 0, brg);

    var ownV = velocity(own.gsKt, own.hdgDeg);
    var cV = velocity(c.gsKt, c.trackDeg !== undefined ? c.trackDeg : c.hdgDeg);
    var v = { x: cV.x - ownV.x, y: cV.y - ownV.y };
    var v2 = v.x * v.x + v.y * v.y;
    var dot = p.x * v.x + p.y * v.y;

    var closingMs = dist > 0 ? -dot / dist : 0;
    var tcpa = v2 > 1e-6 ? Math.max(0, -dot / v2) : null;
    var cpa = tcpa === null ? dist : Math.sqrt(Math.pow(p.x + v.x * tcpa, 2) + Math.pow(p.y + v.y * tcpa, 2));

    return {
      distM: dist,
      bearingDeg: brg,
      relBearingDeg: rel,
      altDiffFt: (c.altFt || 0) - (own.altFt || 0),
      closingKt: closingMs / G.KT_TO_MS,
      tcpaSec: tcpa,
      cpaM: cpa,
      ahead: Math.abs(rel) <= 45
    };
  }

  function velocity(gsKt, hdgDeg) {
    var ms = (gsKt || 0) * G.KT_TO_MS;
    var h = G.rad(hdgDeg || 0);
    return { x: ms * Math.sin(h), y: ms * Math.cos(h) };
  }

  return { analyse: analyse };
})();
