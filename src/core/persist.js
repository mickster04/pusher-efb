// Settings kept between sim runs. The EFB app's localStorage does not survive a sim restart (the chosen theme and every setting were lost each time), but
// the files module's work folder does (saved theme files stay). So the settings, the chosen theme and the learned aircraft pivots are also written to one
// small file there, pushplanner-settings.json, and read back at start (together with the saved themes: the theme loader hands over its file list, so
// there is one request, not two). localStorage stays as the quick first copy and the fallback when the files module is not installed.
// Nothing is written until the file has been read, so a slow or missing reply can never overwrite a good file with defaults.

// FORMAT VERSIONS. Every file the app writes says which format it is (a whole number, "v" here and "format" in a theme file) and which app version wrote
// it ("app", for information). A file with no number is format 1, the first one. When the format changes in a way an old file cannot be read as it is, add a
// step to STEPS (or THEME_STEPS in theme.js) that turns format n into n+1 and raise the current number: a file of any older format is walked up one step at
// a time when it is read, and rewritten in the new format. A file from a NEWER format than this app knows is read as far as it can be and never
// overwritten, so an older app cannot destroy what a newer one saved. See docs/data-formats.md.
PS.migrate = function (o, key, current, steps) {
  if (!o || typeof o !== 'object') return { obj: o, from: 1, to: 1, newer: false, migrated: false };
  var from = typeof o[key] === 'number' && o[key] >= 1 ? Math.floor(o[key]) : 1;
  if (from > current) return { obj: o, from: from, to: from, newer: true, migrated: false };
  var cur = JSON.parse(JSON.stringify(o)), // the steps may change it freely
    v = from;
  while (v < current) {
    var step = steps && steps[v];
    if (typeof step !== 'function') return { obj: cur, from: from, to: v, newer: false, migrated: v > from, broken: true }; // no way up from here
    cur = step(cur) || cur;
    v++;
    cur[key] = v;
  }
  return { obj: cur, from: from, to: current, newer: false, migrated: from < current };
};

PS.persist = (function () {
  var FILE = 'pushplanner-settings.json';
  var SCHEMA = 1; // the format of this file
  var STEPS = {}; // STEPS[n]: (format n object) -> format n+1 object. None yet: format 1 is the first.
  var readOnly = false; // the file is from a newer format: not overwritten
  var usable = false, // the files module answered: writing is allowed
    restored = false, // the file has been applied (only the first listing is: a later one must not undo what was changed since)
    timer = null;

  function collect() {
    return {
      v: SCHEMA,
      app: PS.VERSION,
      settings: PS.settings.all(),
      theme: PS.theme && PS.theme.getState ? PS.theme.getState() : null,
      learned: PS.learned.all(),
      speedPercent: PS.push && PS.push.getSpeedPercent ? PS.push.getSpeedPercent() : null
    };
  }
  function write() {
    timer = null;
    if (!usable || readOnly || !PS.wasmFiles || typeof PS.wasmFiles.save !== 'function') return Promise.resolve(false);
    var text = JSON.stringify(collect());
    return PS.wasmFiles.save(FILE, text).then(
      function (r) {
        if (!r || !r.ok) PS.log('persist', 'the settings file was not saved: ' + (r && r.detail ? r.detail : 'no reason given'));
        else PS.logv('persist', 'settings saved (' + text.length + ' characters)');
        return !!(r && r.ok);
      },
      function (e) {
        PS.log('persist', 'the settings file was not saved: ' + PS.errText(e));
        return false;
      }
    );
  }
  // After a change: write soon (changes that come in a burst, like dragging a stepper, make one write).
  function schedule() {
    if (!usable) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(write, 1500);
  }
  // The files in the work folder, as listed by the theme loader ([{ name, text }]). The first listing restores what the settings file holds.
  function ingest(files) {
    usable = true;
    if (restored) return;
    restored = true;
    var f = null;
    (files || []).forEach(function (it) {
      if (it && it.name === FILE) f = it;
    });
    if (!f) {
      PS.log('persist', 'no settings file yet: saving the current settings to ' + FILE);
      schedule();
      return;
    }
    var o;
    try {
      o = JSON.parse(f.text);
    } catch (e) {
      PS.log('persist', FILE + ' is not valid JSON and is ignored: ' + PS.errText(e));
      schedule(); // it is replaced by the current settings
      return;
    }
    if (!o || typeof o !== 'object') return;
    var mg = PS.migrate(o, 'v', SCHEMA, STEPS);
    o = mg.obj;
    if (mg.newer) {
      readOnly = true;
      PS.log('persist', FILE + ' is format ' + mg.from + ' (written by app ' + (o.app || '?') + '), newer than this app (format ' + SCHEMA + '): read as far as understood, and left as it is');
    } else if (mg.broken) {
      readOnly = true;
      PS.log('persist', FILE + ' is format ' + mg.from + ' and there is no way to bring it to format ' + SCHEMA + ': left as it is');
      return;
    } else if (mg.migrated) {
      PS.log('persist', FILE + ' was format ' + mg.from + ' (app ' + (o.app || '?') + '): brought to format ' + SCHEMA);
    }
    var n = o.settings ? PS.settings.merge(o.settings) : 0,
      themeId = '';
    if (o.theme && PS.theme && PS.theme.restoreState) themeId = PS.theme.restoreState(o.theme);
    var l = o.learned ? PS.learned.restore(o.learned) : 0;
    if (typeof o.speedPercent === 'number' && PS.push && PS.push.setSpeedPercent) PS.push.setSpeedPercent(o.speedPercent);
    if (mg.migrated || typeof f.text === 'string' && f.text.indexOf('"v"') < 0) schedule(); // (a file from an older format, or with no format number, is rewritten)
    PS.log('persist', 'restored from ' + FILE + ': ' + n + ' setting(s)' + (themeId ? ', theme "' + themeId + '"' : '') + ', ' + l + ' learned aircraft');
  }
  // The files module did not answer: nothing is written, localStorage alone is used.
  function unavailable() {
    usable = false;
  }

  // Test hook: forget that the file was read (a test reads several)
  function forget() {
    restored = false;
    readOnly = false;
    usable = false;
  }
  return { FILE: FILE, SCHEMA: SCHEMA, STEPS: STEPS, _forget: forget, ingest: ingest, unavailable: unavailable, schedule: schedule, flush: write };
})();
