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
    var cV = velocity(c.gsKt, c.hdgDeg);
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

  // Moves a sample contact forward by dtSec along its heading.
  function advance(c, dtSec) {
    var d = (c.gsKt || 0) * G.KT_TO_MS * dtSec;
    var p = G.offset(c.lat, c.lon, c.hdgDeg || 0, d);
    c.lat = p[0]; c.lon = p[1];
    return c;
  }

  // Sample contacts placed around the given point. Labelled as simulated so they are never mistaken for sim data.
  function sample(own) {
    function at(brg, dist, hdg, gs, name) {
      var p = G.offset(own.lat, own.lon, brg, dist);
      return { id: name, title: name, lat: p[0], lon: p[1], hdgDeg: hdg, gsKt: gs, altFt: own.altFt, onGround: true, simulated: true };
    }
    var h = own.hdgDeg || 0;
    return [
      at(h, 120, G.normDeg(h + 180), 8, 'SIM-A320 crossing ahead'),
      at(h + 90, 200, G.normDeg(h + 270), 6, 'SIM-B738 from the right'),
      at(h + 180, 90, h, 12, 'SIM-E190 behind, faster'),
      at(h - 60, 350, G.normDeg(h - 60), 0, 'SIM-A21N parked'),
      at(h + 20, 600, G.normDeg(h + 200), 15, 'SIM-B77W taxiing in')
    ];
  }

  return { analyse: analyse, advance: advance, sample: sample, velocity: velocity };
})();
