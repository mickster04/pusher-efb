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
    return { brakeLvar: use, lvars: nonZero, engines: engines };
  }

  return { run: run };
})();
