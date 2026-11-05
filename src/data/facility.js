// Facility data: finds the nearest airport and loads its runways (sim facility loader) and taxi paths and parking (taxi WASM module).
// Used by the Plan tab (it came from the earlier Taxiways test page, now on the spikes-app branch).

PS.facility = {
  // Candidate ICAO spellings the facility APIs might expect for an airport.
  rawByIdent: {}, // ident -> the exact ICAO string the sim's nearest search returned
  icaoCandidates: function (icao) {
    var id = icao.toUpperCase();
    var list = [];
    if (PS.facility.rawByIdent[id]) list.push(PS.facility.rawByIdent[id]);
    return list.concat(['A      ' + id, id, 'A  ' + id + '     ', 'A' + id]);
  },

  // Finds the airport nearest to (lat, lon) with the sdk's nearest search, then picks the closest by real distance.
  // Resolves { ident, raw, distM, candidates: [{ident, distM}] }.
  nearestAirport: function (lat, lon) {
    var sdk = PS.global.msfssdk;
    if (!sdk || !sdk.FacilityLoader || !sdk.FacilityRepository || !sdk.FacilitySearchType)
      return Promise.reject(new Error('msfssdk has no FacilityLoader / FacilitySearchType'));
    if (!PS.state.bus) return Promise.reject(new Error('no EFB bus handed to the app'));
    var loader = new sdk.FacilityLoader(sdk.FacilityRepository.getRepository(PS.state.bus));
    // A fresh session each time: a session only reports changes since its previous search.
    return PS.facility
      .withTimeout(loader.startNearestSearchSession(sdk.FacilitySearchType.Airport), 4000, 'start nearest search')
      .then(function (session) {
        return PS.facility.withTimeout(session.searchNearest(lat, lon, 30000, 6), 4000, 'searchNearest');
      })
      .then(function (res) {
        var added = (res && res.added) || [];
        PS.logv('taxi', 'nearest search returned ' + added.length + ' airport(s): ' + JSON.stringify(added));
        if (!added.length) throw new Error('no airport within 30 km');
        return Promise.all(
          added.map(function (raw) {
            return PS.facility.withTimeout(loader.getFacility(sdk.FacilityType.Airport, raw), 3000, 'getFacility ' + raw).then(
              function (f) {
                var flat = f.lat !== undefined ? f.lat : f.latitude !== undefined ? f.latitude : null;
                var flon = f.lon !== undefined ? f.lon : f.lng !== undefined ? f.lng : f.longitude !== undefined ? f.longitude : null;
                var ident = String(raw).replace(/^A\s*/, '').trim();
                return { ident: ident, raw: raw, distM: flat === null ? 1e12 : PS.geo.distanceM(lat, lon, flat, flon) };
              },
              function () {
                return { ident: String(raw).replace(/^A\s*/, '').trim(), raw: raw, distM: 1e12 };
              }
            );
          })
        );
      })
      .then(function (list) {
        list.sort(function (a, b) {
          return a.distM - b.distM;
        });
        list.forEach(function (c) {
          PS.facility.rawByIdent[c.ident.toUpperCase()] = c.raw;
          PS.logv('taxi', '  candidate ' + c.ident + ' ' + (c.distM < 1e11 ? PS.fmt.dist(c.distM) : 'distance unknown'));
        });
        return { ident: list[0].ident, raw: list[0].raw, distM: list[0].distM, candidates: list };
      });
  },

  withTimeout: function (promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error(label + ' timed out after ' + ms + ' ms'));
        }
      }, ms);
      promise.then(
        function (v) {
          if (!done) {
            done = true;
            clearTimeout(t);
            resolve(v);
          }
        },
        function (e) {
          if (!done) {
            done = true;
            clearTimeout(t);
            reject(e);
          }
        }
      );
    });
  },

  // Strategy A: msfs-sdk FacilityLoader (needs the EFB event bus).
  viaSdkLoader: function (icao) {
    var sdk = PS.global.msfssdk;
    if (!sdk) return Promise.reject(new Error('msfssdk not available'));
    if (!sdk.FacilityLoader || !sdk.FacilityRepository || !sdk.FacilityType)
      return Promise.reject(new Error('msfssdk has no FacilityLoader / FacilityRepository / FacilityType'));
    if (!PS.state.bus) return Promise.reject(new Error('no EFB bus handed to the app'));
    var loader = new sdk.FacilityLoader(sdk.FacilityRepository.getRepository(PS.state.bus));
    var cands = PS.facility.icaoCandidates(icao);
    var chain = Promise.reject(new Error('start'));
    cands.forEach(function (c) {
      chain = chain.then(null, function () {
        PS.logv('taxi', 'FacilityLoader.getFacility(Airport, ' + JSON.stringify(c) + ')');
        return PS.facility.withTimeout(loader.getFacility(sdk.FacilityType.Airport, c), 3000, 'getFacility ' + JSON.stringify(c));
      });
    });
    return chain;
  },

  // Strategy B: the sim's JS facility listener (RegisterViewListener + Coherent events). Names are from memory of the
  // sim's own JS and are unverified.
  viaListener: function (icao) {
    var co = PS.coherent();
    if (!co || !co.call || !co.on) return Promise.reject(new Error('Coherent call/on not available'));
    return PS.facility.withTimeout(
      new Promise(function (resolve, reject) {
        try {
          if (typeof RegisterViewListener === 'function')
            RegisterViewListener('JS_LISTENER_FACILITY', function () {
              PS.logv('taxi', 'JS_LISTENER_FACILITY ready');
            });
          else PS.logv('taxi', 'RegisterViewListener is not a function here');
          co.on('SendAirport', function (data) {
            resolve(data);
          });
          var cands = PS.facility.icaoCandidates(icao);
          PS.logv('taxi', 'Coherent.call LOAD_AIRPORT ' + JSON.stringify(cands[1]));
          var r = co.call('LOAD_AIRPORT', cands[1]);
          if (r && typeof r.then === 'function') r.then(null, reject);
        } catch (e) {
          reject(e);
        }
      }),
      6000,
      'LOAD_AIRPORT / SendAirport'
    );
  }
};

