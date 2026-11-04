// Taxiway data: category names, extraction from whatever the sim returns, aggregation for the table, sample data.
// The shape the original app used: paths [{ name, type, widthM, points: [[lat, lon], [lat, lon]] }], parking [...].

PS.taxi = (function () {
  var G = PS.geo;
  var CATEGORY = { 1: 'Taxiway', 2: 'Runway', 3: 'Parking connector' };

  function category(type) {
    if (typeof type === 'string') return type;
    return CATEGORY[type] || (type === undefined || type === null ? 'Unknown' : 'Other (' + type + ')');
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) { if (o[keys[i]] !== undefined && o[keys[i]] !== null) return o[keys[i]]; }
    return undefined;
  }
  function pointOf(o) {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o) && num(o[0]) !== null && num(o[1]) !== null) return [o[0], o[1]];
    var lat = num(pick(o, ['lat', 'latitude', 'Latitude']));
    var lon = num(pick(o, ['lon', 'lng', 'longitude', 'Longitude']));
    return lat !== null && lon !== null ? [lat, lon] : null;
  }
  function pointsOf(item) {
    var out = [], i, p;
    if (Array.isArray(item.points)) {
      for (i = 0; i < item.points.length; i++) { p = pointOf(item.points[i]); if (p) out.push(p); }
    }
    if (!out.length) {
      p = pointOf(item.start) || pointOf({ lat: item.startLat, lon: item.startLon });
      var q = pointOf(item.end) || pointOf({ lat: item.endLat, lon: item.endLon });
      if (p) out.push(p);
      if (q) out.push(q);
    }
    if (!out.length) { p = pointOf(item); if (p) out.push(p); }
    return out;
  }

  function arraysByKey(raw, re) {
    var found = [];
    if (!raw || typeof raw !== 'object') return found;
    Object.keys(raw).forEach(function (k) {
      if (re.test(k) && Array.isArray(raw[k])) found.push({ key: k, items: raw[k] });
    });
    return found;
  }

  // raw: whatever the sim returned (object). Returns { items, parking, keys, notes }.
  // items: [{ name, category, lengthM, widthM, headingDeg, points }]
  function extract(raw) {
    var res = { items: [], parking: [], keys: [], notes: [] };
    if (!raw || typeof raw !== 'object') { res.notes.push('Nothing to extract: no object returned.'); return res; }
    res.keys = Object.keys(raw);

    arraysByKey(raw, /^runways?$/i).forEach(function (g) {
      g.items.forEach(function (r) {
        if (!r || typeof r !== 'object') return;
        var name = pick(r, ['designation', 'name', 'designator']);
        var pts = pointsOf(r);
        // The sim's runway entries give a centre point, a heading and a length; turn that into a line.
        var rdir = num(pick(r, ['direction', 'heading', 'headingDeg']));
        var rlen = num(pick(r, ['length', 'lengthM']));
        if (pts.length === 1 && rdir !== null && rlen) {
          pts = [G.offset(pts[0][0], pts[0][1], rdir + 180, rlen / 2), G.offset(pts[0][0], pts[0][1], rdir, rlen / 2)];
        }
        res.items.push({
          name: name !== undefined ? String(name) : 'Runway',
          category: 'Runway',
          lengthM: num(pick(r, ['length', 'lengthM'])) !== null ? num(pick(r, ['length', 'lengthM'])) : (pts.length > 1 ? G.polylineLengthM(pts) : null),
          widthM: num(pick(r, ['width', 'widthM'])),
          headingDeg: num(pick(r, ['direction', 'heading', 'headingDeg'])),
          points: pts
        });
      });
    });

    arraysByKey(raw, /taxi|^paths?$/i).forEach(function (g) {
      g.items.forEach(function (t) {
        if (!t || typeof t !== 'object') return;
        var pts = pointsOf(t);
        var name = pick(t, ['name', 'taxiwayName', 'designation']);
        res.items.push({
          name: name !== undefined && name !== '' ? String(name) : '(unnamed)',
          category: category(pick(t, ['type', 'category', 'surface'])),
          rawType: pick(t, ['type']),
          rawName: name !== undefined ? String(name).trim() : '',
          lengthM: pts.length > 1 ? G.polylineLengthM(pts) : num(pick(t, ['length', 'lengthM'])),
          widthM: num(pick(t, ['widthM', 'width'])),
          headingDeg: null,
          points: pts
        });
      });
    });

    arraysByKey(raw, /park|gate/i).forEach(function (g) {
      g.items.forEach(function (p) {
        if (!p || typeof p !== 'object') return;
        var pt = pointOf(p);
        res.parking.push({
          name: String(pick(p, ['name', 'designation']) || '(stand)'),
          lat: pt ? pt[0] : null, lon: pt ? pt[1] : null,
          headingDeg: num(pick(p, ['headingDeg', 'heading'])),
          radiusM: num(pick(p, ['radiusM', 'radius']))
        });
      });
    });

    if (!res.items.length) {
      res.notes.push('No runway or taxiway arrays found. Top-level keys: ' + (res.keys.join(', ') || '(none)'));
    }
    return res;
  }

  // Group stretches that share a name and category into one row, measured from the aircraft.
  // Returns rows sorted by nearest distance: { name, category, segments, lengthM, widthM, nearestM, bearingDeg }
  function aggregate(items, ownLat, ownLon) {
    var map = {};
    items.forEach(function (it) {
      var key = it.category + '|' + it.name;
      var row = map[key];
      if (!row) {
        row = map[key] = { name: it.name, category: it.category, segments: 0, lengthM: 0, widthM: null, nearestM: null, bearingDeg: null, hasLength: false };
      }
      row.segments++;
      if (it.lengthM !== null) { row.lengthM += it.lengthM; row.hasLength = true; }
      if (it.widthM !== null && (row.widthM === null || it.widthM > row.widthM)) row.widthM = it.widthM;
      if (typeof ownLat === 'number' && typeof ownLon === 'number' && it.points.length) {
        var n = G.nearestOnPolyline(it.points, ownLat, ownLon);
        if (n && (row.nearestM === null || n.distM < row.nearestM)) {
          row.nearestM = n.distM;
          row.bearingDeg = G.bearingDeg(ownLat, ownLon, n.point[0], n.point[1]);
        }
      }
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; });
    rows.forEach(function (r) { if (!r.hasLength) r.lengthM = null; });
    rows.sort(function (a, b) {
      if (a.nearestM === null && b.nearestM === null) return a.name < b.name ? -1 : 1;
      if (a.nearestM === null) return 1;
      if (b.nearestM === null) return -1;
      return a.nearestM - b.nearestM;
    });
    return rows;
  }

  // Offline sample in the original app's layout shape, built around a reference point.
  function sample(refLat, refLon) {
    function line(brg, startDist, len) {
      var a = G.offset(refLat, refLon, brg, startDist);
      var b = G.offset(refLat, refLon, brg, startDist + len);
      return [a, b];
    }
    function seg(name, type, width, pts) { return { name: name, type: type, widthM: width, points: pts }; }
    var taxiways = [];
    var alongA = [0, 120, 240, 360];
    for (var i = 0; i < alongA.length; i++) taxiways.push(seg('A', 1, 23, line(90, alongA[i] - 100, 120)));
    taxiways.push(seg('B', 1, 23, line(0, 100, 320)));
    taxiways.push(seg('B', 1, 23, line(0, 420, 160)));
    taxiways.push(seg('A1', 1, 18, line(45, 60, 140)));
    taxiways.push(seg('', 3, 12, line(180, 0, 60)));
    taxiways.push(seg('', 3, 12, line(225, 0, 80)));
    taxiways.push(seg('LINK', 1, 15, line(135, 50, 200)));
    taxiways.push(seg('', 4, 0, line(270, 20, 90)));
    var rwA = G.offset(refLat, refLon, 0, 700), rwB = G.offset(refLat, refLon, 0, 2700);
    return {
      icao: 'SAMPLE',
      refLat: refLat, refLon: refLon,
      runways: [{ designation: '09/27', length: 2000, width: 45, direction: 90, points: [rwA, rwB] }],
      paths: taxiways,
      parking: [
        { name: 'Gate A 1', type: 1, lat: G.offset(refLat, refLon, 270, 30)[0], lon: G.offset(refLat, refLon, 270, 30)[1], headingDeg: 90, radiusM: 30 },
        { name: 'Gate A 2', type: 1, lat: G.offset(refLat, refLon, 270, 90)[0], lon: G.offset(refLat, refLon, 270, 90)[1], headingDeg: 90, radiusM: 30 }
      ]
    };
  }

  return { category: category, extract: extract, aggregate: aggregate, sample: sample };
})();
