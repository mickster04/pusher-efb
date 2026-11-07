// App shell and EFB registration. Pattern follows the open-source iframe EFB app (plain JS, window.EFB_API + window.msfssdk).
// The four names must match or the sim silently ignores the app: PS.INTERNAL_NAME, this file's output name,
// the PackageSources folder name and the OutputDir in the package definition.

PS.injectStyle = function () {
  var id = 'ps-style-' + PS.INTERNAL_NAME;
  var el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    el.type = 'text/css';
    document.head.appendChild(el);
  }
  PS.theme.attach(el);
  if (el.firstChild) el.firstChild.nodeValue = PS.theme.css();
  else el.appendChild(document.createTextNode(PS.theme.css()));
};

// Builds the whole UI into `root` using plain DOM. Returns { showPage }.
PS.buildShell = function (root) {
  var h = PS.h;
  PS.rootEl = root;
  var instances = {};
  var current = null;
  var navButtons = {};

  var nav = h('div', { class: 'ps-nav' });
  var toastHost = h('div', { class: 'ps-toasts' });
  var body = h('div', { class: 'ps-body' });
  var footer = h('div', { class: 'ps-footer' });

  function showPage(id) {
    if (current && instances[current] && instances[current].onHide) instances[current].onHide();
    if (current && instances[current]) instances[current].el.style.display = 'none';
    var page = null;
    for (var i = 0; i < PS.pages.length; i++) {
      if (PS.pages[i].id === id) page = PS.pages[i];
    }
    if (!page) return;
    if (!instances[id]) {
      try {
        instances[id] = page.create({});
      } catch (e) {
        PS.log('app', 'page ' + id + ' failed to build: ' + PS.errText(e));
        instances[id] = {
          el: h('div', { class: 'ps-page' }, PS.ui.note('This page failed to build: ' + PS.errText(e), 'warn')),
          onShow: function () {},
          onHide: function () {}
        };
      }
      body.appendChild(instances[id].el);
    }
    instances[id].el.style.display = '';
    current = id;
    for (var k in navButtons) {
      navButtons[k].className = 'ps-navbtn' + (k === id ? ' on' : '');
    }
    try {
      if (instances[id].onShow) instances[id].onShow();
    } catch (e2) {
      PS.log('app', 'page ' + id + ' onShow failed: ' + PS.errText(e2));
    }
  }

  function buildReport() {
    var env = PS.env(),
      hb = PS.hb;
    var lines = [
      PS.APP_NAME + ' ' + PS.VERSION + ' report, ' + new Date().toISOString(),
      PS.aircraftLine(),
      'env: ' +
        Object.keys(env)
          .map(function (k) {
            return k + '=' + env[k];
          })
          .join(' '),
      'heartbeat: timer ticks ' +
        hb.ticks +
        ', onUpdate frames ' +
        hb.frames +
        ', animation frames ' +
        hb.raf +
        ', max timer gap ' +
        hb.maxGapMs +
        ' ms, ' +
        (hb.paused ? 'PAUSED' : 'visible'),
      'hooks called: ' +
        (Object.keys(hb.hooks)
          .map(function (n) {
            return n + ' x' + hb.hooks[n];
          })
          .join(', ') || 'none'),
      hb.lastPause
        ? 'last hidden period: ' +
          Math.round(hb.lastPause.ms / 1000) +
          ' s, ' +
          hb.lastPause.ticks +
          ' timer ticks, ' +
          hb.lastPause.frames +
          ' onUpdate frames, ' +
          hb.lastPause.raf +
          ' animation frames'
        : 'no hidden period recorded',
      '',
      '=== LOG (' + PS.logs.length + ' lines) ==='
    ];
    PS.logs.forEach(function (e) {
      lines.push(PS.fmtLog(e));
    });
    PS.pages.forEach(function (p) {
      var inst = instances[p.id];
      if (inst && typeof inst.snapshot === 'function') {
        var snap = '';
        try {
          snap = inst.snapshot();
        } catch (e) {
          snap = 'snapshot failed: ' + PS.errText(e);
        }
        if (snap) {
          lines.push('', '=== ' + p.title + ' snapshot ===');
          lines.push(snap);
        }
      }
    });
    return lines.join('\n');
  }
  PS.copyAllLogs = function () {
    copyAll();
  };
  function copyAll() {
    var text = buildReport();
    var ok = PS.ui.copyText(text);
    PS.log('app', ok ? 'copied all logs (' + text.length + ' characters)' : 'clipboard copy not available; showing text');
    if (ok)
      PS.toasts.show({
        kind: 'info',
        title: 'All logs copied',
        message: PS.logs.length + ' log lines and page snapshots are on the clipboard.',
        ttlMs: 3000
      });
    else PS.ui.showText(text, 'All logs (select all and copy)');
  }

  PS.pages.forEach(function (p) {
    navButtons[p.id] = h('button', {
      type: 'button',
      class: 'ps-navbtn',
      text: p.title,
      onclick: function () {
        showPage(p.id);
      }
    });
    nav.appendChild(navButtons[p.id]);
  });

  // toasts
  function paintToasts(items) {
    PS.clear(toastHost);
    items.forEach(function (t) {
      var actions = h('div', { class: 'ps-toast-actions' });
      (t.actions || []).forEach(function (a) {
        actions.appendChild(PS.ui.button(a.label, a.onClick, 'ps-small'));
      });
      if (!t.persistent || !(t.actions && t.actions.length)) {
        actions.appendChild(
          PS.ui.button(
            'x',
            function () {
              PS.toasts.dismiss(t.id);
            },
            'ps-small ps-ghost'
          )
        );
      }
      toastHost.appendChild(
        h(
          'div',
          { class: 'ps-toast ps-toast-' + t.kind },
          h('div', { class: 'ps-toast-title', text: t.title }),
          h('div', { class: 'ps-toast-msg', text: t.message }),
          actions
        )
      );
    });
  }
  PS.toasts.subscribe(paintToasts);

  function paintFooter() {
    var env = PS.env();
    var hb = PS.hb;
    footer.textContent =
      PS.APP_NAME +
      ' ' +
      PS.VERSION +
      '  |  SimVar ' +
      (env.simVar ? 'ok' : 'MISSING') +
      '  |  Coherent ' +
      (env.coherent ? 'ok' : 'MISSING') +
      '  |  timer ticks ' +
      hb.ticks +
      '  |  onUpdate frames ' +
      hb.frames +
      (hb.paused ? '  |  PAUSED' : '');
  }
  paintFooter();
  // Landscape or portrait: the pages put their map and controls side by side when the tablet is wider than it is tall.
  function updateOrientation() {
    var w = root.clientWidth || window.innerWidth,
      hgt = root.clientHeight || window.innerHeight;
    if (!(w > 0 && hgt > 0)) return;
    var land = w > hgt * 1.1;
    if (land === !!PS.state.landscape && PS.state.layoutLogged) return;
    PS.state.landscape = land;
    PS.state.layoutLogged = true;
    root.className = 'ps-root' + (land ? ' ps-landscape' : '');
    PS.logv('app', 'layout: ' + (land ? 'landscape' : 'portrait') + ' (' + w + ' x ' + hgt + ')');
  }
  updateOrientation();
  var orientHook = function () {
    updateOrientation();
  };
  PS.frameHooks.push(orientHook);
  try {
    window.addEventListener('resize', updateOrientation);
  } catch (eR) {
    /* no resize events */
  }
  var footTimer = setInterval(function () {
    paintFooter();
    updateOrientation();
  }, 1000);

  var appEl = h(
    'div',
    { class: 'ps-app' },
    h(
      'div',
      { class: 'ps-header' },
      h('span', { class: 'ps-title', text: PS.APP_NAME }),
      h('span', { class: 'ps-sub', text: 'pushback planner' })
    ),
    nav,
    toastHost,
    body,
    footer
  );
  root.appendChild(appEl);
  // The EFB draws its own header and bottom bar over the top and bottom of an app; the margins (Settings) keep this app's own header and footer clear of them.
  PS.applyInsets = function () {
    appEl.style.top = PS.settings.get('insetTop') + 'px';
    appEl.style.bottom = PS.settings.get('insetBottom') + 'px';
  };
  PS.applyInsets();

  showPage(PS.pages[0].id);
  return {
    showPage: showPage,
    dispose: function () {
      clearInterval(footTimer);
      var oi = PS.frameHooks.indexOf(orientHook);
      if (oi >= 0) PS.frameHooks.splice(oi, 1);
      try {
        window.removeEventListener('resize', updateOrientation);
      } catch (eR2) {
        /* ignore */
      }
    }
  };
};

