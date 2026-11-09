// Engine state, so the tug is only let go after a good engine start, as a real tug operator waits for. An engine is "good" when its combustion is on and
// (where the aircraft reports it) its N1 is above idle, held for a few seconds. One good engine is enough: aircraft often taxi on one.

PS.engines = (function () {
  var GOOD_N1_PCT = 18; // above this the engine is turning over on its own
  var HOLD_MS = 3000; // and it has to stay like that this long
  var POLL_MS = 500;
  var MAX_ENGINES = 4;
  var st = { at: 0, n: 0, running: 0, good: 0, known: false, since: {}, rows: [] };

  function readNum(name, unit) {
    var r = PS.getVar(name, unit);
    return r.ok && typeof r.value === 'number' && isFinite(r.value) ? r.value : null;
  }

  function engineCount() {
    var n = readNum('NUMBER OF ENGINES', 'number');
    if (n !== null && n >= 1) return Math.min(MAX_ENGINES, Math.round(n));
    return 0;
  }

  // Read the engines now (at most every POLL_MS) and update the counts.
  function update(force) {
    var now = Date.now();
    if (!force && now - st.at < POLL_MS) return st;
    st.at = now;
    var n = engineCount();
    if (!n) {
      st.known = false;
      st.n = 0;
      st.running = 0;
      st.good = 0;
      st.rows = [];
      st.since = {};
      return st;
    }
    st.known = true;
    st.n = n;
    st.running = 0;
    st.good = 0;
    st.rows = [];
    for (var i = 1; i <= n; i++) {
      var comb = PS.getVar('GENERAL ENG COMBUSTION:' + i, 'bool');
      var on = comb.ok && Number(comb.value) > 0;
      var n1 = readNum('TURBINE ENG N1:' + i, 'percent');
      if (n1 === null) n1 = readNum('GENERAL ENG PCT MAX RPM:' + i, 'percent');
      // FlyByWire-based aircraft (the A32NX, and A330s built on it) keep their own engine model: a state (0 off, 1 on, 2 starting, 3 shutting down) and an N1.
      // Names are from the FlyByWire A32NX documentation, not yet seen on an A330 in the sim: an aircraft without them reads 0 and nothing changes.
      var fbwState = readNum('L:A32NX_ENGINE_STATE:' + i, 'number'),
        fbwN1 = readNum('L:A32NX_ENGINE_N1:' + i, 'number');
      if (fbwState === 1 && !on) on = true;
      if (fbwN1 !== null && fbwN1 > (n1 === null ? 0 : n1)) n1 = fbwN1;
      var turning = n1 === null ? true : n1 >= GOOD_N1_PCT; // no N1 to read: combustion alone, held for the hold time
      if (on) st.running++;
      var good = false;
      if (on && turning) {
        if (!st.since[i]) st.since[i] = now;
        good = now - st.since[i] >= HOLD_MS;
      } else delete st.since[i];
      if (good) st.good++;
      st.rows.push({ index: i, on: on, n1: n1, good: good, fbwState: fbwState, fbwN1: fbwN1 });
    }
    return st;
  }

  // The words for the Push tab: what a tug operator would say.
  // English, which is what the log and the "why" texts use; the Push tab translates it from textKey and textParams.
  function textKey() {
    if (!st.known) return PS.tt('Engines: not readable on this aircraft');
    if (st.good > 0) return PS.tt('{n} good engine start|{n} good engine starts');
    if (st.running > 0) return PS.tt('Engine starting: waiting for a good start');
    return PS.tt('Waiting for a good engine start');
  }
  function text() {
    var k = textKey();
    return k.indexOf('|') >= 0 ? st.good + ' good engine start' + (st.good === 1 ? '' : 's') : k;
  }

  return {
    update: update,
    status: function () {
      update(false);
      return {
        known: st.known,
        n: st.n,
        running: st.running,
        good: st.good,
        ok: st.good >= 1,
        text: text(),
        textKey: textKey(),
        textParams: { n: st.good },
        rows: st.rows.slice()
      };
    },
    reset: function () {
      st.since = {};
      st.good = 0;
      st.running = 0;
      st.at = 0;
    }
  };
})();
