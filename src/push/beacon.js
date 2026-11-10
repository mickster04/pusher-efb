// The anti-collision beacon, for the Push tab's "Beacon light on" step. Kept apart from the tug and the brake (src/push/tug.js): a pushback starts
// with the beacon on, and FlyByWire keeps the wheel chocks (which brake the aircraft) until it is.
// LIGHT BEACON is read as a bool. To turn it on the variable is written, and if that does not take, the BEACON_LIGHTS_SET key event is sent, then
// TOGGLE_BEACON_LIGHTS as the last resort (which flips it, so only when the beacon still reads off). Which of these an aircraft honours is unverified.

PS.beacon = (function () {
  var changingSince = 0;

  // { ok: it could be read, on }
  function read() {
    var r = PS.getVar('LIGHT BEACON', 'bool');
    var ok = r.ok && typeof r.value === 'number' && isFinite(r.value);
    return { ok: ok, on: ok && r.value > 0.5 };
  }

  // The other ways the sim reports the beacon, for the log only (an aircraft whose switch does not drive LIGHT BEACON would show it here):
  // LIGHT BEACON ON, and bit 1 of LIGHT STATES (bit 0 nav, 1 beacon, 2 strobe, 3 landing, 4 taxi, 5 recognition, 6 wing, 7 logo, 8 cabin).
  function readings() {
    var a = PS.getVar('LIGHT BEACON', 'bool'),
      b = PS.getVar('LIGHT BEACON ON', 'bool'),
      c = PS.getVar('LIGHT STATES', 'mask');
    function v(r) {
      return r.ok && typeof r.value === 'number' ? r.value : '?';
    }
    var bit = c.ok && typeof c.value === 'number' ? ((c.value >> 1) & 1) : '?';
    return 'LIGHT BEACON=' + v(a) + ' LIGHT BEACON ON=' + v(b) + ' LIGHT STATES=' + v(c) + ' (beacon bit ' + bit + ')';
  }

  // Turn the beacon on (or off). cb({ ok, how }) is called once it is known.
  function set(on, cb0) {
    if (changingSince && Date.now() - changingSince < 3000) {
      cb0({ ok: false, how: 'another beacon change is still under way' });
      return;
    }
    changingSince = Date.now();
    function cb(r) {
      changingSince = 0;
      cb0(r);
    }
    if (read().on === on) {
      cb({ ok: true, how: 'it was already ' + (on ? 'on' : 'off') });
      return;
    }
    PS.setVar('LIGHT BEACON', 'bool', on ? 1 : 0);
    setTimeout(function () {
      if (read().on === on) {
        cb({ ok: true, how: 'by writing LIGHT BEACON' });
        return;
      }
      PS.keyEvent('BEACON_LIGHTS_SET', on ? 1 : 0, 'simvar');
      setTimeout(function () {
        if (read().on === on) {
          cb({ ok: true, how: 'with the BEACON_LIGHTS_SET key event' });
          return;
        }
        PS.keyEvent('TOGGLE_BEACON_LIGHTS', 1, 'simvar');
        setTimeout(function () {
          var ok = read().on === on;
          cb({ ok: ok, how: ok ? 'with the TOGGLE_BEACON_LIGHTS key event' : 'it would not turn ' + (on ? 'on' : 'off') });
        }, 600);
      }, 600);
    }, 450);
  }

  return { read: read, readings: readings, set: set };
})();
