// The startup probe: when the app opens and at the start of every push, look at every variable the app knows how to use for the parking brake and the
// engines, log what each one reads (so an aircraft the app has not seen shows which of them it answers to), and start using the brake lever variable
// at once (from the aircraft's profile, or the first known one that reads "set") rather than only after the brake happens to be set.
// A missing L variable reads 0, the same as "off", so a zero proves nothing: only a non-zero reading is evidence the variable exists.
// It only reads. Nothing is written to the sim.

PS.probe = (function () {
  function num(name) {
    var r = PS.getVar(name, 'number');
    return r.ok && typeof r.value === 'number' && isFinite(r.value) ? r.value : null;
  }

  // Returns { brakeLvar, brakeSet, lvars: [name=value, ...], engines: [text, ...] } and logs it.
  function run(reason) {
    var info = PS.aircraftInfo(),
      prof = PS.profiles.find(info);
    var simBrake = PS.brake.read(false);
    var nonZero = [];
    PS.brake.lvars.forEach(function (n) {
      var v = num(n);
      if (v !== null && v !== 0) nonZero.push(n + '=' + v);
    });
    var use = null,
      how = '';
    if (prof && prof.brakeLvar) {
      use = prof.brakeLvar;
      how = 'from the ' + prof.name + ' profile';
    } else if (!simBrake.set || !simBrake.lvar) {
      for (var i = 0; i < PS.brake.lvars.length && !use; i++) {
        var v = num(PS.brake.lvars[i]);
        if (v !== null && v > 0.45) {
          use = PS.brake.lvars[i];
          how = 'it reads set';
        }
      }
    }
    if (use) PS.brake.adopt(use);
    var eng = PS.engines.update(true);
    var engines = eng.rows.map(function (r) {
      return (
        r.index +
        ': combustion ' +
        r.on +
        ', N1 ' +
        (r.n1 === null ? '?' : PS.fmt.num(r.n1, 1)) +
        ', FlyByWire state ' +
        (r.fbwState === null ? '?' : r.fbwState)
      );
    });
    PS.log(
      'probe',
      (reason || 'probe') +
        ' | ' +
        (info.title || 'aircraft unreadable') +
        ' | brake simvar ' +
        (simBrake.pct === null ? '?' : simBrake.pct) +
        ', lever variables that read non-zero: ' +
        (nonZero.length ? nonZero.join(', ') : 'none') +
        ', using ' +
        (use ? use + ' (' + how + ')' : 'none') +
        ' | engines ' +
        (engines.length ? engines.join('; ') : 'not readable')
    );
    logFbw();
    return { brakeLvar: use, lvars: nonZero, engines: engines };
  }

  // Variables of the FlyByWire A32NX family (the Headwind A330 uses them too) that could explain a nose lift or a tug that is held back. Names from the
  // A32NX simvar documentation, except the chocks ones, which no page names: those are guesses, and only a non-zero reading proves a name exists.
  var FBW = [
    'L:A32NX_PUSHBACK_SYSTEM_ENABLED',
    'L:A32NX_PUSHBACK_SPD_FACTOR',
    'L:A32NX_PUSHBACK_HDG_FACTOR',
    'L:A32NX_IS_STATIONARY',
    'L:A32NX_GND_EQP_IS_VISIBLE',
    'L:A32NX_HYD_BRAKE_NORM_LEFT_PRESS',
    'L:A32NX_HYD_BRAKE_NORM_RIGHT_PRESS',
    'L:A32NX_HYD_BRAKE_ALTN_LEFT_PRESS',
    'L:A32NX_HYD_BRAKE_ALTN_RIGHT_PRESS',
    'L:A32NX_LEFT_BRAKE_PEDAL_INPUT',
    'L:A32NX_RIGHT_BRAKE_PEDAL_INPUT',
    'L:A32NX_AUTOBRAKES_ACTIVE',
    'L:A32NX_NOSE_WHEEL_POSITION',
    'L:A32NX_HYD_NW_STRG_DISC_ECAM_MEMO',
    'L:A32NX_LGCIU_1_NOSE_GEAR_COMPRESSED',
    'L:A32NX_LGCIU_1_LEFT_GEAR_COMPRESSED',
    'L:A32NX_LGCIU_1_RIGHT_GEAR_COMPRESSED'
  ];
  var CHOCK_GUESSES = [
    'L:A32NX_CHOCKS_ENABLED',
    'L:A32NX_CHOCKS_VISIBLE',
    'L:A32NX_CHOCKS_ON',
    'L:A32NX_CHOCKS_PLACED',
    'L:A32NX_CHOCKS',
    'L:A32NX_WHEEL_CHOCKS',
    'L:A32NX_WHEEL_CHOCKS_ENABLED',
    'L:A32NX_WHEEL_CHOCKS_VISIBLE',
    'L:A32NX_GND_EQP_CHOCKS',
    'L:A32NX_GND_EQP_CHOCKS_ENABLED',
    'L:A32NX_GND_EQP_CHOCKS_VISIBLE',
    'L:A32NX_GND_EQP_CHOCKS_ON',
    'L:A32NX_GND_EQP_CONES_ENABLED',
    'L:A32NX_GND_EQP_CONES_VISIBLE',
    'L:A32NX_CONES_ENABLED',
    'L:A32NX_SAFETY_CONES',
    'L:A32NX_OPTIONS_CHOCKS',
    'L:A32NX_CHOCKS_AND_CONES_ENABLED',
    'L:A32NX_GROUND_EQUIPMENT_CHOCKS'
  ];
  function short(n) {
    return n.replace(/^L:A32NX_/, '');
  }
  // One line of the variables above, for the drive log ('?' = the sim would not read it)
  // The beacon is the one that matters for the chocks: they only stay while the beacon is off.
  function beacon() {
    var r = PS.getVar('LIGHT BEACON', 'bool');
    return 'beacon=' + (r.ok ? r.value : '?');
  }
  function beaconAll() {
    return PS.beacon && PS.beacon.readings ? PS.beacon.readings() : beacon();
  }
  function fbwLine() {
    return beacon() + ' ' + FBW.map(function (n) {
      var v = num(n);
      return short(n) + '=' + (v === null ? '?' : PS.fmt.num(v, 2));
    }).join(' ');
  }
  // At a push start: which of those answer with a non-zero value, and which chock guesses do
  function logFbw() {
    var live = [],
      zero = 0;
    FBW.forEach(function (n) {
      var v = num(n);
      if (v !== null && v !== 0) live.push(short(n) + '=' + PS.fmt.num(v, 2));
      else zero++;
    });
    var chocks = [];
    CHOCK_GUESSES.forEach(function (n) {
      var v = num(n);
      if (v !== null && v !== 0) chocks.push(short(n) + '=' + PS.fmt.num(v, 2));
    });
    PS.log(
      'probe',
      beaconAll() + ' | A32NX variables reading non-zero: ' + (live.length ? live.join(' ') : 'none') + ' (' + zero + ' read 0 or not at all) | chocks guesses reading non-zero: ' + (chocks.length ? chocks.join(' ') : 'none (a zero proves nothing: no page names the chocks variable)')
    );
  }

  return { run: run, fbwLine: fbwLine, logFbw: logFbw };
})();
