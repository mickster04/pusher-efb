// Diagnostic checks: each one looks at one part of what the app depends on in the sim and reports ok, warn or fail in a sentence. While a check runs,
// the detail log (PS.logv) is on, so the log fills with what that part is doing; a normal session stays quiet. A check never changes the sim: nothing
// is attached, set or sent (the ground services check only says whether the key events could be sent). No DOM here: the panel is ui/diag-panel.js.

PS.diag = (function () {
  var STATUS_WORD = { ok: 'OK', warn: 'WARNING', fail: 'FAILED' };

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  function fail(e) {
    return { status: 'fail', text: PS.errText(e) };
  }
  function fx(n, d) {
    return typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '?';
  }
  function say(msg) {
    PS.log('diag', msg);
  }

  var CHECKS = [
    {
      id: 'aircraft',
      title: 'Aircraft',
      what: 'Which aircraft the sim says this is. It goes at the top of the copied logs, so a problem can be traced to it.',
      run: function () {
        var line = PS.aircraftLine();
        say(line);
        var a = PS.aircraftInfo();
        if (!a.title) return { status: 'warn', text: 'the sim gave no aircraft title (' + line + ')' };
        return { status: 'ok', text: a.title + (a.engines === null ? '' : ', ' + a.engines + ' engine(s)') };
      }
    },
    {
      id: 'sim',
      title: 'Sim access',
      what: 'Can the app read the aircraft from the sim?',
      run: function () {
        var env = PS.env();
        say('environment: ' + JSON.stringify(env));
        var own = PS.readOwn();
        if (!own)
          return { status: 'fail', text: 'the aircraft position cannot be read' + (env.simVar ? '' : ' (SimVar is not available)') };
        var ground = PS.getVar('SIM ON GROUND', 'bool');
        say(
          'position ' +
            fx(own.lat, 5) +
            ', ' +
            fx(own.lon, 5) +
            ', heading ' +
            fx(own.hdgDeg, 0) +
            ', ground speed ' +
            fx(own.gsKt, 1) +
            ' kt, altitude ' +
            fx(own.altFt, 0) +
            ' ft, on ground ' +
            (ground.ok ? String(ground.value) : 'unreadable')
        );
        var missing = [];
        if (!env.coherent) missing.push('Coherent');
        if (!env.efb) missing.push('the EFB API');
        if (!env.sdk) missing.push('the sdk');
        if (missing.length) return { status: 'warn', text: 'the position reads, but ' + missing.join(' and ') + ' is not available' };
        return { status: 'ok', text: 'position reads; SimVar, Coherent, the EFB API and the sdk are all there' };
      }
    },
    {
      id: 'taxi',
      title: 'Taxi module',
      what: 'Does PusherTaxi.wasm answer? It supplies the taxiways and parking.',
      run: function () {
        return PS.wasmTaxi.ping(4000).then(function (m) {
          say('reply: ' + JSON.stringify(m));
          return { status: 'ok', text: 'answered, version ' + (PS.wasmTaxi.version() || '?') };
        }, fail);
      }
    },
    {
      id: 'files',
      title: 'Files module',
      what: 'Does PusherFiles.wasm answer, and can it list its saved files?',
      run: function () {
        return PS.wasmFiles
          .ping(4000)
          .then(function (m) {
            say('reply: ' + JSON.stringify(m));
            return PS.wasmFiles.list(5000).then(function (files) {
              say(
                files.length +
                  ' file(s) in its work folder: ' +
                  (files
                    .map(function (f) {
                      return f.name;
                    })
                    .join(', ') || 'none')
              );
              return {
                status: 'ok',
                text: 'answered, version ' + (PS.wasmFiles.version() || '?') + ', ' + files.length + ' saved file(s)'
              };
            });
          })
          .then(null, function (e) {
            var r = fail(e);
            r.text += " (saved themes then use the app's own storage)";
            return r;
          });
      }
    },
    {
      id: 'airport',
      title: 'Nearest airport',
      what: 'Finds the nearest airport and loads its runways, taxiways and parking.',
      run: function () {
        var own = PS.readOwn();
        if (!own) return { status: 'fail', text: 'the aircraft position cannot be read' };
        return PS.facility
          .nearestAirport(own.lat, own.lon)
          .then(function (r) {
            say('nearest airport ' + r.ident + ', ' + PS.fmt.dist(r.distM));
            return PS.facility.loadAirport(r.ident).then(function (res) {
              var ex = PS.taxi.extract(res.raw);
              say('sdk ' + (res.hasSdk ? 'answered' : 'did not answer') + ', taxi module ' + (res.hasWasm ? 'answered' : 'did not answer'));
              say('counts: ' + JSON.stringify(res.counts));
              var text = r.ident + ': ' + ex.items.length + ' runway/path item(s), ' + ex.parking.length + ' parking spot(s)';
              if (!res.hasWasm)
                return { status: 'warn', text: text + '; the taxi module did not answer, so there are no taxiways or parking' };
              if (!ex.parking.length)
                return { status: 'warn', text: text + '; no parking, so gate detection and Return to gate cannot work here' };
              return { status: 'ok', text: text };
            });
          })
          .then(null, fail);
      }
    },
    {
      id: 'gate',
      title: 'Gate detection',
      what: 'Is the aircraft at a gate, and which one is the nearest?',
      run: function () {
        var g = PS.gate.detect();
        say(PS.gate.describe(g));
        say(
          'detail: ' + JSON.stringify({ near: g.near, lined: g.lined, stopped: g.stopped, distM: g.distM, headingOffDeg: g.headingOffDeg })
        );
        if (!g.known) return { status: 'warn', text: 'no parking data is loaded yet (the Plan tab loads it, or run Nearest airport)' };
        return { status: 'ok', text: PS.gate.describe(g) };
      }
    },
    {
      id: 'traffic',
      title: 'AI traffic',
      what: 'Does the sim list other aircraft, and is our own filtered out?',
      run: function () {
        var T = PS.airTraffic;
        T.poll();
        return wait(1800)
          .then(function () {
            T.poll();
            return wait(1200);
          })
          .then(function () {
            say(
              'listener ready ' +
                T.ready +
                ', calls ' +
                T.calls +
                ', entries ' +
                T.entries +
                ', drawn ' +
                T.contacts.length +
                ', own ids ignored ' +
                Object.keys(T.ownIds).length
            );
            if (T.error) return { status: 'fail', text: T.error };
            if (!T.ready) return { status: 'fail', text: 'the traffic listener did not become ready' };
            return {
              status: 'ok',
              text: T.entries + ' aircraft listed by the sim, ' + T.contacts.length + ' drawn once our own is ignored'
            };
          });
      }
    },
    {
      id: 'tug',
      title: 'Pushback and brake variables',
      what: 'Reads the variables the tug uses. Nothing is written.',
      run: function () {
        var list = [
          ['PUSHBACK ATTACHED', 'bool'],
          ['PUSHBACK STATE', 'enum'],
          ['PUSHBACK WAIT', 'bool'],
          ['BRAKE PARKING POSITION', 'percent over 100'],
          ['BRAKE PARKING INDICATOR', 'bool']
        ];
        var bad = [];
        list.forEach(function (v) {
          var r = PS.getVar(v[0], v[1]);
          var ok = r.ok && typeof r.value === 'number';
          if (!ok) bad.push(v[0]);
          say(v[0] + ' (' + v[1] + ') = ' + (r.ok ? String(r.value) : 'unreadable: ' + r.error));
        });
        var b = PS.brake.read(true);
        say('parking brake: ' + JSON.stringify(b));
        var text = 'parking brake ' + (b.set ? 'set' : 'off') + (b.lvar ? ' (lever variable ' + b.lvar.name + ')' : '');
        if (bad.length) return { status: 'warn', text: text + '; could not read ' + bad.join(', ') };
        return { status: 'ok', text: text + '; the tug variables read' };
      }
    },
    {
      id: 'engines',
      title: 'Engines',
      what: 'Reads the engines, which the tug waits on before it is let go.',
      run: function () {
        var st = PS.engines.update(true);
        st.rows.forEach(function (r) {
          say(
            'engine ' +
              r.index +
              ': combustion ' +
              r.on +
              ', N1 ' +
              (r.n1 === null ? 'unreadable' : fx(r.n1, 1) + ' %') +
              ', good ' +
              r.good +
              ' | FlyByWire variables: state ' +
              (r.fbwState === null ? 'unreadable' : r.fbwState) +
              ', N1 ' +
              (r.fbwN1 === null ? 'unreadable' : fx(r.fbwN1, 1))
          );
        });
        if (!st.known)
          return {
            status: 'warn',
            text: 'the engines cannot be read, so the tug cannot wait for a start (Settings: Dismiss any time avoids the wait)'
          };
        return { status: 'ok', text: st.n + ' engine(s), ' + st.running + ' running, ' + st.good + ' started properly' };
      }
    },
    {
      id: 'services',
      title: 'Ground services',
      what: 'Checks the key events could be sent. Nothing is sent: the sim does not say whether they work.',
      run: function () {
        var c = PS.services.can();
        say('could be requested now: ' + c.ok + (c.why ? ' (' + c.why + ')' : ''));
        PS.services.LIST.forEach(function (s) {
          say(s.label + ' -> key event ' + s.event);
        });
        var sv = PS.simVar();
        if (!sv || typeof sv.SetSimVarValue !== 'function')
          return { status: 'fail', text: 'SetSimVarValue is not available, so no key event can be sent' };
        return {
          status: 'ok',
          text:
            PS.services.LIST.length +
            ' key events can be sent' +
            (c.ok ? '' : '; not right now: ' + c.why) +
            ' (whether the aircraft obeys is untested)'
        };
      }
    },
    {
      id: 'themes',
      title: 'Theme files',
      what: 'Were the theme files in the package read?',
      run: function () {
        var f = PS.theme.fileStatus();
        say(
          'theme files: ' +
            JSON.stringify({ state: f.state, listed: f.listed, loaded: f.loaded, added: f.added, replaced: f.replaced, failed: f.failed })
        );
        if (f.failed && f.failed.length)
          return {
            status: 'warn',
            text: 'a theme file did not load (' + f.failed[0].file + ': ' + f.failed[0].why + '); the built-in themes are used'
          };
        if (!f.loaded)
          return { status: 'warn', text: 'no theme files have been read (state ' + f.state + '); the built-in themes are used' };
        return { status: 'ok', text: f.loaded + ' theme file(s) read, ' + f.added + ' added to the built-in set' };
      }
    }
  ];

  function byId(id) {
    for (var i = 0; i < CHECKS.length; i++) {
      if (CHECKS[i].id === id) return CHECKS[i];
    }
    return null;
  }

  // Run one check. Resolves (never rejects) with { id, status, text, ms }.
  function run(id) {
    var c = byId(id);
    if (!c) return Promise.resolve({ id: id, status: 'fail', text: 'no such check', ms: 0 });
    var t0 = Date.now();
    PS.detail.running++;
    say('--- ' + c.title + ' ---');
    var p;
    try {
      p = Promise.resolve(c.run());
    } catch (e) {
      p = Promise.reject(e);
    }
    return p
      .then(null, function (e) {
        return { status: 'fail', text: 'the check itself failed: ' + PS.errText(e) };
      })
      .then(function (r) {
        r = r || { status: 'fail', text: 'no result' };
        r.id = id;
        r.ms = Date.now() - t0;
        say(c.title + ': ' + STATUS_WORD[r.status] + ' - ' + r.text + ' (' + r.ms + ' ms)');
        PS.detail.running = Math.max(0, PS.detail.running - 1);
        return r;
      });
  }

  // Run every check, one after another. each(result) is called as each finishes. Resolves with all the results.
  function runAll(each) {
    var results = [];
    var chain = Promise.resolve();
    CHECKS.forEach(function (c) {
      chain = chain.then(function () {
        return run(c.id).then(function (r) {
          results.push(r);
          if (each) each(r);
        });
      });
    });
    return chain.then(function () {
      var n = { ok: 0, warn: 0, fail: 0 };
      results.forEach(function (r) {
        n[r.status]++;
      });
      say('all checks done: ' + n.ok + ' OK, ' + n.warn + ' warning, ' + n.fail + ' failed');
      return results;
    });
  }

  return { CHECKS: CHECKS, byId: byId, run: run, runAll: runAll, STATUS_WORD: STATUS_WORD };
})();
