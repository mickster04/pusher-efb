// Derived in part from the original Pusher app (MIT, (c) Palm Coasty Simulations): see THIRD_PARTY_NOTICES.md.
// The parking brake and the tug: the sim-facing layer under the Push tab. Ported from the original bridge (bridge/SimService.cs brake handling,
// bridge/TugDrive.cs) and from the sequence proven in the sim by the earlier Tug test page: hold the tug (PUSHBACK WAIT on), TOGGLE_PUSHBACK, wait
// for PUSHBACK ATTACHED; then, every tick, write PUSHBACK WAIT 0, VELOCITY BODY Y 0, ROTATION VELOCITY BODY X 0, VELOCITY BODY Z (ft/s, + forward)
// and ROTATION VELOCITY BODY Y (rad/s, + turns the nose right). Velocity is not sticky: stop writing it and the aircraft coasts to a halt.

PS.brake = (function () {
  // Aircraft that leave the simvar at 0 and only expose a lever variable (FlyByWire, Fenix, ...): the original probes these names.
  var LVARS = [
    'L:A32NX_PARK_BRAKE_LEVER_POS',
    'L:A32NX_PARKING_BRAKE_LEVER_POS',
    'L:A32NX_PARK_BRAKE',
    'L:XMLVAR_PARK_BRAKE_POS',
    'L:S_OH_ELEC_PARK_BRAKE',
    'L:N_PED_PARKBRAKE',
    'L:B21_PARKING_BRAKE'
  ];
  var LVAR_ON = 0.45;
  var lvarName = null; // the lever variable found to read "set", kept so it is not searched for again

  // The simvar comes as a bool, a position (0..1), a percent (0..100) or a 16k position, depending on the aircraft.
  function isSetRaw(raw) {
    if (typeof raw !== 'number' || !isFinite(raw)) return false;
    var a = Math.abs(raw);
    return (a >= 0.35 && a <= 1.6) || (a >= 35 && a <= 100.5) || a > 4000;
  }

  // { ok, set, pct, bool, lvar: { name, value } | null }. `scan` also looks for a lever variable (several reads, so not every tick).
  function read(scan) {
    var pct = PS.getVar('BRAKE PARKING POSITION', 'percent over 100'),
      bl = PS.getVar('BRAKE PARKING POSITION', 'bool');
    var set = (pct.ok && isSetRaw(pct.value)) || (bl.ok && isSetRaw(bl.value)),
      lv = null;
    if (lvarName) {
      var r = PS.getVar(lvarName, 'number');
      if (r.ok && typeof r.value === 'number') {
        lv = { name: lvarName, value: r.value };
        if (r.value > LVAR_ON) set = true;
      }
    } else if (scan && !set) {
      for (var i = 0; i < LVARS.length; i++) {
        var q = PS.getVar(LVARS[i], 'number');
        if (q.ok && typeof q.value === 'number' && q.value > LVAR_ON) {
          lvarName = LVARS[i];
          lv = { name: lvarName, value: q.value };
          set = true;
          PS.log('tug', 'parking brake lever variable found: ' + lvarName + ' = ' + q.value);
          break;
        }
      }
    }
    return { ok: pct.ok || bl.ok, set: set, pct: pct.ok ? pct.value : null, bool: bl.ok ? bl.value : null, lvar: lv };
  }

  // Write the brake variables (the simvar both ways and every known lever variable; failures are ignored, as the original does).
  function writeAll(on) {
    var v = on ? 1 : 0;
    PS.setVar('BRAKE PARKING POSITION', 'percent over 100', v);
    PS.setVar('BRAKE PARKING POSITION', 'bool', v);
    var names = lvarName ? [lvarName] : LVARS;
    for (var i = 0; i < names.length; i++) PS.setVar(names[i], 'number', v);
  }

  // Bring the brake to `wantSet` (false = released): write the variables, and if it is still not there, toggle it ONCE with the PARKING_BRAKES key event.
  // cb({ ok, how }) is called once it is known.
  // PARKING_BRAKES is a toggle and some aircraft (the ATR) take seconds to move the lever: a toggle sent while an earlier one has not shown yet flips
  // the brake straight back. So the key event is sent once, the brake is then watched (every 200 ms, up to 12 s: the ATR's lever was seen to answer a key event 3 to 12 s late) rather than checked once, and a second
  // change is refused while one is under way. If it still has not moved the pilot is told, and does it by hand.
  var changingSince = 0;
  var CHANGE_MS = 14000; // the longest a change can take (450 ms + 12 s), after which the flag lapses so one whose timer never ran cannot block the next
  function busy() {
    return !!changingSince && Date.now() - changingSince < CHANGE_MS;
  }
  // Call yes() as soon as the brake reads `wantSet`, or no() after `ms`.
  function watch(wantSet, ms, yes, no) {
    var t0 = Date.now();
    (function look() {
      if (read(true).set === wantSet) yes();
      else if (Date.now() - t0 >= ms) no();
      else setTimeout(look, 200);
    })();
  }
  function change(wantSet, cb0) {
    if (busy()) {
      cb0({ ok: false, how: 'another brake change is still under way' });
      return;
    }
    changingSince = Date.now();
    function cb(r) {
      changingSince = 0;
      cb0(r);
    }
    var s0 = read(true);
    if (s0.set === wantSet) {
      cb({ ok: true, how: 'it was already ' + (wantSet ? 'set' : 'released') });
      return;
    }
    writeAll(wantSet);
    watch(
      wantSet,
      450,
      function () {
        cb({ ok: true, how: 'by writing the brake variables' });
      },
      function () {
        PS.keyEvent('PARKING_BRAKES', 1, 'simvar');
        PS.log('tug', 'parking brake: PARKING_BRAKES key event sent (once), watching for the brake to move');
        watch(
          wantSet,
          12000,
          function () {
            cb({ ok: true, how: 'with the PARKING_BRAKES key event' });
          },
          function () {
            cb({ ok: false, how: 'it did not ' + (wantSet ? 'set' : 'release') + ' within 12 s (try the cockpit lever)' });
          }
        );
      }
    );
  }

  // Every variable that could say whether the parking brake is on, as one line, for the log: when the lever moves (by hand, or by a key event) and the
  // line changes, the variable that follows it is the one to read for that aircraft. The ATR 72 names are guesses (no page names them); a 0 proves nothing.
  var WATCH = [
    ['BRAKE PARKING POSITION', 'percent over 100'],
    ['BRAKE PARKING POSITION', 'bool'],
    ['BRAKE PARKING INDICATOR', 'bool'],
    ['BRAKE LEFT POSITION', 'percent over 100'],
    ['BRAKE RIGHT POSITION', 'percent over 100']
  ];
  var WATCH_LVARS = LVARS.concat([
    'L:ATR_PARKING_BRAKE',
    'L:ATR_PARK_BRAKE',
    'L:ATR72_PARK_BRAKE',
    'L:ATR72_PARKING_BRAKE',
    'L:ATR_PARKING_BRAKE_LEVER',
    'L:XMLVAR_PARKING_BRAKE',
    'L:XMLVAR_Parking_Brake',
    'L:PARKING_BRAKE',
    'L:PARK_BRAKE',
    'L:BRAKE_PARKING',
    'L:B21_PARKING_BRAKE_LEVER'
  ]);
  function readings() {
    var out = [];
    WATCH.forEach(function (w) {
      var r = PS.getVar(w[0], w[1]);
      out.push(w[0].replace('BRAKE ', '') + (w[1] === 'bool' ? '(b)' : '') + '=' + (r.ok && typeof r.value === 'number' ? r.value : '?'));
    });
    WATCH_LVARS.forEach(function (n) {
      var r = PS.getVar(n, 'number');
      if (r.ok && typeof r.value === 'number' && r.value !== 0) out.push(n.replace(/^L:/, '') + '=' + r.value);
    });
    return out.join(' ');
  }

  return {
    readings: readings,
    lvars: LVARS,
    // Use this lever variable from now on (known from the aircraft's profile, or found by the startup probe) instead of waiting to find it set.
    adopt: function (name) {
      if (typeof name === 'string' && name && lvarName !== name) {
        lvarName = name;
        PS.log('tug', 'parking brake lever variable in use: ' + name);
      }
    },
    read: read,
    busy: busy,
    release: function (cb) {
      change(false, cb);
    },
    set: function (cb) {
      change(true, cb);
    }
  };
})();

