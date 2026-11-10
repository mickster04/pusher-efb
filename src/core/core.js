// Core: constants, sim access wrappers, logging, DOM helper, heartbeat, toasts.
// Nothing here touches the DOM or starts timers at load time (so node tests can load the bundle).

PS.VERSION = '0.0.0'; // the real one comes from package.json at build time (tools/build-app.mjs)
PS.APP_NAME = 'Push Planner';
PS.INTERNAL_NAME = 'PushPlanner';
PS.pages = [];
PS.closeHooks = []; // called when the view closes or pauses (e.g. stop the tug)
PS.state = { appOpen: true, taxi: null, contacts: [], pins: [], notificationManager: null, bus: null };

PS.global = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : {};

// SimVar / Coherent may be script-scope globals rather than window properties, so use the bare name.
PS.simVar = function () {
  if (typeof SimVar !== 'undefined') return SimVar;
  return PS.global.SimVar || null;
};
PS.coherent = function () {
  if (typeof Coherent !== 'undefined') return Coherent;
  return PS.global.Coherent || null;
};

PS.env = function () {
  var sv = PS.simVar();
  var co = PS.coherent();
  var sdk = PS.global.msfssdk;
  return {
    simVar: !!(sv && sv.GetSimVarValue),
    coherent: !!(co && co.call),
    efb: !!(PS.global.EFB_API && PS.global.EFB_API.use),
    sdk: !!sdk,
    notificationManager: !!PS.state.notificationManager
  };
};

// ---- logging ----
PS.logs = [];
PS.logListeners = [];
PS.log = function (channel, msg) {
  var entry = { t: Date.now(), ch: channel, msg: String(msg) };
  PS.logs.push(entry);
  if (PS.logs.length > 3000) PS.logs.shift();
  for (var i = 0; i < PS.logListeners.length; i++) {
    try {
      PS.logListeners[i](entry);
    } catch (e) {
      /* listener errors must not break the app */
    }
  }
  return entry;
};
// Two levels. PS.log is the normal log: what happened and what went wrong (actions, results, failures). PS.logv is the detail: it is kept only while
// detailed logging is on (the Diagnostics panel's switch) or a diagnostic check is running, so a normal session log stays short.
PS.detail = { on: false, running: 0 };
PS.logv = function (channel, msg) {
  if (PS.detail.on || PS.detail.running > 0) return PS.log(channel, msg);
  return null;
};
PS.fmtLog = function (e) {
  var d = new Date(e.t);
  function p(n, w) {
    n = String(n);
    while (n.length < (w || 2)) n = '0' + n;
    return n;
  }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3) + ' [' + e.ch + '] ' + e.msg;
};

function errText(e) {
  return String((e && e.message) || e);
}
PS.errText = errText;

