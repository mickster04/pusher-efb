// The push plan: the pins the pushback will follow, and what the planner makes of them. Pure logic (no DOM), shared by the Plan tab and,
// later, the Push tab, which drives the route this module evaluates.
//
// Pins are waypoints in the original app's shape: { id, label, lat, lon, seq, terminal, headingDeg, headingUser, drive, leadInM }.
// A pin's heading is Auto (headingDeg null: the planner works out the nose it ends with) until you rotate it with its handle (headingUser
// true: the route then arrives along that heading, with a turnaround pin added by the planner if one leg cannot do it).

PS.plan = (function () {
  var P = PS.planner,
    G = PS.geo;
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
  var settingMin = 26, // Settings > Tightest turn
    aircraftMin = null, // what the aircraft in use can do (null: no profile of its size)
    aircraftTitle = null;
  function applyMin() {
    var m = aircraftMin !== null ? Math.min(settingMin, aircraftMin) : settingMin;
    turn.minRadiusM = Math.max(10, Math.min(turn.radiusM, m));
  }
  function setMinRadius(m) {
    settingMin = m;
    applyMin();
    changed();
  }
  // The turn radii follow the size of the aircraft: a turboprop or a light aircraft turns tighter than the 40 m the planner uses for a jet, and the
  // warnings ("the tug needs N m") then name that aircraft's radius. Called with PS.aircraftInfo() whenever the aircraft may have changed.
  function useAircraft(info) {
    var t = PS.profiles ? PS.profiles.turnFor(info) : { radiusM: P.PATH_TURN_RADIUS_M, minM: null, why: '' };
    var title = (info && info.title) || '';
    if (title === aircraftTitle && turn.radiusM === t.radiusM) return false;
    aircraftTitle = title;
    turn.radiusM = t.radiusM;
    P.setBaseRadius(t.radiusM);
    aircraftMin = t.minM;
    applyMin();
    PS.log('plan', 'turn radius for ' + (title || 'the aircraft') + ': usual ' + t.radiusM + ' m, tightest ' + Math.round(turn.minRadiusM) + ' m' + (t.why ? ' (' + t.why + ')' : ''));
    changed();
    return true;
  }

  function newId() {
    seq++;
    return 'pin-' + Date.now() + '-' + seq;
  }
  function copyPin(w) {
    return {
      id: w.id || newId(),
      label: w.label || '',
      lat: w.lat,
      lon: w.lon,
      seq: 0,
      terminal: false,
      headingDeg: w.headingUser && w.headingDeg !== undefined ? w.headingDeg : null,
      headingUser: !!w.headingUser,
      drive: w.drive || 'auto',
      leadInM: w.leadInM !== undefined ? w.leadInM : undefined
    };
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
  function changed() {
    cache.key = '';
    cache.value = null;
  }

  function add(lat, lon) {
    pins.push({ id: newId(), label: '', lat: lat, lon: lon, seq: 0, terminal: false, headingDeg: null, headingUser: false, drive: 'auto' });
    relabel();
    changed();
    selected = pins.length - 1;
    return selected;
  }
  function move(i, lat, lon) {
    if (!pins[i]) return;
    pins[i].lat = lat;
    pins[i].lon = lon;
    changed();
  }
  // Swap pin i with its neighbour (delta -1 = earlier in the route, +1 = later). The last pin is the end pin, so moving a pin to the end makes it the end.
  function reorder(i, delta) {
    var j = i + delta;
    if (!pins[i] || !pins[j]) return false;
    var t = pins[i];
    pins[i] = pins[j];
    pins[j] = t;
    if (selected === i) selected = j;
    else if (selected === j) selected = i;
    relabel();
    changed();
    return true;
  }
  function remove(i) {
    if (!pins[i]) return;
    pins.splice(i, 1);
    relabel();
    changed();
    selected = selected === i ? -1 : selected > i ? selected - 1 : selected;
  }
  // The way the nose should point on the taxiway centreline nearest (lat, lon) within the snap reach. A taxiway runs both ways, so which one is
  // wanted comes from how the tug gets there: ctx = { fromLat, fromLon, refDeg } is where it comes from (the previous pin or the aircraft) and the
  // way that is pointing then. If the pin is behind that (within 90 degrees of the tail) the tug reverses to it, and arrives travelling along the
  // taxiway in the direction closest to the line from where it started; the nose is the opposite way. Otherwise it drives forward and the nose is
  // that direction. (Choosing the direction by the smaller turn of the nose alone gets a 90 degree turn wrong half the time.) Runways are not snapped to.
  var SNAP_MAX_M = 50; // the default reach; Settings can change it
  function snapReach() {
    var m = PS.settings && PS.settings.get('snapM');
    return typeof m === 'number' && m > 0 ? m : SNAP_MAX_M;
  }
  var lastSnapMiss = null; // why the last snap found nothing: { nearestM, nearestName, items, off }
  function snapAt(lat, lon, ctx, maxM) {
    if (typeof ctx === 'number') ctx = { refDeg: ctx };
    ctx = ctx || {};
    var refDeg = ctx.refDeg || 0;
    var taxi = PS.state && PS.state.taxi,
      best = null,
      nearest = null,
      usable = 0;
    lastSnapMiss = { nearestM: null, nearestName: '', items: taxi && taxi.items ? taxi.items.length : 0, noData: !taxi || !taxi.items };
    if (!taxi || !taxi.items) return null;
    taxi.items.forEach(function (it) {
      if (!it.points || it.points.length < 2 || it.category === 'Runway') return;
      usable++;
      for (var i = 1; i < it.points.length; i++) {
        var a = it.points[i - 1],
          b = it.points[i];
        var A = G.toXY(lat, lon, a[0], a[1]),
          B = G.toXY(lat, lon, b[0], b[1]);
        var dx = B.x - A.x,
          dy = B.y - A.y,
          len2 = dx * dx + dy * dy;
        if (len2 < 1) continue;
        var t = Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2)),
          px = A.x + t * dx,
          py = A.y + t * dy,
          d = Math.sqrt(px * px + py * py);
        if (!nearest || d < nearest.d) nearest = { d: d, name: it.name || '' };
        if (d <= (maxM || snapReach()) && (!best || d < best.distM))
          best = { distM: d, bearing: G.bearingDeg(a[0], a[1], b[0], b[1]), name: it.name || '', point: G.fromXY(lat, lon, px, py) };
      }
    });
    if (nearest) {
      lastSnapMiss.nearestM = nearest.d;
      lastSnapMiss.nearestName = nearest.name;
    }
    lastSnapMiss.usable = usable;
    if (!best) return null;
    var other = G.normDeg(best.bearing + 180);
    var hasFrom = typeof ctx.fromLat === 'number' && typeof ctx.fromLon === 'number' && G.distanceM(ctx.fromLat, ctx.fromLon, lat, lon) > 1;
    var chord = hasFrom ? G.bearingDeg(ctx.fromLat, ctx.fromLon, lat, lon) : null;
    var reverse = hasFrom && Math.abs(G.angleDiff(G.normDeg(refDeg + 180), chord)) < 90;
    var hdg,
      travel = null,
      how;
    if (hasFrom) {
      travel = Math.abs(G.angleDiff(best.bearing, chord)) <= Math.abs(G.angleDiff(other, chord)) ? best.bearing : other;
      hdg = reverse ? G.normDeg(travel + 180) : travel;
      how =
        (reverse ? 'reversing to it' : 'driving forward to it') +
        ': the line to the pin is ' +
        Math.round(chord) +
        ' deg, so the tug arrives travelling ' +
        Math.round(travel) +
        ' deg and the nose ends ' +
        Math.round(hdg) +
        ' deg';
    } else {
      hdg = Math.abs(G.angleDiff(best.bearing, refDeg)) <= Math.abs(G.angleDiff(other, refDeg)) ? best.bearing : other;
      how = 'by the smaller turn from ' + Math.round(refDeg) + ' deg (no starting point given)';
    }
    var alt = G.normDeg(hdg + 180);
    return {
      headingDeg: Math.round(G.normDeg(hdg)),
      otherDeg: Math.round(alt),
      refDeg: Math.round(G.normDeg(refDeg)),
      chordDeg: chord === null ? null : Math.round(chord),
      reverse: reverse,
      how: how,
      taxiwayDeg: Math.round(G.normDeg(best.bearing)),
      name: best.name,
      distM: best.distM,
      point: best.point
    };
  }
  // Give pin i the heading of the taxiway it sits on (if there is one close by). It stays "snapped" so moving the pin re-snaps it, until the pin
  // is rotated by hand. refDeg is where the aircraft points before this pin: the previous pin's heading, else the aircraft's own.
  function snapPin(i, own) {
    var w = pins[i];
    if (!w) return null;
    if (typeof own === 'number') own = { hdgDeg: own };
    own = own || { hdgDeg: 0 };
    if (PS.settings && !PS.settings.get('snap')) {
      lastSnapMiss = { off: true };
      return null;
    }
    var prev = pins[i - 1],
      usePrev = !!prev;
    var ref = prev && prev.headingUser && prev.headingDeg !== null ? prev.headingDeg : own.hdgDeg;
    var r = snapAt(w.lat, w.lon, { fromLat: usePrev ? prev.lat : own.lat, fromLon: usePrev ? prev.lon : own.lon, refDeg: ref || 0 });
    if (!r) {
      if (w.snapped) {
        w.snapped = false;
        w.snapName = undefined;
        w.headingUser = false;
        w.headingDeg = null;
        changed();
      }
      return null;
    }
    w.headingDeg = r.headingDeg;
    w.headingUser = true;
    w.snapped = true;
    w.snapName = r.name || '';
    changed();
    return r;
  }
  // A snapped pin's heading depends on the pin before it, so after one is moved, deleted or reordered, snap the snapped pins from index `from` on again.
  function resnapFrom(from, own) {
    for (var k = Math.max(0, from); k < pins.length; k++) if (pins[k].snapped) snapPin(k, own);
  }
  // After a pin's heading handle is released: if the nose is within tolerance of the way along the taxiway the pin sits on (either direction),
  // line it up exactly. The heading stays the user's own. Returns { headingDeg, taxiwayDeg, name } if it moved, else null.
  var HANDLE_SNAP_DEG = 12;
  function snapHandle(i) {
    var w = pins[i];
    if (!w || !w.headingUser || w.headingDeg === null || w.headingDeg === undefined) return null;
    if (PS.settings && !PS.settings.get('snap')) return null;
    var r = snapAt(w.lat, w.lon, { refDeg: w.headingDeg });
    if (!r) return null;
    var best = null;
    [r.taxiwayDeg, G.normDeg(r.taxiwayDeg + 180)].forEach(function (d) {
      var off = Math.abs(G.angleDiff(w.headingDeg, d));
      if (off <= HANDLE_SNAP_DEG && (!best || off < best.off)) best = { d: d, off: off };
    });
    if (!best || best.off < 0.5) return null;
    w.headingDeg = Math.round(G.normDeg(best.d));
    changed();
    return { headingDeg: w.headingDeg, taxiwayDeg: r.taxiwayDeg, name: r.name, offDeg: best.off };
  }
  function clear() {
    pins.length = 0;
    selected = -1;
    changed();
  }
  // Pins left from another airport (the aircraft was moved, or a new flight started without the app reloading) are no use here and could send a push
  // across the world. If even the nearest pin is more than FAR_PIN_M from the aircraft they are all deleted. (Judged by the nearest, so a long
  // run planned across a big airport, which starts near the aircraft, is kept.) Returns { count, nearestM } if it cleared them, else null.
  var FAR_PIN_M = 5000;
  function dropFarPins(own) {
    if (!own || !pins.length) return null;
    var nearest = Infinity;
    pins.forEach(function (p) {
      var d = G.distanceM(own.lat, own.lon, p.lat, p.lon);
      if (d < nearest) nearest = d;
    });
    if (!(nearest > FAR_PIN_M)) return null;
    var out = { count: pins.length, nearestM: nearest };
    clear();
    PS.log(
      'plan',
      'pins cleared: ' + out.count + ' pin(s), the nearest ' + (nearest / 1000).toFixed(1) + ' km from the aircraft (another airport?)'
    );
    return out;
  }
  function setHeading(i, deg) {
    if (!pins[i]) return;
    pins[i].snapped = false;
    pins[i].snapName = undefined;
    pins[i].headingDeg = Math.round(G.normDeg(deg));
    pins[i].headingUser = true;
    changed();
  }
  function resetHeading(i) {
    if (!pins[i]) return;
    pins[i].snapped = false;
    pins[i].snapName = undefined;
    pins[i].headingDeg = null;
    pins[i].headingUser = false;
    pins[i].leadInM = undefined;
    changed();
  }
  // Replace the plan (for example with a suggestion's waypoints). Pins the planner added itself (turnaround pins) are dropped: it adds them again.
  function setAll(waypoints) {
    pins.length = 0;
    waypoints.forEach(function (w) {
      if (w.label !== P.TURNAROUND_PIN_LABEL) pins.push(copyPin(w));
    });
    relabel();
    changed();
    selected = -1;
  }
  function select(i) {
    selected = i >= -1 && i < pins.length ? i : -1;
  }

  // The heading (degrees) a drag of the heading handle means: the handle sits behind the tail, so the nose points from the handle through
  // the pin. Screen coordinates (y grows downward).
  function headingFromHandle(pinX, pinY, handleX, handleY) {
    return G.normDeg(G.deg(Math.atan2(pinX - handleX, -(pinY - handleY))));
  }

  // One plan at a given turn radius: the effective waypoints (with any turnaround pin), legs, warnings and the line to draw.
  function planAt(origin, radius, skipTurnaround) {
    var prev = P.getRadius();
    P.setRadius(radius);
    try {
      var o = { lat: origin.lat, lon: origin.lon, hdgDeg: origin.hdgDeg };
      var r = skipTurnaround
        ? { waypoints: P.ensureTerminal(pins), added: false, info: '' }
        : P.withTurnaroundPin(o, P.ensureTerminal(pins));
      var segs = P.plannedRouteSegments(o, r.waypoints);
      var out = {
        radiusM: radius,
        waypoints: r.waypoints,
        turnaroundAdded: r.added,
        info: r.info,
        segments: segs,
        legs: [],
        warnings: [],
        severe: false,
        totalM: 0,
        route: [[origin.lat, origin.lon]]
      };
      segs.forEach(function (g, n) {
        var len = P.pathLengthM(g.points),
          warn = P.segmentWarning(g, radius);
        // The last leg has to end facing the way the end pin says (when it was set): a route that arrives facing elsewhere is not the route asked for.
        var endWp = r.waypoints[r.waypoints.length - 1];
        if (
          !warn &&
          n === segs.length - 1 &&
          endWp &&
          endWp.headingUser &&
          endWp.headingDeg !== null &&
          endWp.headingDeg !== undefined &&
          isFinite(endWp.headingDeg)
        ) {
          var offEnd = Math.abs(G.angleDiff(g.endHdgDeg, endWp.headingDeg));
          if (offEnd > 12)
            warn =
              'The route ends facing ' +
              Math.round(g.endHdgDeg) +
              ' deg but the end pin is set to ' +
              Math.round(endWp.headingDeg) +
              ' deg: the turn does not fit at this radius. Move the pin further away, or change its heading.';
        }
        // A loop (over 270 deg of turning in the path) or a start more than 90 deg off the aircraft's axis cannot be driven at all
        if (P.pathTurnDeg(g.points) > 270 || g.startOffDeg > 90) out.severe = true;
        out.legs.push({
          sign: g.sign,
          lengthM: len,
          endHdgDeg: g.endHdgDeg,
          warning: warn,
          pinIdx: g.pinIdx,
          tightestRadiusM: g.tightestRadiusM
        });
        out.totalM += len;
        if (warn) out.warnings.push('Leg ' + (n + 1) + ': ' + warn);
        g.points.forEach(function (pt, i) {
          if (!(i === 0 && out.route.length > 1)) out.route.push(pt);
        });
      });
      return out;
    } finally {
      P.setRadius(prev);
    }
  }

  // Log what the planner made of the pins whenever it changes, and every warning in full with the pins that led to it.
  var lastLogged = '';
  function logResult(res, origin) {
    if (res.empty) {
      if (lastLogged !== 'empty') {
        lastLogged = 'empty';
        PS.logv('plan', 'no pins: no route');
      }
      return;
    }
    var sig =
      res.warnings.join('|') +
      '#' +
      res.legs
        .map(function (l) {
          return l.sign + ':' + Math.round(l.lengthM / 5);
        })
        .join(',') +
      '#' +
      Math.round(res.radiusM) +
      '#' +
      pins
        .map(function (w) {
          return w.id + (w.headingUser ? w.headingDeg : '');
        })
        .join(',');
    if (sig === lastLogged) return;
    lastLogged = sig;
    var legs = res.legs.map(function (l, n) {
      return (
        'leg ' +
        (n + 1) +
        ' ' +
        (l.sign < 0 ? 'back' : 'forward') +
        ' ' +
        Math.round(l.lengthM) +
        ' m, ends ' +
        Math.round(l.endHdgDeg) +
        ' deg, tightest ' +
        (l.tightestRadiusM ? Math.round(l.tightestRadiusM) + ' m' : '-')
      );
    });
    PS.logv(
      'plan',
      'route: ' +
        Math.round(res.totalM) +
        ' m, ' +
        res.legs.length +
        ' leg(s), radius ' +
        Math.round(res.radiusM) +
        ' m' +
        (res.adapted ? ' (tightened)' : '') +
        (res.turnaroundAdded ? ', turnaround pin added' : '') +
        (origin && isFinite(origin.lat)
          ? ' | from ' + origin.lat.toFixed(5) + ', ' + origin.lon.toFixed(5) + ' heading ' + (isFinite(origin.hdgDeg) ? Math.round(origin.hdgDeg) : '?')
          : '') +
        ' | ' +
        legs.join('; ')
    );
    res.items.forEach(function (it, k) {
      var w = it.wp,
        how =
          w.label === P.TURNAROUND_PIN_LABEL
            ? 'turnaround pin'
            : w.headingUser
              ? w.snapped
                ? 'snapped to ' + (w.snapName ? 'taxiway ' + w.snapName : 'an unnamed taxiway')
                : 'set by you'
              : 'auto';
      PS.logv(
        'plan',
        '  pin ' +
          (k + 1) +
          ' (' +
          w.label +
          ') at ' +
          w.lat.toFixed(5) +
          ', ' +
          w.lon.toFixed(5) +
          ': heading ' +
          (w.headingUser ? Math.round(w.headingDeg) + ' deg ' : '') +
          '[' +
          how +
          '], planned nose ' +
          (it.headingDeg === null || it.headingDeg === undefined ? '?' : Math.round(it.headingDeg) + ' deg')
      );
    });
    if (res.turnaroundAdded && res.info) PS.logv('plan', 'turnaround pin: ' + res.info);
    if (res.warnings.length) {
      res.warnings.forEach(function (w) {
        PS.log('plan', 'WARNING ' + w);
      });
      PS.logv(
        'plan',
        'pins behind the warning (aircraft at heading ' +
          Math.round(origin.hdgDeg) +
          ' deg): ' +
          res.waypoints
            .map(function (w, i) {
              return (
                i +
                1 +
                '=' +
                w.lat.toFixed(5) +
                ',' +
                w.lon.toFixed(5) +
                ' ' +
                (w.headingUser
                  ? 'heading ' +
                    Math.round(w.headingDeg) +
                    ' deg (' +
                    (w.snapped ? 'snapped to ' + (w.snapName ? 'taxiway ' + w.snapName : 'an unnamed taxiway') : 'set by you') +
                    ')'
                  : 'auto') +
                (w.label === P.TURNAROUND_PIN_LABEL ? ' [turnaround]' : '')
              );
            })
            .join('; ')
      );
    } else {
      PS.logv('plan', 'route plans without a warning');
    }
  }
  // The planned route for the pins, from the aircraft. origin: { lat, lon, hdgDeg }.
  // Returns { empty, waypoints (with any turnaround pin), segments, route ([[lat, lon], ...] from the aircraft), items, legs, totalM, warnings,
  //           turnaroundAdded, info, radiusM (the turn radius planned with), adapted (a tighter one than usual was needed) }
  // items: one per effective waypoint { wp, userIndex (-1 for a planner-added pin), headingDeg (the nose there), turnaround }.
  function evaluate(origin) {
    var key = JSON.stringify([
      pins.map(function (w) {
        return [w.id, w.lat, w.lon, w.headingDeg, w.headingUser, w.leadInM];
      }),
      origin.lat.toFixed(6),
      origin.lon.toFixed(6),
      Math.round(origin.hdgDeg),
      turn.radiusM,
      turn.minRadiusM
    ]);
    if (cache.key === key && cache.value) return cache.value;
    var res = {
      empty: pins.length === 0,
      waypoints: [],
      segments: [],
      route: [[origin.lat, origin.lon]],
      items: [],
      legs: [],
      totalM: 0,
      warnings: [],
      severe: false,
      turnaroundAdded: false,
      info: '',
      radiusM: turn.radiusM,
      adapted: false
    };
    if (pins.length) {
      var best = planAt(origin, turn.radiusM);
      // A turnaround pin (pull forward, then reverse in) is the last resort: if a plain single route works at a tighter turn radius, that is simpler.
      if (best.turnaroundAdded && turn.minRadiusM < turn.radiusM - 0.5) {
        var rr0 = [];
        for (var q = turn.radiusM * 0.88; q > turn.minRadiusM + 0.5; q *= 0.88) rr0.push(q);
        rr0.push(turn.minRadiusM);
        for (var qi = 0; qi < rr0.length; qi++) {
          var plain = planAt(origin, rr0[qi], true);
          if (!plain.warnings.length && plain.segments.length === best.segments.length - (best.turnaroundAdded ? 1 : 0)) {
            best = plain;
            break;
          }
        }
      }
      if (best.warnings.length && turn.minRadiusM < turn.radiusM - 0.5) {
        // Too cramped at the usual radius: step the radius down (about 12% at a time) to the tightest allowed, taking the first that is clean.
        var radii = [];
        for (var rr = turn.radiusM * 0.88; rr > turn.minRadiusM + 0.5; rr *= 0.88) radii.push(rr);
        radii.push(turn.minRadiusM);
        for (var i = 0; i < radii.length; i++) {
          var t = planAt(origin, radii[i]);
          if (!t.warnings.length) {
            best = t;
            break;
          }
        }
      }
      res.waypoints = best.waypoints;
      res.turnaroundAdded = best.turnaroundAdded;
      res.info = best.info;
      res.segments = best.segments;
      res.legs = best.legs;
      res.warnings = best.warnings;
      res.severe = !!best.severe;
      res.totalM = best.totalM;
      res.route = best.route;
      res.radiusM = best.radiusM;
      res.adapted = best.radiusM < turn.radiusM - 0.5;
      var headings = P.plannedPinHeadings(res.segments, res.waypoints);
      res.items = res.waypoints.map(function (w, idx) {
        var ui = -1;
        for (var k = 0; k < pins.length; k++) {
          if (pins[k].id === w.id) {
            ui = k;
            break;
          }
        }
        return {
          wp: w,
          userIndex: ui,
          headingDeg: w.headingUser && w.headingDeg !== null && w.headingDeg !== undefined ? w.headingDeg : headings[idx],
          turnaround: w.label === P.TURNAROUND_PIN_LABEL
        };
      });
    }
    cache.key = key;
    cache.value = res;
    logResult(res, origin);
    return res;
  }

  return {
    list: function () {
      return pins;
    },
    count: function () {
      return pins.length;
    },
    selected: function () {
      return selected;
    },
    select: select,
    add: add,
    move: move,
    reorder: reorder,
    remove: remove,
    clear: clear,
    dropFarPins: dropFarPins,
    FAR_PIN_M: FAR_PIN_M,
    setHeading: setHeading,
    resetHeading: resetHeading,
    setAll: setAll,
    headingFromHandle: headingFromHandle,
    snapAt: snapAt,
    snapPin: snapPin,
    resnapFrom: resnapFrom,
    snapHandle: snapHandle,
    snapEnabled: function () {
      return !PS.settings || !!PS.settings.get('snap');
    },
    snapMiss: function () {
      return lastSnapMiss;
    },
    snapMaxM: snapReach,
    evaluate: evaluate,
    turn: function () {
      return turn;
    },
    setMinRadius: setMinRadius,
    useAircraft: useAircraft,
    minRadius: function () {
      return turn.minRadiusM;
    }
  };
})();
