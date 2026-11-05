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
      var turning = n1 === null ? true : n1 >= GOOD_N1_PCT; // no N1 to read: combustion alone, held for the hold time
      if (on) st.running++;
      var good = false;
      if (on && turning) {
        if (!st.since[i]) st.since[i] = now;
        good = now - st.since[i] >= HOLD_MS;
      } else delete st.since[i];
      if (good) st.good++;
      st.rows.push({ index: i, on: on, n1: n1, good: good });
    }
    return st;
  }

  // The words for the Push tab: what a tug operator would say.
  function text() {
    if (!st.known) return 'Engines: not readable on this aircraft';
    if (st.good > 0) return st.good + ' good engine start' + (st.good === 1 ? '' : 's');
    if (st.running > 0) return 'Engine starting: waiting for a good start';
    return 'Waiting for a good engine start';
  }

  return {
    update: update,
    status: function () {
      update(false);
      return { known: st.known, n: st.n, running: st.running, good: st.good, ok: st.good >= 1, text: text(), rows: st.rows.slice() };
    },
    reset: function () {
      st.since = {};
      st.good = 0;
      st.running = 0;
      st.at = 0;
    },
    GOOD_N1_PCT: GOOD_N1_PCT,
    HOLD_MS: HOLD_MS
  };
})();