// Loads everything available for an airport: runways and gates from the SDK FacilityLoader, taxi paths and parking from
// the WASM module. Either half may fail; it only rejects when both do. Resolves { raw, notes, hasSdk, hasWasm }.
PS.facility.loadAirport = function (ident) {
  var notes = [];
  var sdkP = PS.facility.viaSdkLoader(ident).then(
    function (r) {
      return r;
    },
    function (e) {
      notes.push('FacilityLoader: ' + PS.errText(e));
      PS.log('taxi', 'FacilityLoader failed: ' + PS.errText(e));
      return null;
    }
  );
  var wasmP = PS.wasmTaxi.request(ident).then(
    function (r) {
      return r;
    },
    function (e) {
      notes.push('taxi module: ' + PS.errText(e));
      PS.log('taxi', 'taxi module failed: ' + PS.errText(e));
      return null;
    }
  );
  return Promise.all([sdkP, wasmP]).then(function (pair) {
    var sdkRaw = pair[0],
      w = pair[1];
    if (!sdkRaw && !w) throw new Error(notes.join(' | '));
    var raw = {};
    if (sdkRaw && typeof sdkRaw === 'object') {
      Object.keys(sdkRaw).forEach(function (k) {
        raw[k] = sdkRaw[k];
      });
    }
    if (w) {
      raw.icao = raw.icao || w.icao;
      raw.refLat = w.refLat;
      raw.refLon = w.refLon;
      raw.paths = w.paths;
      raw.parking = w.parking;
      delete raw.gates; // the module's parking list is the fuller one
      raw.taxiModule = w.counts;
    }
    return { raw: raw, notes: notes, hasSdk: !!sdkRaw, hasWasm: !!w, counts: w ? w.counts : null };
  });
};

// Finds the nearest airport and puts its runways (and taxiways, if any) into PS.state.taxi for the map to draw.
PS.facility.loadNearestIntoState = function () {
  var own = PS.readOwn();
  if (!own) return Promise.reject(new Error('aircraft position not readable'));
  return PS.facility.nearestAirport(own.lat, own.lon).then(function (r) {
    return PS.facility.loadAirport(r.ident).then(function (res) {
      var ex = PS.taxi.extract(res.raw);
      PS.state.taxi = { items: ex.items, parking: ex.parking, icao: r.ident };
      PS.log(
        'map',
        'loaded ' +
          r.ident +
          ' for the map: ' +
          ex.items.length +
          ' runway/path item(s), ' +
          ex.parking.length +
          ' parking (taxi module ' +
          (res.hasWasm ? 'answered' : 'did not answer') +
          ')'
      );
      return r.ident;
    });
  });
};
