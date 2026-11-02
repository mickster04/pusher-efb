// Spike 3: can taxiway data be read from JS, and what can we show about it?
// The loaders below are candidates, tried and reported one by one. The original app reads taxi paths through
// SimConnect facility data, which an EFB app may not be able to reach; this page finds out.

PS.facility = {
  // Candidate ICAO spellings the facility APIs might expect for an airport.
  rawByIdent: {},   // ident -> the exact ICAO string the sim's nearest search returned
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
    if (!sdk || !sdk.FacilityLoader || !sdk.FacilityRepository || !sdk.FacilitySearchType) return Promise.reject(new Error('msfssdk has no FacilityLoader / FacilitySearchType'));
    if (!PS.state.bus) return Promise.reject(new Error('no EFB bus handed to the app'));
    var loader = new sdk.FacilityLoader(sdk.FacilityRepository.getRepository(PS.state.bus));
    // A fresh session each time: a session only reports changes since its previous search.
    return PS.facility.withTimeout(loader.startNearestSearchSession(sdk.FacilitySearchType.Airport), 4000, 'start nearest search')
      .then(function (session) { return PS.facility.withTimeout(session.searchNearest(lat, lon, 30000, 6), 4000, 'searchNearest'); })
      .then(function (res) {
        var added = (res && res.added) || [];
        PS.log('taxi', 'nearest search returned ' + added.length + ' airport(s): ' + JSON.stringify(added));
        if (!added.length) throw new Error('no airport within 30 km');
        return Promise.all(added.map(function (raw) {
          return PS.facility.withTimeout(loader.getFacility(sdk.FacilityType.Airport, raw), 3000, 'getFacility ' + raw).then(function (f) {
            var flat = f.lat !== undefined ? f.lat : (f.latitude !== undefined ? f.latitude : null);
            var flon = f.lon !== undefined ? f.lon : (f.lng !== undefined ? f.lng : (f.longitude !== undefined ? f.longitude : null));
            var ident = String(raw).replace(/^A\s*/, '').trim();
            return { ident: ident, raw: raw, distM: flat === null ? 1e12 : PS.geo.distanceM(lat, lon, flat, flon) };
          }, function () { return { ident: String(raw).replace(/^A\s*/, '').trim(), raw: raw, distM: 1e12 }; });
        }));
      })
      .then(function (list) {
        list.sort(function (a, b) { return a.distM - b.distM; });
        list.forEach(function (c) { PS.facility.rawByIdent[c.ident.toUpperCase()] = c.raw; PS.log('taxi', '  candidate ' + c.ident + ' ' + (c.distM < 1e11 ? PS.fmt.dist(c.distM) : 'distance unknown')); });
        return { ident: list[0].ident, raw: list[0].raw, distM: list[0].distM, candidates: list };
      });
  },

  withTimeout: function (promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error(label + ' timed out after ' + ms + ' ms')); } }, ms);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });
  },

  // Strategy A: msfs-sdk FacilityLoader (needs the EFB event bus).
  viaSdkLoader: function (icao) {
    var sdk = PS.global.msfssdk;
    if (!sdk) return Promise.reject(new Error('msfssdk not available'));
    if (!sdk.FacilityLoader || !sdk.FacilityRepository || !sdk.FacilityType) return Promise.reject(new Error('msfssdk has no FacilityLoader / FacilityRepository / FacilityType'));
    if (!PS.state.bus) return Promise.reject(new Error('no EFB bus handed to the app'));
    var loader = new sdk.FacilityLoader(sdk.FacilityRepository.getRepository(PS.state.bus));
    var cands = PS.facility.icaoCandidates(icao);
    var chain = Promise.reject(new Error('start'));
    cands.forEach(function (c) {
      chain = chain.then(null, function () {
        PS.log('taxi', 'FacilityLoader.getFacility(Airport, ' + JSON.stringify(c) + ')');
        return PS.facility.withTimeout(loader.getFacility(sdk.FacilityType.Airport, c), 3000,'getFacility ' + JSON.stringify(c));
      });
    });
    return chain;
  },

  // Strategy B: the sim's JS facility listener (RegisterViewListener + Coherent events). Names are from memory of the
  // sim's own JS and are unverified.
  viaListener: function (icao) {
    var co = PS.coherent();
    if (!co || !co.call || !co.on) return Promise.reject(new Error('Coherent call/on not available'));
    return PS.facility.withTimeout(new Promise(function (resolve, reject) {
      try {
        if (typeof RegisterViewListener === 'function') RegisterViewListener('JS_LISTENER_FACILITY', function () { PS.log('taxi', 'JS_LISTENER_FACILITY ready'); });
        else PS.log('taxi', 'RegisterViewListener is not a function here');
        co.on('SendAirport', function (data) { resolve(data); });
        var cands = PS.facility.icaoCandidates(icao);
        PS.log('taxi', 'Coherent.call LOAD_AIRPORT ' + JSON.stringify(cands[1]));
        var r = co.call('LOAD_AIRPORT', cands[1]);
        if (r && typeof r.then === 'function') r.then(null, reject);
      } catch (e) { reject(e); }
    }), 6000, 'LOAD_AIRPORT / SendAirport');
  }
};

