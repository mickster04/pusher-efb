// Settings kept between sim runs. The EFB app's localStorage does not survive a sim restart (the chosen theme and every setting were lost each time), but
// the files module's work folder does (saved theme files stay). So the settings, the chosen theme and the learned aircraft pivots are also written to one
// small file there, pushplanner-settings.json, and read back at start (together with the saved themes: the theme loader hands over its file list, so
// there is one request, not two). localStorage stays as the quick first copy and the fallback when the files module is not installed.
// Nothing is written until the file has been read, so a slow or missing reply can never overwrite a good file with defaults.

PS.persist = (function () {
  var FILE = 'pushplanner-settings.json';
  var usable = false, // the files module answered: writing is allowed
    restored = false, // the file has been applied (only the first listing is: a later one must not undo what was changed since)
    timer = null;

  function collect() {
    return {
      v: 1,
      settings: PS.settings.all(),
      theme: PS.theme && PS.theme.getState ? PS.theme.getState() : null,
      learned: PS.learned.all(),
      speedPercent: PS.push && PS.push.getSpeedPercent ? PS.push.getSpeedPercent() : null
    };
  }
  function write() {
    timer = null;
    if (!usable || !PS.wasmFiles || typeof PS.wasmFiles.save !== 'function') return Promise.resolve(false);
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
    var n = o.settings ? PS.settings.merge(o.settings) : 0,
      themeId = '';
    if (o.theme && PS.theme && PS.theme.restoreState) themeId = PS.theme.restoreState(o.theme);
    var l = o.learned ? PS.learned.restore(o.learned) : 0;
    if (typeof o.speedPercent === 'number' && PS.push && PS.push.setSpeedPercent) PS.push.setSpeedPercent(o.speedPercent);
    PS.log('persist', 'restored from ' + FILE + ': ' + n + ' setting(s)' + (themeId ? ', theme "' + themeId + '"' : '') + ', ' + l + ' learned aircraft');
  }
  // The files module did not answer: nothing is written, localStorage alone is used.
  function unavailable() {
    usable = false;
  }

  return { FILE: FILE, ingest: ingest, unavailable: unavailable, schedule: schedule, flush: write };
})();
