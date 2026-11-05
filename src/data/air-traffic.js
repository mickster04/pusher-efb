// AI traffic from the sim: the sdk's TrafficInstrument source (JS_LISTENER_AIR_TRAFFIC, GET_AIR_TRAFFIC), polled by whoever draws it.

// AI traffic as the msfs-sdk TrafficInstrument reads it: RegisterViewListener('JS_LISTENER_AIR_TRAFFIC') then
// listener.call('GET_AIR_TRAFFIC'), which returns entries { uId, name, lat, lon, alt (metres), heading }.
// Speed is not in the entry, so it is worked out from successive positions.
PS.airTraffic = {
  listener: null,
  ready: false,
  busy: false,
  started: false,
  error: '',
  calls: 0,
  entries: 0,
  prev: {},
  contacts: [],
  loggedShape: false,
  ownIds: {},

  // The sim can list our own aircraft among the traffic (it showed as a competing aircraft while pushing). A contact within OWN_NEAR_M of our position is
  // us, and stays ignored (by its uId) while it is within OWN_STICKY_M, since it can lag a little behind us as we move.
  OWN_NEAR_M: 15,
  OWN_STICKY_M: 80,
  ignoreOwn: function (contacts, own) {
    var T = PS.airTraffic;
    if (!own || typeof own.lat !== 'number' || typeof own.lon !== 'number') return contacts;
    var out = [],
      ids = {};
    contacts.forEach(function (c) {
      var d = PS.geo.distanceM(own.lat, own.lon, c.lat, c.lon);
      if (d <= T.OWN_NEAR_M || (T.ownIds[c.id] && d <= T.OWN_STICKY_M)) {
        if (!T.ownIds[c.id])
          PS.logv(
            'traffic',
            'ignoring contact ' + c.title + ' (' + c.id + '): it is our own aircraft, ' + PS.fmt.num(d, 0) + ' m from our position'
          );
        ids[c.id] = true;
        return;
      }
      out.push(c);
    });
    T.ownIds = ids;
    return out;
  },

  start: function () {
    var T = PS.airTraffic;
    if (T.started) return;
    T.started = true;
    if (typeof RegisterViewListener !== 'function') {
      T.error = 'RegisterViewListener is not available';
      PS.log('traffic', T.error);
      return;
    }
    try {
      var l = RegisterViewListener('JS_LISTENER_AIR_TRAFFIC', function () {
        T.ready = true;
        PS.logv('traffic', 'JS_LISTENER_AIR_TRAFFIC ready');
      });
      T.listener = l;
      PS.logv('traffic', 'registered JS_LISTENER_AIR_TRAFFIC');
    } catch (e) {
      T.error = 'register failed: ' + PS.errText(e);
      PS.log('traffic', T.error);
    }
  },

  poll: function () {
    var T = PS.airTraffic;
    if (!T.started) T.start();
    if (!T.listener || !T.ready || T.busy) return;
    T.busy = true;
    var r;
    try {
      r = T.listener.call('GET_AIR_TRAFFIC');
    } catch (e) {
      T.busy = false;
      T.error = 'call failed: ' + PS.errText(e);
      PS.log('traffic', T.error);
      return;
    }
    Promise.resolve(r).then(
      function (data) {
        T.busy = false;
        T.calls++;
        if (!data || typeof data.length !== 'number') {
          T.error = 'GET_AIR_TRAFFIC returned ' + typeof data;
          return;
        }
        T.error = '';
        T.lastAt = Date.now();
        T.entries = data.length;
        if (!T.loggedShape && data.length) {
          T.loggedShape = true;
          try {
            PS.logv('traffic', 'first GET_AIR_TRAFFIC entry: ' + JSON.stringify(data[0]));
          } catch (e) {
            /* ignore */
          }
        }
        var now = Date.now(),
          out = [],
          seen = {};
        for (var i = 0; i < data.length; i++) {
          var d = data[i];
          if (typeof d.lat !== 'number' || typeof d.lon !== 'number') continue;
          var prev = T.prev[d.uId];
          var gs = prev ? prev.gsKt : 0;
          var track = prev ? prev.track : d.heading || 0;
          if (prev) {
            var dt = (now - prev.t) / 1000;
            if (dt >= 0.4) {
              var dm = PS.geo.distanceM(prev.lat, prev.lon, d.lat, d.lon);
              gs = dm / dt / PS.geo.KT_TO_MS;
              if (dm > 0.5) track = PS.geo.bearingDeg(prev.lat, prev.lon, d.lat, d.lon);
              T.prev[d.uId] = { t: now, lat: d.lat, lon: d.lon, gsKt: gs, track: track };
            }
          } else {
            T.prev[d.uId] = { t: now, lat: d.lat, lon: d.lon, gsKt: 0, track: d.heading || 0 };
          }
          seen[d.uId] = true;
          out.push({
            id: d.uId,
            title: (d.name || String(d.uId)) + (d.plane_model_icao ? ' ' + d.plane_model_icao : ''),
            lat: d.lat,
            lon: d.lon,
            hdgDeg: d.heading || 0,
            gsKt: gs,
            trackDeg: track,
            altFt: (d.alt || 0) * 3.28084,
            onGround: d.isOnGround === true ? true : d.isOnGround === false ? false : null
          });
        }
        for (var k in T.prev) {
          if (!seen[k]) delete T.prev[k];
        }
        T.contacts = T.ignoreOwn(out, PS.readOwn());
      },
      function (e) {
        T.busy = false;
        T.error = 'GET_AIR_TRAFFIC failed: ' + PS.errText(e);
        PS.log('traffic', T.error);
      }
    );
  }
};