PS.pages.push({
  id: 'taxiways',
  title: '3 Taxiways',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var icaoIn = ui.input('EGLL', { maxlength: '4', style: 'width:6em;text-transform:uppercase' });
    var status = h('div', { class: 'ps-result', text: 'Nothing loaded.' });
    var rawBox = h('pre', { class: 'ps-log ps-raw', text: '(nothing yet)' });
    var tbl = ui.table(['Name', 'Category', 'Segments', 'Length', 'Width', 'Nearest', 'Bearing']);
    var parkTbl = ui.table(['Stand', 'Heading', 'Radius', 'Distance']);
    var sortSel = ui.select([{ value: 'near', label: 'Nearest first' }, { value: 'name', label: 'Name' }, { value: 'length', label: 'Longest first' }], 'near', function () { repaint(); });
    var catSel = ui.select([{ value: 'all', label: 'All categories' }, { value: 'Taxiway', label: 'Taxiways' }, { value: 'Runway', label: 'Runways' }, { value: 'Parking connector', label: 'Parking connectors' }, { value: 'other', label: 'Other' }], 'all', function () { repaint(); });
    var current = null; // { source, extracted }

    function say(text, bad) { status.textContent = text; status.className = 'ps-result ' + (bad ? 'bad' : 'ok'); PS.log('taxi', text); }

    function repaint() {
      PS.clear(tbl.body); PS.clear(parkTbl.body);
      if (!current) return;
      var own = PS.readOwn();
      var ownLat = own ? own.lat : (current.refLat !== undefined ? current.refLat : undefined);
      var ownLon = own ? own.lon : (current.refLon !== undefined ? current.refLon : undefined);
      var rows = PS.taxi.aggregate(current.extracted.items, ownLat, ownLon);
      var cat = catSel.value;
      rows = rows.filter(function (r) {
        if (cat === 'all') return true;
        if (cat === 'other') return ['Taxiway', 'Runway', 'Parking connector'].indexOf(r.category) < 0;
        return r.category === cat;
      });
      if (sortSel.value === 'name') rows.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      if (sortSel.value === 'length') rows.sort(function (a, b) { return (b.lengthM || 0) - (a.lengthM || 0); });
      rows.forEach(function (r) {
        tbl.body.appendChild(h('tr', null,
          h('td', { text: r.name }), h('td', { text: r.category }), h('td', { text: String(r.segments) }),
          h('td', { text: r.lengthM === null ? '—' : PS.fmt.dist(r.lengthM) }),
          h('td', { text: r.widthM === null ? '—' : Math.round(r.widthM) + ' m' }),
          h('td', { text: r.nearestM === null ? '—' : PS.fmt.dist(r.nearestM) }),
          h('td', { text: r.bearingDeg === null ? '—' : Math.round(r.bearingDeg) + '°' })));
      });
      current.extracted.parking.forEach(function (p) {
        var d = own && p.lat !== null ? PS.geo.distanceM(own.lat, own.lon, p.lat, p.lon) : null;
        parkTbl.body.appendChild(h('tr', null, h('td', { text: p.name }),
          h('td', { text: p.headingDeg === null ? '—' : Math.round(p.headingDeg) + '°' }),
          h('td', { text: p.radiusM === null ? '—' : Math.round(p.radiusM) + ' m' }),
          h('td', { text: d === null ? '—' : PS.fmt.dist(d) })));
      });
      PS.state.taxi = { items: current.extracted.items, parking: current.extracted.parking };
    }

    function accept(source, raw) {
      var text;
      try { text = JSON.stringify(raw, null, 1); } catch (e) { text = '(not serialisable: ' + PS.errText(e) + ')'; }
      rawBox.textContent = (text || String(raw)).substring(0, 8000) + ((text && text.length > 8000) ? '\n... truncated' : '');
      var ex = PS.taxi.extract(raw);
      current = { source: source, extracted: ex, refLat: raw && raw.refLat, refLon: raw && raw.refLon };
      var nTaxi = ex.items.filter(function (i) { return i.category !== 'Runway'; }).length;
      var nRw = ex.items.length - nTaxi;
      say('Source: ' + source + '. Found ' + nRw + ' runway(s), ' + nTaxi + ' taxiway/path item(s), ' + ex.parking.length + ' parking spot(s).' +
        (ex.notes.length ? ' ' + ex.notes.join(' ') : ''), ex.items.length === 0);
      repaint();
    }

    var detected = false;
    function detectAirport(thenLoad) {
      var own = PS.readOwn();
      if (!own) { say('Cannot detect the airport: the aircraft position is not readable.', true); return; }
      say('Finding the nearest airport...');
      PS.facility.nearestAirport(own.lat, own.lon).then(function (r) {
        icaoIn.value = r.ident;
        say('Nearest airport: ' + r.ident + (r.distM < 1e11 ? ' (' + PS.fmt.dist(r.distM) + ' away)' : '') + '.');
        if (thenLoad) loadFromSim();
      }, function (e) { say('Could not detect the airport: ' + PS.errText(e), true); });
    }

    function loadFromSim() {
      var icao = icaoIn.value.trim().toUpperCase();
      if (icao.length < 3) { say('Enter an ICAO code first.', true); return; }
      say('Trying the sim facility APIs for ' + icao + '...');
      PS.facility.viaSdkLoader(icao).then(function (raw) { accept('msfs-sdk FacilityLoader', raw); }, function (e1) {
        PS.log('taxi', 'FacilityLoader failed: ' + PS.errText(e1));
        PS.facility.viaListener(icao).then(function (raw) { accept('JS_LISTENER_FACILITY', raw); }, function (e2) {
          PS.log('taxi', 'Listener failed: ' + PS.errText(e2));
          say('No facility API returned data. FacilityLoader: ' + PS.errText(e1) + ' | Listener: ' + PS.errText(e2), true);
        });
      });
    }
    function useSample() {
      var own = PS.readOwn();
      var lat = own ? own.lat : 51.47, lon = own ? own.lon : -0.4543;
      var s = PS.taxi.sample(lat, lon);
      accept('offline sample (not from the sim)', { icao: s.icao, refLat: s.refLat, refLon: s.refLon, runways: s.runways, paths: s.paths, parking: s.parking });
    }

    var el = h('div', { class: 'ps-page' },
      ui.panel('Load taxiway data',
        h('div', { class: 'ps-row' }, ui.field('Airport ICAO', icaoIn),
          ui.button('Detect nearest airport and load', function () { detectAirport(true); }),
          ui.button('Detect only', function () { detectAirport(false); }, 'ps-ghost'),
          ui.button('Load typed ICAO', loadFromSim), ui.button('Use offline sample', useSample, 'ps-ghost')),
        status,
        ui.note('Needs a result the original app got through SimConnect facility data. If nothing comes back here, taxiways need a WASM module or a bundled dataset. The sample button only exercises the table.')),
      ui.panel('Named taxiways, runways and connectors',
        h('div', { class: 'ps-row' }, ui.field('Sort', sortSel), ui.field('Show', catSel)),
        tbl.el),
      ui.panel('Parking', parkTbl.el),
      ui.panel('Raw data returned', rawBox),
      ui.panel('Log', ui.logBox(['taxi']))
    );
    return {
      el: el,
      snapshot: function () { return status.textContent + '\n\nRaw data returned:\n' + rawBox.textContent; },
      onShow: function () { repaint(); if (!detected) { detected = true; detectAirport(false); } },
      onHide: function () {}
    };
  }
});