PS.tug = (function () {
  var ROT_UNIT = 'radians per second';
  var attachTimer = null,
    attachedAt = 0;

  function say(text) {
    PS.log('tug', text);
  }
  function isAttached() {
    var r = PS.getVar('PUSHBACK ATTACHED', 'bool');
    return r.ok && Number(r.value) > 0;
  }
  function setWait(on) {
    return PS.setVar('PUSHBACK WAIT', 'bool', on ? 1 : 0);
  }
  function toggle() {
    return PS.keyEvent('TOGGLE_PUSHBACK', 1, 'simvar');
  }

  // The original app's sequence. cb({ ok, ms, already, error }).
  function attach(cb) {
    if (attachTimer !== null) {
      clearInterval(attachTimer);
      attachTimer = null;
    }
    if (isAttached()) {
      attachedAt = attachedAt || Date.now();
      say('tug is already attached');
      cb({ ok: true, already: true, ms: 0 });
      return;
    }
    setWait(true);
    toggle();
    var t0 = Date.now();
    say('attach requested: waiting for PUSHBACK ATTACHED (up to 15 s)');
    var finished = false; // the callback reports once, even if the timer fires again
    attachTimer = setInterval(function () {
      if (finished) return;
      if (isAttached()) {
        finished = true;
        clearInterval(attachTimer);
        attachTimer = null;
        attachedAt = Date.now();
        say('tug attached after ' + (Date.now() - t0) + ' ms');
        cb({ ok: true, ms: Date.now() - t0 });
      } else if (Date.now() - t0 > 15000) {
        finished = true;
        clearInterval(attachTimer);
        attachTimer = null;
        say('PUSHBACK ATTACHED never became true in 15 s (the aircraft may use its own pushback system)');
        cb({ ok: false, error: 'the tug did not attach in 15 s' });
      }
    }, 250);
  }
  function cancelAttach() {
    if (attachTimer !== null) {
      clearInterval(attachTimer);
      attachTimer = null;
    }
  }
  function detach() {
    cancelAttach();
    if (!isAttached()) {
      say('no tug attached to dismiss');
      return false;
    }
    zeroAndHold();
    toggle();
    attachedAt = 0;
    say('dismiss requested');
    return true;
  }

  // Hold the tug still: velocity and turn to zero, PUSHBACK WAIT on.
  function zeroAndHold() {
    PS.setVar('VELOCITY BODY Z', 'feet per second', 0);
    PS.setVar('ROTATION VELOCITY BODY Y', ROT_UNIT, 0);
    PS.setVar('PUSHBACK WAIT', 'bool', 1);
  }
  // One tick of driving: the set the original writes every tick. speedFtS is signed (negative = reverse); yawDegS is the nose turn rate,
  // clockwise positive. Returns { ok, error }.
  function write(speedFtS, yawDegS) {
    var results = [
      PS.setVar('PUSHBACK WAIT', 'bool', 0),
      PS.setVar('VELOCITY BODY Y', 'feet per second', 0),
      PS.setVar('ROTATION VELOCITY BODY X', 'feet per second', 0),
      PS.setVar('VELOCITY BODY Z', 'feet per second', speedFtS),
      PS.setVar('ROTATION VELOCITY BODY Y', ROT_UNIT, (yawDegS * Math.PI) / 180)
    ];
    for (var i = 0; i < results.length; i++) {
      if (!results[i].ok) return { ok: false, error: results[i].error };
    }
    return { ok: true };
  }

  return {
    isAttached: isAttached,
    attach: attach,
    cancelAttach: cancelAttach,
    detach: detach,
    zeroAndHold: zeroAndHold,
    write: write,
    // How long the tug has been attached. A tug that was already on when the app first looked (attached earlier, or by the sim) has been on a while.
    attachedMs: function () {
      return attachedAt ? Date.now() - attachedAt : isAttached() ? 1e9 : 0;
    }
  };
})();