// ---- sim access ----
PS.getVar = function (name, unit) {
  var sv = PS.simVar();
  if (!sv || !sv.GetSimVarValue) return { ok: false, error: 'SimVar not available' };
  try {
    return { ok: true, value: sv.GetSimVarValue(name, unit) };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
};

// Which aircraft this is, as far as the sim says: for a report, so a problem with an aircraft nobody has tried can be traced to it. Read-only.
// The sim has no version variable for an aircraft: the title often carries the variant or livery, and that is all there is.
PS.aircraftInfo = function () {
  function str(name) {
    var r = PS.getVar(name, 'string');
    return r.ok && typeof r.value === 'string' ? r.value.replace(/^\s+|\s+$/g, '') : '';
  }
  function num(name, unit) {
    var r = PS.getVar(name, unit);
    return r.ok && typeof r.value === 'number' && isFinite(r.value) ? r.value : null;
  }
  return {
    title: str('TITLE'),
    model: str('ATC MODEL'),
    type: str('ATC TYPE'),
    airline: str('ATC AIRLINE'),
    engines: num('NUMBER OF ENGINES', 'number'),
    engineType: num('ENGINE TYPE', 'enum') // 0 piston, 1 jet, 2 none (glider), 3 helo turbine, 4 rocket, 5 turboprop
  };
};
PS.aircraftLine = function () {
  var a = PS.aircraftInfo(),
    br = PS.brake && PS.brake.read ? PS.brake.read(true) : null;
  return (
    'aircraft: ' +
    (a.title || 'title unreadable') +
    (a.model ? ' | model ' + a.model : '') +
    (a.type ? ' | type ' + a.type : '') +
    (a.airline ? ' | airline ' + a.airline : '') +
    ' | engines ' +
    (a.engines === null ? '?' : a.engines) +
    ' | engine type ' +
    (a.engineType === null ? '?' : a.engineType) +
    (br && br.lvar ? ' | brake lever variable ' + br.lvar.name : '')
  );
};

// SetSimVarValue returns a promise in the sim; failures there are logged (the first few, then now and again), not thrown.
// PS.setFailRun counts the writes that failed in a row, so a caller that writes every tick can notice the sim is refusing them.
PS.setFailRun = 0;
PS.setVar = function (name, unit, value) {
  var sv = PS.simVar();
  if (!sv || !sv.SetSimVarValue) return { ok: false, error: 'SimVar not available' };
  try {
    var r = sv.SetSimVarValue(name, unit, value);
    if (r && typeof r.then === 'function') {
      r.then(
        function () {
          PS.setFailRun = 0;
        },
        function (e) {
          PS.setFailRun++;
          if (PS.setFailRun <= 3 || PS.setFailRun % 200 === 0)
            PS.log('set', 'async failure ' + name + ': ' + errText(e) + ' (' + PS.setFailRun + ' in a row)');
        }
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
};

// method: 'simvar' (K:NAME via SetSimVarValue) or 'coherent' (TRIGGER_KEY_EVENT)
PS.keyEvent = function (name, value, method) {
  var v = value === undefined ? 0 : value;
  try {
    if (method === 'coherent') {
      var co = PS.coherent();
      if (!co || !co.call) return { ok: false, error: 'Coherent not available' };
      var r = co.call('TRIGGER_KEY_EVENT', name, v);
      if (r && typeof r.then === 'function') {
        r.then(null, function (e) {
          PS.log('key', 'async failure ' + name + ': ' + errText(e));
        });
      }
      return { ok: true };
    }
    return PS.setVar('K:' + name, 'number', v);
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
};

// Own aircraft snapshot used by several pages. Returns null when the sim is not readable.
PS.readOwn = function () {
  var lat = PS.getVar('PLANE LATITUDE', 'degrees');
  var lon = PS.getVar('PLANE LONGITUDE', 'degrees');
  if (!lat.ok || !lon.ok || typeof lat.value !== 'number' || typeof lon.value !== 'number') return null;
  function num(name, unit) {
    var r = PS.getVar(name, unit);
    return r.ok && typeof r.value === 'number' ? r.value : 0;
  }
  return {
    lat: lat.value,
    lon: lon.value,
    hdgDeg: num('PLANE HEADING DEGREES TRUE', 'degrees'),
    gsKt: num('GROUND VELOCITY', 'knots'),
    altFt: num('PLANE ALTITUDE', 'feet'),
    onGround: num('SIM ON GROUND', 'bool') > 0
  };
};

// ---- DOM helper (only call from the browser) ----
PS.h = function (tag, attrs) {
  var el = document.createElement(tag);
  var k;
  if (attrs) {
    for (k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.substring(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  function add(c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) {
      for (var j = 0; j < c.length; j++) add(c[j]);
      return;
    }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  for (var i = 2; i < arguments.length; i++) add(arguments[i]);
  return el;
};

PS.clear = function (el) {
  while (el.firstChild) el.removeChild(el.firstChild);
};

// ---- formatting ----
PS.fmt = {
  num: function (v, dp) {
    if (typeof v !== 'number' || !isFinite(v)) return '-';
    return v.toFixed(dp === undefined ? 2 : dp);
  },
  dist: function (m) {
    if (typeof m !== 'number' || !isFinite(m)) return '-';
    return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
  }
};

// ---- heartbeat: does anything keep ticking while the app is hidden? ----
PS.hb = {
  timer: null,
  ticks: 0,
  frames: 0,
  paused: false,
  raf: 0,
  rafOn: false,
  rafAtPause: 0,
  hooks: {},
  startedAt: 0,
  last: 0,
  maxGapMs: 0,
  pausedAt: 0,
  ticksAtPause: 0,
  framesAtPause: 0,
  lastPause: null
};
// Counts every EFB lifecycle hook call (logs the first of each) to see which ones the EFB really calls.
PS.hook = function (name) {
  var hooks = PS.hb.hooks;
  if (!hooks[name]) PS.logv('hook', name + ' called for the first time');
  hooks[name] = (hooks[name] || 0) + 1;
};
// Independent of the EFB's own onUpdate: counts the browser's animation frames (these normally stop when hidden).
PS.rafStart = function () {
  if (PS.hb.rafOn || typeof requestAnimationFrame !== 'function') return;
  PS.hb.rafOn = true;
  (function loop() {
    if (!PS.hb.rafOn) return;
    PS.hb.raf++;
    requestAnimationFrame(loop);
  })();
};
PS.hbStart = function () {
  var hb = PS.hb;
  if (hb.timer !== null) return;
  hb.startedAt = hb.last = Date.now();
  hb.timer = setInterval(function () {
    var now = Date.now();
    var gap = now - hb.last;
    if (gap > hb.maxGapMs) hb.maxGapMs = gap;
    hb.last = now;
    hb.ticks++;
  }, 500);
};
PS.hbStop = function () {
  if (PS.hb.timer !== null) {
    clearInterval(PS.hb.timer);
    PS.hb.timer = null;
  }
  PS.hb.rafOn = false;
};
PS.frameHooks = []; // called on every EFB onUpdate (while the app is visible); pages use it as a second redraw trigger
PS.hbFrame = function () {
  PS.hb.frames++;
  for (var i = 0; i < PS.frameHooks.length; i++) {
    try {
      PS.frameHooks[i]();
    } catch (e) {
      /* a hook must not break the update loop */
    }
  }
};
PS.hbPause = function () {
  var hb = PS.hb;
  if (hb.paused) return;
  hb.paused = true;
  hb.pausedAt = Date.now();
  hb.ticksAtPause = hb.ticks;
  hb.framesAtPause = hb.frames;
  hb.rafAtPause = hb.raf;
};
PS.hbResume = function () {
  var hb = PS.hb;
  if (!hb.paused) return;
  hb.lastPause = {
    ms: Date.now() - hb.pausedAt,
    ticks: hb.ticks - hb.ticksAtPause,
    frames: hb.frames - hb.framesAtPause,
    raf: hb.raf - hb.rafAtPause
  };
  hb.paused = false;
  PS.logv(
    'heartbeat',
    'resumed after ' +
      Math.round(hb.lastPause.ms / 1000) +
      ' s hidden: ' +
      hb.lastPause.ticks +
      ' timer ticks, ' +
      hb.lastPause.frames +
      ' onUpdate frames, ' +
      hb.lastPause.raf +
      ' animation frames while hidden'
  );
};

// ---- toasts (in-tablet popups with action buttons) ----
PS.toasts = {
  items: [],
  listeners: [],
  seq: 0,
  subscribe: function (fn) {
    this.listeners.push(fn);
  },
  emit: function () {
    for (var i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](this.items);
      } catch (e) {
        /* ignore */
      }
    }
  },
  // opts: { id?, kind, title, message, actions: [{label, onClick}], persistent?, ttlMs? }
  show: function (opts) {
    var self = this;
    var id = opts.id || 't' + ++this.seq;
    // efbOnly: for a message that only matters while the app is not on screen (the Push tab shows the same thing). With the app open it
    // is not shown at all; with it closed it goes to the EFB's own notifications, once per id until dismissed.
    if (opts.efbOnly) {
      if (PS.state.appOpen) {
        this.dismiss(id);
        return id;
      }
      this.notifyEfb(id, opts);
    }
    var item = {
      id: id,
      kind: opts.kind || 'info',
      title: opts.title || '',
      message: opts.message || '',
      actions: opts.actions || [],
      persistent: !!opts.persistent,
      createdAt: Date.now(),
      efbOnly: !!opts.efbOnly
    };
    var replaced = false;
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        this.items[i] = item;
        replaced = true;
      }
    }
    if (!replaced) this.items.push(item);
    if (!item.persistent) {
      setTimeout(function () {
        self.dismiss(id);
      }, opts.ttlMs || 6000);
    }
    this.emit();
    return id;
  },
  sentToEfb: {},
  notifyEfb: function (id, opts) {
    var nm = PS.state.notificationManager;
    if (this.sentToEfb[id] || !nm || typeof nm.showNotification !== 'function') return;
    this.sentToEfb[id] = true;
    try {
      nm.showNotification({
        title: opts.title || '',
        description: opts.message || '',
        type: opts.kind === 'brake' ? 'WARNING' : 'MESSAGE',
        duration: opts.persistent ? 10000 : opts.ttlMs || 6000
      });
      PS.logv('app', 'EFB notification: ' + (opts.title || id));
    } catch (e) {
      PS.log('app', 'EFB notification failed: ' + PS.errText(e));
    }
  },
  // The app went on or off screen: messages meant only for while it is off screen are dropped when it comes back.
  setAppOpen: function (open) {
    PS.state.appOpen = !!open;
    if (open) {
      this.sentToEfb = {};
      this.items = this.items.filter(function (t) {
        return !t.efbOnly;
      });
      this.emit();
    }
  },
  update: function (id, patch) {
    for (var i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        for (var k in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) this.items[i][k] = patch[k];
        }
        this.emit();
        return true;
      }
    }
    return false;
  },
  dismiss: function (id) {
    delete this.sentToEfb[id];
    var n = this.items.length;
    this.items = this.items.filter(function (t) {
      return t.id !== id;
    });
    if (this.items.length !== n) this.emit();
  },
  clear: function () {
    this.items = [];
    this.emit();
  }
};
