// The anti-collision beacon, for the Push tab's "Beacon light on" step. Kept apart from the tug and the brake (src/push/tug.js): a pushback starts
// with the beacon on, and FlyByWire keeps the wheel chocks (which brake the aircraft) until it is.
// Read from LIGHT BEACON ON (the light) and set with key events only. Which key events an aircraft honours is unverified.

PS.beacon = (function () {
  var changingSince = 0;

  // { ok: it could be read, on }. On when the light (LIGHT BEACON ON) or the switch (LIGHT BEACON) says on: the ATR's switch can be on with the
  // light still dark (no power yet), and a cockpit switch that is on is what the pilot means. The app never writes LIGHT BEACON (an earlier version did,
  // and the ATR then kept 1 there with the beacon off), so the switch variable follows the cockpit.
  function raw() {
    var on = PS.getVar('LIGHT BEACON ON', 'bool'),
      sw = PS.getVar('LIGHT BEACON', 'bool');
    function num(r) {
      return r.ok && typeof r.value === 'number' && isFinite(r.value);
    }
    var ok = num(on) || num(sw);
    return { ok: ok, on: (num(on) && on.value > 0.5) || (num(sw) && sw.value > 0.5) };
  }
  // The ATR's switch variable flickers for a moment when a key event is sent, so "on" has to hold for 1.2 s before it counts (read is called every half
  // second or so). A beacon that was on when the app first looked counts at once.
  var offAt = 0;
  function read() {
    var r = raw();
    if (!r.on) offAt = Date.now();
    else if (Date.now() - offAt < 1200 && offAt) r = { ok: r.ok, on: false };
    return r;
  }

  // The other ways the sim reports the beacon, for the log only:
  // LIGHT BEACON (the switch), and bit 1 of LIGHT STATES (bit 0 nav, 1 beacon, 2 strobe, 3 landing, 4 taxi, 5 recognition, 6 wing, 7 logo, 8 cabin).
  function readings() {
    var a = PS.getVar('LIGHT BEACON', 'bool'),
      b = PS.getVar('LIGHT BEACON ON', 'bool'),
      c = PS.getVar('LIGHT STATES', 'mask');
    function v(r) {
      return r.ok && typeof r.value === 'number' ? r.value : '?';
    }
    var bit = c.ok && typeof c.value === 'number' ? (c.value >> 1) & 1 : '?';
    return 'LIGHT BEACON=' + v(a) + ' LIGHT BEACON ON=' + v(b) + ' LIGHT STATES=' + v(c) + ' (beacon bit ' + bit + ')';
  }

  // Turn the beacon on (or off) the way a cockpit switch is operated: the BEACON_LIGHTS_SET key event, and if the light has not changed after 1.5 s ONE
  // TOGGLE_BEACON_LIGHTS (a toggle sent while the first is still taking effect would flip it back, as the brake's did). The light is watched, not
  // checked once. LIGHT BEACON is never written. cb({ ok, how }) is called once it is known.
  var CHANGE_MS = 6000;
  function busy() {
    return !!changingSince && Date.now() - changingSince < CHANGE_MS;
  }
  function watch(on, ms, yes, no) {
    var t0 = Date.now();
    (function look() {
      if (raw().on === on) yes();
      else if (Date.now() - t0 >= ms) no();
      else setTimeout(look, 200);
    })();
  }
  function set(on, cb0) {
    if (busy()) {
      cb0({ ok: false, how: 'another beacon change is still under way' });
      return;
    }
    changingSince = Date.now();
    function cb(r) {
      changingSince = 0;
      cb0(r);
    }
    if (raw().on === on) {
      cb({ ok: true, how: 'it was already ' + (on ? 'on' : 'off') });
      return;
    }
    PS.keyEvent('BEACON_LIGHTS_SET', on ? 1 : 0, 'simvar');
    watch(
      on,
      1500,
      function () {
        cb({ ok: true, how: 'with the BEACON_LIGHTS_SET key event' });
      },
      function () {
        PS.keyEvent('TOGGLE_BEACON_LIGHTS', 1, 'simvar');
        watch(
          on,
          3000,
          function () {
            cb({ ok: true, how: 'with the TOGGLE_BEACON_LIGHTS key event' });
          },
          function () {
            cb({ ok: false, how: 'it did not turn ' + (on ? 'on' : 'off') + ' within 3 s (use the cockpit switch)' });
          }
        );
      }
    );
  }

  return { read: read, readings: readings, busy: busy, set: set };
})();
