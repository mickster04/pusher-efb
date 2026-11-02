// Spike 4: can AI traffic be listed from JS, and what is useful to show about it?
// No JS source for AI aircraft is confirmed. The page lists candidate APIs it can find, takes contacts from the
// first source that returns any, and can show simulated contacts so the table and maths can be reviewed.

PS.trafficSources = []; // functions returning an array of { id, title, lat, lon, hdgDeg, gsKt, altFt, onGround } or null

PS.discoverTrafficApis = function () {
  var found = [];
  var re = /traffic|tcas|\bai\b|aiobject|simobject/i;
  function scan(label, obj) {
    if (!obj) return;
    var keys = [];
    try { keys = Object.getOwnPropertyNames(obj); } catch (e) { keys = []; }
    keys.forEach(function (k) { if (re.test(k)) found.push(label + '.' + k); });
  }
  scan('window', PS.global);
  scan('msfssdk', PS.global.msfssdk);
  scan('SimVar', PS.simVar());
  scan('Coherent', PS.coherent());
  return found;
};

PS.pages.push({
  id: 'traffic',
  title: '4 Traffic',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var timer = null;
    var simulate = false;
    var simContacts = null;
    var lastTs = 0;
    var sourceLine = h('div', { class: 'ps-result', text: 'No traffic source checked yet.' });
    var apiBox = h('pre', { class: 'ps-log', text: '(press Discover)' });
    var tbl = ui.table(['Contact', 'Distance', 'Bearing', 'Relative', 'Alt diff', 'Speed', 'Heading', 'Closing', 'Time to closest', 'Closest', 'Ahead']);
    var sortSel = ui.select([{ value: 'dist', label: 'Nearest first' }, { value: 'tcpa', label: 'Soonest closest approach' }], 'dist');

    function ownOrReference() {
      var o = PS.readOwn();
      if (o) return { own: o, live: true };
      return { own: { lat: 51.4700, lon: -0.4543, hdgDeg: 90, gsKt: 0, altFt: 80, onGround: true }, live: false };
    }

    function discover() {
      var found = PS.discoverTrafficApis();
      apiBox.textContent = found.length ? found.join('\n') : 'No names matching traffic / tcas / ai / simobject found on window, msfssdk, SimVar or Coherent.';
      PS.log('traffic', 'discovery: ' + found.length + ' candidate name(s)');
      found.forEach(function (n) { PS.log('traffic', '  candidate ' + n); });
    }

    function fetchContacts() {
      for (var i = 0; i < PS.trafficSources.length; i++) {
        try {
          var c = PS.trafficSources[i]();
          if (c && c.length) return { contacts: c, source: 'registered source #' + (i + 1) };
        } catch (e) { PS.log('traffic', 'source failed: ' + PS.errText(e)); }
      }
      return null;
    }

    function tick() {
      var ctxo = ownOrReference();
      var res = fetchContacts();
      var contacts = null, label;
      if (res) { contacts = res.contacts; label = res.source; }
      else if (simulate) {
        var now = Date.now();
        if (!simContacts) { simContacts = PS.traffic.sample(ctxo.own); lastTs = now; }
        var dt = (now - lastTs) / 1000; lastTs = now;
        simContacts.forEach(function (c) { PS.traffic.advance(c, dt); });
        contacts = simContacts; label = 'SIMULATED contacts (not from the sim)';
      }
      PS.clear(tbl.body);
      if (!contacts) {
        sourceLine.textContent = 'No traffic source available from JS. Own position: ' + (ctxo.live ? 'live from sim' : 'reference point (sim not readable)') + '.';
        sourceLine.className = 'ps-result bad';
        PS.state.contacts = [];
        return;
      }
      sourceLine.textContent = 'Source: ' + label + '. ' + contacts.length + ' contact(s). Own position: ' + (ctxo.live ? 'live' : 'reference point') + '.';
      sourceLine.className = 'ps-result ok';
      var rows = contacts.map(function (c) { return { c: c, a: PS.traffic.analyse(ctxo.own, c) }; });
      rows.sort(function (x, y) {
        if (sortSel.value === 'tcpa') {
          var xt = x.a.tcpaSec === null ? 1e9 : x.a.tcpaSec, yt = y.a.tcpaSec === null ? 1e9 : y.a.tcpaSec;
          return xt - yt;
        }
        return x.a.distM - y.a.distM;
      });
      rows.forEach(function (r) {
        var a = r.a, c = r.c;
        tbl.body.appendChild(h('tr', { class: a.ahead && a.closingKt > 0 ? 'ps-hot' : '' },
          h('td', { text: c.title || c.id || '?' }),
          h('td', { text: PS.fmt.dist(a.distM) }),
          h('td', { text: Math.round(a.bearingDeg) + '°' }),
          h('td', { text: (a.relBearingDeg >= 0 ? '+' : '') + Math.round(a.relBearingDeg) + '°' }),
          h('td', { text: Math.round(a.altDiffFt) + ' ft' }),
          h('td', { text: PS.fmt.num(c.gsKt, 0) + ' kt' }),
          h('td', { text: Math.round(c.hdgDeg || 0) + '°' }),
          h('td', { text: PS.fmt.num(a.closingKt, 1) + ' kt' }),
          h('td', { text: a.tcpaSec === null ? '—' : PS.fmt.seconds(a.tcpaSec) }),
          h('td', { text: PS.fmt.dist(a.cpaM) }),
          h('td', { text: a.ahead ? 'yes' : 'no' })));
      });
      PS.state.contacts = contacts;
    }

    var simBtn = ui.button('Show simulated contacts: off', function () {
      simulate = !simulate; simContacts = null;
      simBtn.textContent = 'Show simulated contacts: ' + (simulate ? 'on' : 'off');
      tick();
    }, 'ps-ghost');

    var el = h('div', { class: 'ps-page' },
      ui.panel('Traffic source',
        sourceLine,
        h('div', { class: 'ps-row' }, ui.button('Discover candidate APIs', discover), simBtn, ui.field('Sort', sortSel)),
        ui.note('The original app polls AI aircraft within a radius once a second and pauses a push when one is ahead on the route. Rows highlighted: ahead (within 45° of heading) and closing.')),
      ui.panel('Contacts', tbl.el),
      ui.panel('Candidate APIs found', apiBox),
      ui.panel('Log', ui.logBox(['traffic']))
    );
    return {
      el: el,
      onShow: function () { tick(); timer = setInterval(tick, 1000); },
      onHide: function () { if (timer !== null) { clearInterval(timer); timer = null; } }
    };
  }
});
