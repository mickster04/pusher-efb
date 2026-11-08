// What the follower learned about an aircraft while pushing it (how far ahead of its turning point the reported position is), kept between sessions so
// the next push starts with it. Stored in localStorage like the settings (the app works without it), per aircraft model rather than livery.
// A built-in profile (aircraft-profiles.js) is the fallback; a value learned here on this machine wins over it.

PS.learned = (function () {
  var KEY = 'pushplanner.learned';
  var memory = {}; // used when storage is unavailable
  var MAX_KEPT = 30;

  function load() {
    try {
      return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
    } catch (e) {
      return memory;
    }
  }
  function store(all) {
    memory = all;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) {
      /* kept in memory for this session */
    }
  }
  // The same airframe under any livery: the ATC model string, else the title.
  function keyOf(info) {
    return info ? String(info.model || info.title || '').replace(/^\s+|\s+$/g, '') : '';
  }

  // { pivotM, pushes } or null.
  function get(info) {
    var k = keyOf(info),
      v = k ? load()[k] : null;
    return v && typeof v.pivotM === 'number' && isFinite(v.pivotM) ? v : null;
  }

  // Remember a pivot learned in a push. A second push blends with the first, so one odd push cannot overwrite what several agreed on.
  function save(info, pivotM) {
    var k = keyOf(info);
    if (!k || typeof pivotM !== 'number' || !isFinite(pivotM)) return null;
    var all = load(),
      old = all[k],
      pushes = old && old.pushes ? old.pushes : 0;
    var next = { pivotM: old && typeof old.pivotM === 'number' ? (old.pivotM + pivotM) / 2 : pivotM, pushes: pushes + 1, at: Date.now() };
    all[k] = next;
    var keys = Object.keys(all);
    if (keys.length > MAX_KEPT) {
      keys.sort(function (a, b) {
        return all[a].at - all[b].at;
      });
      delete all[keys[0]];
    }
    store(all);
    return next;
  }

  return { get: get, save: save, keyOf: keyOf };
})();
