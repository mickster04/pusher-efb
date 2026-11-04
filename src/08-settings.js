// Settings kept between runs (localStorage; the app still works if storage is unavailable): the tightest turn the plan may use, whether new
// pins snap to the taxiway they sit on, and which list the Plan tab opens with.

PS.settings = (function () {
  var KEY = 'pushplanner.settings';
  var defaults = { snap: true, snapM: 50, planTab: 'suggested', tightest: 26 };
  var values = {}, k;
  for (k in defaults) values[k] = defaults[k];
  try {
    var saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    for (k in defaults) { if (saved[k] !== undefined && typeof saved[k] === typeof defaults[k]) values[k] = saved[k]; }
    // the tightest turn used to have a key of its own
    var old = Number(window.localStorage.getItem('pushplanner.tightest'));
    if (saved.tightest === undefined && old >= 10 && old <= 40) values.tightest = old;
  } catch (e) { /* defaults */ }
  if (values.tightest < 10 || values.tightest > 40) values.tightest = defaults.tightest;
  PS.plan.setMinRadius(values.tightest);

  function get(name) { return values[name]; }
  function set(name, v) {
    values[name] = v;
    if (name === 'tightest') PS.plan.setMinRadius(v);
    try { window.localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) { /* not saved */ }
    PS.log('settings', name + ' = ' + v);
  }
  return { get: get, set: set };
})();
