// Translation. The English text is the key: PS.t('Start push') returns the text in the chosen language, or the English itself when the language has no
// entry, so a half-translated language still works. {name} in a text is filled from the params; "one|many" picks by the count in params.n.
// PS.tp('...') marks a PATTERN: a sentence other code builds from pieces and numbers (the planner's). A text with no entry of its own is matched against
// the patterns, so PS.t('Taxiway F, facing north, clear of LINK 36') is translated from '{g}, facing {dir}[, clear of {x}]' without the planner changing
// (its logs stay English). In a pattern {x} is a piece, translated as a text of its own, and [ ... ] is an optional part; every language's pattern must
// have the same placeholders and optional parts in the same order (the tests check).
// PS.tt('...') marks a text defined at load time (a table, a page title) and returns it unchanged: show it with PS.t(...).
// The tables come from src/lang/pushplanner.loc (the sim's own .loc format) embedded by build.mjs as PS.LANG_TABLE, with the keys of the patterns as
// PS.LANG_PATTERNS. Logs and diagnostics are not translated.

PS.LANGS = [
  { code: 'en-US', label: 'English' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'es-ES', label: 'Español' },
  { code: 'es-MX', label: 'Español (México)' }
];

PS.i18n = (function () {
  var table = PS.LANG_TABLE || {};
  var cur = 'en-US';
  var compiled = {}; // language -> patterns, the most specific first
  var cache = {}; // language|text -> translation of a text matched (or not) against the patterns

  // 'de', 'de-AT', 'fr-CA' -> the supported code with the same language, else English.
  function match(tag) {
    var full = String(tag || '')
        .toLowerCase()
        .replace('_', '-'),
      base = full.split('-')[0];
    for (var j = 0; j < PS.LANGS.length; j++) if (PS.LANGS[j].code.toLowerCase() === full) return PS.LANGS[j].code; // the exact one first (es-MX)
    for (var i = 0; i < PS.LANGS.length; i++) if (PS.LANGS[i].code.toLowerCase().split('-')[0] === base) return PS.LANGS[i].code;
    return 'en-US';
  }
  function browserTag() {
    try {
      return (navigator.languages && navigator.languages[0]) || navigator.language || '';
    } catch (e) {
      return '';
    }
  }
  // 'auto' (the sim's language if the browser reports it, else English) or a code.
  // With Automatic and the sim's own translations working (core/i18n-sim.js), the texts come from the sim: they are table 'sim', in whatever language the
  // sim is in. Otherwise the app's own table for the chosen language (or the one the browser reports).
  function use(setting) {
    if ((!setting || setting === 'auto') && table.sim) cur = 'sim';
    else cur = setting && setting !== 'auto' ? match(setting) : match(browserTag());
    return cur;
  }
  function setSim(texts) {
    if (texts) table.sim = texts;
    else delete table.sim;
    delete compiled.sim;
    for (var k in cache) if (k.indexOf('sim|') === 0) delete cache[k];
  }

  // ---- patterns ----
  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  // 'a {x}[, b {y}]' -> nodes: { lit }, { ph }, { opt: [nodes] } (an optional part holds no optional part of its own)
  function parse(s) {
    var i = 0;
    function run(stop) {
      var out = [],
        buf = '';
      while (i < s.length && s.charAt(i) !== stop) {
        var c = s.charAt(i);
        if (c === '{') {
          var j = s.indexOf('}', i);
          if (buf) out.push({ lit: buf });
          buf = '';
          out.push({ ph: s.slice(i + 1, j) });
          i = j + 1;
        } else if (c === '[') {
          if (buf) out.push({ lit: buf });
          buf = '';
          i++;
          out.push({ opt: run(']') });
          i++;
        } else {
          buf += c;
          i++;
        }
      }
      if (buf) out.push({ lit: buf });
      return out;
    }
    return run('');
  }
  // The regex source for nodes. Every placeholder and every optional part is a numbered capture group (stored in n.g).
  function source(nodes, st) {
    return nodes
      .map(function (n) {
        if (n.lit !== undefined) return esc(n.lit);
        n.g = ++st.n;
        return n.ph !== undefined ? '(.+?)' : '(' + source(n.opt, st) + ')?';
      })
      .join('');
  }
  function size(nodes) {
    var n = 0;
    nodes.forEach(function (x) {
      n += x.lit !== undefined ? x.lit.length : x.opt ? size(x.opt) : 0;
    });
    return n;
  }
  function patternsFor(code) {
    if (compiled[code]) return compiled[code];
    var out = [];
    (PS.LANG_PATTERNS || []).forEach(function (en) {
      var target = table[code] && table[code][en];
      if (!target) return;
      var nodes = parse(en);
      out.push({ nodes: nodes, re: new RegExp('^' + source(nodes, { n: 0 }) + '$'), size: size(nodes), target: target });
    });
    out.sort(function (a, b) {
      return b.size - a.size; // the one with the most fixed words is the most specific
    });
    compiled[code] = out;
    return out;
  }
  // The pieces are English too: translate each as a text of its own (a compass word, 'taxiway F'), and 'a and b' piece by piece.
  function piece(v) {
    var r = translate(v, 1);
    if (r !== v || v.indexOf(' and ') < 0) return r;
    var and = (table[cur] && table[cur].and) || 'and';
    return v
      .split(' and ')
      .map(function (x) {
        return translate(x, 1);
      })
      .join(' ' + and + ' ');
  }
  function translate(text, depth) {
    var own = table[cur] && table[cur][text];
    if (typeof own === 'string' && own) return own;
    if (cur === 'en-US' || depth > 3) return text;
    var ck = cur + '|' + text;
    if (cache[ck] !== undefined) return cache[ck];
    var ps = patternsFor(cur),
      res = text;
    for (var i = 0; i < ps.length; i++) {
      var m = ps[i].re.exec(text);
      if (!m) continue;
      var params = {},
        present = [];
      (function collect(nodes) {
        nodes.forEach(function (n) {
          if (n.ph !== undefined) {
            if (m[n.g] !== undefined) params[n.ph] = piece(m[n.g]);
          } else if (n.opt) {
            present.push(m[n.g] !== undefined);
            collect(n.opt);
          }
        });
      })(ps[i].nodes);
      var k = 0;
      res = (function render(nodes) {
        return nodes
          .map(function (n) {
            if (n.lit !== undefined) return n.lit;
            if (n.ph !== undefined) return params[n.ph] !== undefined ? params[n.ph] : '{' + n.ph + '}';
            return present[k++] ? render(n.opt) : '';
          })
          .join('');
      })(parse(ps[i].target));
      break;
    }
    cache[ck] = res;
    return res;
  }

  function t(text, params) {
    var s = table[cur] && table[cur][text];
    if (!params && (typeof s !== 'string' || !s) && text.indexOf('{') < 0) return translate(text, 0);
    if (typeof s !== 'string' || !s) s = text;
    if (s.indexOf('|') >= 0) {
      var parts = s.split('|');
      s = params && params.n === 1 ? parts[0] : parts[parts.length - 1];
    }
    if (params && s.indexOf('{') >= 0)
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return params[k] !== undefined ? params[k] : m;
      });
    return s;
  }
  // Does this language tag ('it-IT', 'de') have a translation of its own?
  function has(tag) {
    var base = String(tag || '')
      .toLowerCase()
      .split(/[-_]/)[0];
    return PS.LANGS.some(function (l) {
      return l.code.toLowerCase().split('-')[0] === base;
    });
  }
  function pageLang() {
    return typeof document !== 'undefined' && document.documentElement ? document.documentElement.lang || '' : '';
  }
  // One line for the log and the copied report: what is shown, why, and, when the sim's or the browser's language has no translation here, which one is
  // missing, so a report from a pilot in an untranslated language says which language to add.
  function describe(setting) {
    var page = pageLang(),
      browser = browserTag();
    var line = 'language: ' + cur + ' (setting ' + (setting || 'auto') + ', the sim page says "' + page + '", the browser reports "' + browser + '")';
    var wanted = !setting || setting === 'auto' ? page || browser : setting;
    if (wanted && !has(wanted)) line += ' - NO TRANSLATION for ' + wanted + ', so English is shown';
    return line;
  }
  return {
    describe: describe,
    has: has,
    t: t,
    use: use,
    setSim: setSim,
    match: match,
    browserTag: browserTag,
    lang: function () {
      return cur;
    }
  };
})();
PS.t = PS.i18n.t;
PS.tt = function (text) {
  return text;
};
PS.tp = PS.tt;