PS.createViewClass = function (sdk) {
  return class PushPlannerView extends sdk.DisplayComponent {
    constructor(props) {
      super(props);
      this.rootRef = sdk.FSComponent.createRef();
      this.shell = null;
      this.pageKeyActions = new Map();
    }
    render() {
      return sdk.FSComponent.buildComponent('div', { class: 'ps-root', ref: this.rootRef });
    }
    onAfterRender() {
      var root = this.rootRef.instance;
      if (!root || this.shell) return;
      try {
        PS.injectStyle();
        PS.theme.loadFiles();
        PS.theme.loadSaved();
        PS.hbStart();
        PS.rafStart();
        this.shell = PS.buildShell(root);
        PS.log('app', PS.APP_NAME + ' ' + PS.VERSION + ' view rendered');
      } catch (e) {
        PS.log('app', 'shell failed: ' + PS.errText(e));
        root.textContent = 'Push Planner failed to start: ' + PS.errText(e);
      }
    }
    // EFB lifecycle hooks (names per the open-source sample; unverified against the SDK docs).
    onOpen() {
      PS.hook('onOpen');
      PS.toasts.setAppOpen(true);
      PS.hbStart();
      PS.rafStart();
    }
    onResume() {
      PS.hook('onResume');
      PS.toasts.setAppOpen(true);
      PS.hbResume();
    }
    onPause() {
      PS.hook('onPause');
      PS.toasts.setAppOpen(false);
      PS.hbPause();
      PS.runCloseHooks('app paused');
    }
    onClose() {
      PS.hook('onClose');
      PS.toasts.setAppOpen(false);
      PS.runCloseHooks('app closed');
      PS.hbStop();
    }
    onUpdate() {
      PS.hook('onUpdate');
      PS.hbFrame();
    }
    routeGamepadInteractionEvent() {
      PS.hook('routeGamepadInteractionEvent');
    }
    handlePageKeyAction() {
      PS.hook('handlePageKeyAction');
    }
    destroy() {
      PS.runCloseHooks('view destroyed');
      if (this.shell && this.shell.dispose) this.shell.dispose();
      super.destroy();
    }
  };
};

