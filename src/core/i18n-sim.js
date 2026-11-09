// An experiment: ask the sim for the translations itself. The package ships src/lang/pushplanner.loc (the sim's own translation format) in its
// localization folder, and a text is asked for as "@push-planner,TT:<KEY>", the form the sim substitutes in .cfg and XML files. Whether the sim also
// substitutes it for a page's JavaScript or text is NOT documented, so at start the app tries each way it can think of on one known key, logs what
// came back (look for "[i18n]" in the log), and uses the first that returns real text. If none does, the app's own texts (core/i18n.js) are used.
// It only reads. The result is used when the Language setting is Automatic; a language picked by hand always uses the app's own texts.

PS.simT = (function () {
  var PKG = 'push-planner';
  var state = { tried: false, mode: '', texts: {}, count: 0, note: 'not tried yet' };
  var holder = null;

  function token(key) {
    return '@' + PKG + ',TT:' + key;
  }
  // What the sim gives back for a key it does not know is the key or the token, or nothing.
  function real(out, key) {
    return (
      typeof out === 'string' && out.length > 0 && out !== key && out !== token(key) && out.indexOf('TT:') !== 0 && out.charAt(0) !== '@'
    );
  }
  function say(msg) {
    PS.log('i18n', msg);
  }

  // Ways a script might translate a token in one call. Names are guesses (nothing documents them): each is tried inside try/catch and only if it exists.
  var FNS = [
    [
      'Coherent.translate',
      function (tok) {
        return typeof Coherent !== 'undefined' && typeof Coherent.translate === 'function' ? Coherent.translate(tok) : undefined;
      }
    ],
    [
      'Utils.Translate',
      function (tok) {
        return typeof Utils !== 'undefined' && typeof Utils.Translate === 'function' ? Utils.Translate(tok) : undefined;
      }
    ]
  ];

  // Put tokens into the page as text and read them back after the sim has had a moment: if it substitutes text it finds, they change.
  function viaPage(tokens, done) {
    var doc = typeof document !== 'undefined' ? document : null;
    if (!doc || !doc.body) {
      done(null);
      return;
    }
    if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
    holder = doc.createElement('div');
    holder.setAttribute('style', 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none');
    var spans = tokens.map(function (tok) {
      var s = doc.createElement('span');
      s.textContent = tok;
      holder.appendChild(s);
      return s;
    });
    doc.body.appendChild(holder);
    setTimeout(function () {
      var out = spans.map(function (s) {
        return s.textContent;
      });
      if (holder && holder.parentNode) holder.parentNode.removeChild(holder);
      holder = null;
      done(out);
    }, 600);
  }

  function keysByText() {
    return PS.LANG_KEYS || {};
  }

  function finish(mode, texts, note) {
    state.mode = mode;
    state.texts = texts;
    state.count = Object.keys(texts).length;
    state.note = note;
    say(note);
    PS.i18n.setSim(mode ? texts : null);
    if (mode && PS.settings.get('lang') === 'auto' && PS.applyLanguage) PS.applyLanguage();
  }

  // For the log: the texts the sim left out, and what the sim returns for texts with accents (their character codes show a wrong decoding).
  function accentCheck(english, texts) {
    var missing = english.filter(function (en) {
      return texts[en] === undefined;
    });
    if (missing.length) say('not translated by the sim: ' + JSON.stringify(missing.slice(0, 5)));
    var shown = 0;
    for (var en in texts) {
      var t = texts[en];
      if (shown >= 3 || !/[^\x00-\x7f]/.test(t)) continue;
      shown++;
      var codes = [];
      for (var i = 0; i < t.length && codes.length < 40; i++) if (t.charCodeAt(i) > 127) codes.push(t.charAt(i) + '=U+' + t.charCodeAt(i).toString(16));
      say('accents in ' + JSON.stringify(t.slice(0, 50)) + ': ' + codes.join(' '));
    }
    if (!shown) say('no sim text holds a character beyond ASCII');
  }

  // Probe, then (if something works) ask for every text. done() is optional.
  function run(done) {
    var keys = keysByText(),
      english = Object.keys(keys);
    state.tried = true;
    var probeText = keys.Settings ? 'Settings' : english[0];
    if (!probeText) {
      finish('', {}, 'no texts to try');
      return;
    }
    var probeKey = keys[probeText];
    say(
      'sim translation probe: the browser reports "' +
        PS.i18n.browserTag() +
        '", the page says "' +
        (typeof document !== 'undefined' && document.documentElement ? document.documentElement.lang : '') +
        '"; asking for ' +
        token(probeKey)
    );
    // 1. a function
    var tried = [];
    for (var i = 0; i < FNS.length; i++) {
      var out;
      try {
        out = FNS[i][1](token(probeKey));
      } catch (e) {
        out = undefined;
        tried.push(FNS[i][0] + ': threw ' + PS.errText(e));
        continue;
      }
      tried.push(FNS[i][0] + ': ' + (out === undefined ? 'not there' : JSON.stringify(out)));
      if (real(out, probeKey)) {
        var texts = {};
        english.forEach(function (en) {
          try {
            var r = FNS[i][1](token(keys[en]));
            if (real(r, keys[en])) texts[en] = r;
          } catch (e2) {
            /* that one stays with the app's own text */
          }
        });
        finish(
          FNS[i][0],
          texts,
          'the sim translates through ' + FNS[i][0] + ': ' + Object.keys(texts).length + ' of ' + english.length + ' texts'
        );
        accentCheck(english, texts);
        if (done) done(state);
        return;
      }
    }
    say('functions tried: ' + tried.join('; '));
    // 2. page text
    viaPage([token(probeKey)], function (res) {
      say('page text after 600 ms: ' + (res ? JSON.stringify(res[0]) : 'no document'));
      if (!res || !real(res[0], probeKey)) {
        finish(
          '',
          {},
          'the sim did not translate the test text (' +
            (res ? 'the page text stayed as it was' : 'no document') +
            "): using the app's own texts"
        );
        if (done) done(state);
        return;
      }
      viaPage(
        english.map(function (en) {
          return token(keys[en]);
        }),
        function (all) {
          var texts = {};
          english.forEach(function (en, k) {
            if (all && real(all[k], keys[en])) texts[en] = all[k];
          });
          finish('page text', texts, 'the sim translates page text: ' + Object.keys(texts).length + ' of ' + english.length + ' texts');
          if (done) done(state);
        }
      );
    });
  }

  return {
    run: run,
    status: function () {
      return state.mode
        ? 'in use: ' + state.mode + ' (' + state.count + ' texts)'
        : state.tried
          ? "not available, using the app's own texts"
          : 'not tried yet';
    },
    mode: function () {
      return state.mode;
    }
  };
})();
