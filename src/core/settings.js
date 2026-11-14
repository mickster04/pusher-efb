// Settings kept between runs (localStorage; the app still works if storage is unavailable): the tightest turn the plan may use, whether new
// pins snap to the taxiway they sit on, and which list the Plan tab opens with.

PS.settings = (function () {
  var KEY = 'pushplanner.settings';
  var defaults = {
    snap: true,
    snapM: 50,
    planTab: 'suggested',
    tightest: 26,
    insetTop: 40,
    insetBottom: 56,
    requireEngines: true,
    requireBeacon: true,
    requireBrake: true,
    turnSpeed: 0, // speed in curves as a percent of the straight-line speed (60 to 100); 0 = the usual radius-based slowing
    rings: false,
    uiSize: 'auto' // auto | normal | compact
  };
  var values = {},
    k;
  for (k in defaults) values[k] = defaults[k];
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    for (k in defaults) {
      if (saved[k] !== undefined && typeof saved[k] === typeof defaults[k]) values[k] = saved[k];
    }
    // the tightest turn used to have a key of its own
    var old = Number(window.localStorage.getItem('pushplanner.tightest'));
    if (saved.tightest === undefined && old >= 10 && old <= 40) values.tightest = old;
  } catch (e) {
    /* defaults */
  }
  if (values.tightest < 10 || values.tightest > 40) values.tightest = defaults.tightest;
  PS.plan.setMinRadius(values.tightest);

  function get(name) {
    return values[name];
  }
  function set(name, v) {
    values[name] = v;
    if (name === 'tightest') PS.plan.setMinRadius(v);
    if ((name === 'insetTop' || name === 'insetBottom') && PS.applyInsets) PS.applyInsets();
    if (name === 'uiSize' && PS.relayout) PS.relayout();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(values));
    } catch (e) {
      /* not saved */
    }
    PS.log('settings', name + ' = ' + v);
    if (PS.persist) PS.persist.schedule();
  }
  function all() {
    var o = {},
      n;
    for (n in values) o[n] = values[n];
    return o;
  }
  // Apply settings read from the settings file: only known names of the right type, with the side effects a change has. Returns how many were applied.
  function merge(src) {
    var n = 0,
      name;
    if (!src || typeof src !== 'object') return 0;
    for (name in defaults) {
      if (src[name] !== undefined && typeof src[name] === typeof defaults[name] && src[name] !== values[name]) {
        if (name === 'tightest' && (src[name] < 10 || src[name] > 40)) continue;
        values[name] = src[name];
        n++;
      }
    }
    PS.plan.setMinRadius(values.tightest);
    if (PS.applyInsets) PS.applyInsets();
    if (PS.relayout) PS.relayout();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(values));
    } catch (e) {
      /* not saved */
    }
    return n;
  }
  return { get: get, set: set, all: all, merge: merge };
})();