PS.runCloseHooks = function (why) {
  for (var i = 0; i < PS.closeHooks.length; i++) {
    try {
      PS.closeHooks[i](why);
    } catch (e) {
      PS.log('app', 'close hook failed: ' + PS.errText(e));
    }
  }
};

// Returns true once the app has been handed to the EFB. False while the EFB or SDK globals are not ready.
PS.registerApp = function () {
  var sdk = PS.global.msfssdk;
  var efb = PS.global.EFB_API;
  if (!sdk || !efb || typeof efb.use !== 'function') return false;

  var View = PS.createViewClass(sdk);
  var BASE_URL = 'coui://html_ui/efb_ui/efb_apps/' + PS.INTERNAL_NAME;

  class PushPlannerApp {
    constructor() {
      this.available = sdk.Subject.create(true);
      this.BootMode = 0; // AppBootMode.COLD
      this.SuspendMode = 0; // AppSuspendMode.SLEEP
      this._isReady = false;
      this._favoriteIndex = -1;
      this.bus = null;
    }
    get name() {
      return PS.APP_NAME;
    }
    get internalName() {
      return PS.INTERNAL_NAME;
    }
    get icon() {
      return BASE_URL + '/Assets/app-icon.svg';
    }
    get isReady() {
      return this._isReady;
    }
    get favoriteIndex() {
      return this._favoriteIndex;
    }
    set favoriteIndex(v) {
      this._favoriteIndex = v;
    }
    get compatibleAircraftModels() {
      return undefined;
    }
    get unitsSettingsManager() {
      return this._unitsSettingsManager;
    }
    getIsSearchable() {
      return true;
    }
    getIsFavoritable() {
      return true;
    }
    getVersion() {
      return PS.VERSION;
    }
    async install() {
      /* nothing to load */
    }
    async _install(props) {
      this.bus = props && props.bus;
      this._unitsSettingsManager = props && props.unitsSettingManager;
      this.notificationManager = props && props.notificationManager;
      this.efbSettingsManager = props && props.efbSettingsManager;
      this.options = props && props.options;
      PS.state.bus = this.bus || null;
      PS.state.notificationManager = this.notificationManager || null;
      await this.install(props);
      this._isReady = true;
      try {
        if (window.Coherent && typeof window.Coherent.trigger === 'function') {
          window.Coherent.trigger('EFB_APP_INSTALLED', PS.APP_NAME, PS.INTERNAL_NAME, '1.0.3', PS.VERSION);
        }
      } catch (e) {
        /* informational only */
      }
    }
    render() {
      return sdk.FSComponent.buildComponent(View, { bus: this.bus });
    }
  }

  // use() throws until the EFB has handed over its bus; the caller retries.
  efb.use(PushPlannerApp);
  return true;
};

// The EFB OS and this script load independently, so retry for about 15 s (150 x 100 ms), then give up quietly.
PS.registerWhenReady = function (attempt) {
  var done = false,
    why = '';
  try {
    done = PS.registerApp();
  } catch (e) {
    done = false;
    why = PS.errText ? PS.errText(e) : String(e);
  }
  if (!done && attempt < 150) {
    setTimeout(function () {
      PS.registerWhenReady(attempt + 1);
    }, 100);
  } else if (!done) {
    PS.log('app', 'gave up registering with the EFB after 150 attempts' + (why ? ' (last error: ' + why + ')' : ''));
  }
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  PS.registerWhenReady(1);
}
