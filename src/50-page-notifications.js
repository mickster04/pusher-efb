// Spike 5: popups. Part A is our own in-tablet toast host (always works, can carry action buttons).
// Part B probes the EFB's notificationManager (handed to the app at install) to see what it offers.

PS.pages.push({
  id: 'notifications',
  title: '5 Notifications',
  create: function (ctx) {
    var ui = PS.ui, h = PS.h;
    var distance = 180;
    var paused = false;
    var distTimer = null;

    function log(msg) { PS.log('notify', msg); }
    function act(label) { return function () { log('button pressed: ' + label); }; }

    var kinds = [
      ['Info (auto-dismiss)', function () {
        PS.toasts.show({ kind: 'info', title: 'Tug attached', message: 'Ready to push. Release the parking brake when clear.', ttlMs: 5000 });
        log('shown: info');
      }],
      ['Release parking brake', function () {
        PS.toasts.show({ id: 'parking-brake', kind: 'brake', title: 'Release parking brake',
          message: 'Pushback is armed and waiting. Release the parking brake in the cockpit; the tug starts as soon as it is off.',
          persistent: true, actions: [{ label: 'Dismiss', onClick: function () { PS.toasts.dismiss('parking-brake'); log('dismissed: parking brake'); } }] });
        log('shown: release parking brake');
      }],
      ['Set parking brake (2 actions)', function () {
        PS.toasts.show({ id: 'set-brake', kind: 'brake', title: 'Set the parking brake',
          message: 'Pushback finished. Set the parking brake, then dismiss the tug or return to the gate.',
          persistent: true, actions: [
            { label: 'Dismiss tug', onClick: function () { log('action: dismiss tug'); PS.toasts.dismiss('set-brake'); } },
            { label: 'Return to gate', onClick: function () { log('action: return to gate'); PS.toasts.dismiss('set-brake'); } }] });
        log('shown: set parking brake');
      }],
      ['Distance left + Pause/Resume', function () {
        distance = 180; paused = false;
        function body() { return 'Distance left: ' + Math.round(distance) + ' m' + (paused ? ' (paused)' : ''); }
        function actions() {
          return [{ label: paused ? 'Resume' : 'Pause', onClick: function () { paused = !paused; PS.toasts.update('distance', { message: body(), actions: actions() }); log(paused ? 'action: pause' : 'action: resume'); } },
            { label: 'Stop', onClick: function () { PS.toasts.dismiss('distance'); if (distTimer) { clearInterval(distTimer); distTimer = null; } log('action: stop'); } }];
        }
        PS.toasts.show({ id: 'distance', kind: 'info', title: 'Pushing back', message: body(), persistent: true, actions: actions() });
        if (distTimer) clearInterval(distTimer);
        distTimer = setInterval(function () {
          if (!paused) distance = Math.max(0, distance - 4);
          var ok = PS.toasts.update('distance', { message: body() });
          if (!ok || distance <= 0) { clearInterval(distTimer); distTimer = null; if (distance <= 0) PS.toasts.dismiss('distance'); }
        }, 500);
        log('shown: distance left (counts down live)');
      }],
      ['Traffic hold + Ignore', function () {
        PS.toasts.show({ id: 'traffic', kind: 'warn', title: 'Holding for traffic',
          message: 'Another aircraft is on the route ahead. The push resumes when it clears.',
          persistent: true, actions: [{ label: 'Ignore traffic', onClick: function () { log('action: ignore traffic'); PS.toasts.dismiss('traffic'); } }] });
        log('shown: traffic hold');
      }]
    ];

    var buttons = h('div', { class: 'ps-row' });
    kinds.forEach(function (k) { buttons.appendChild(ui.button(k[0], k[1])); });
    buttons.appendChild(ui.button('Clear all', function () { PS.toasts.clear(); log('cleared'); }, 'ps-ghost'));

    // ---- Part B: EFB notificationManager probe ----
    var probeOut = h('pre', { class: 'ps-log', text: '(press Inspect)' });
    var probeButtons = h('div', { class: 'ps-row' });
    var payload = ui.input('Hello from Pusher Spikes', { placeholder: 'Test message' });

    function methodsOf(obj) {
      var names = {};
      var o = obj, depth = 0;
      while (o && o !== Object.prototype && depth < 4) {
        Object.getOwnPropertyNames(o).forEach(function (n) { if (n !== 'constructor') names[n] = typeof obj[n]; });
        o = Object.getPrototypeOf(o); depth++;
      }
      return names;
    }
    function inspect() {
      var nm = PS.state.notificationManager;
      PS.clear(probeButtons);
      if (!nm) { probeOut.textContent = 'No notificationManager was handed to the app (install props had none).'; log('no notificationManager'); return; }
      var m = methodsOf(nm);
      var lines = Object.keys(m).sort().map(function (n) { return n + ' : ' + m[n]; });
      probeOut.textContent = 'notificationManager members:\n' + lines.join('\n');
      log('notificationManager has ' + lines.length + ' members');
      lines.forEach(function (l) { log('  member ' + l); });
      Object.keys(m).sort().forEach(function (n) {
        if (m[n] !== 'function' || !/^(add|show|create|push|send)/i.test(n)) return;
        try {
          var src = String(nm[n]);
          log(n + '.length = ' + nm[n].length + ' (declared argument count)');
          log(n + ' source: ' + src.replace(/\s+/g, ' ').substring(0, 700));
        } catch (e) { log(n + ' source unavailable: ' + PS.errText(e)); }
      });
      Object.keys(m).sort().forEach(function (n) {
        if (m[n] !== 'function' || !/notif|show|push|add|send|create|post|alert/i.test(n)) return;
        probeButtons.appendChild(ui.button('Try ' + n + '()', function () { tryCall(nm, n); }, 'ps-warn'));
      });
      if (!probeButtons.firstChild) probeButtons.appendChild(ui.note('No obviously notification-like methods to try. Read the member list above.'));
    }
    function tryCall(nm, name) {
      var text = payload.value || 'Test';
      var shapes = [
        function () { return nm[name]({ title: 'Pusher Spikes', message: text, description: text, body: text }); },
        function () { return nm[name]('Pusher Spikes', text); },
        function () { return nm[name](text); }
      ];
      for (var i = 0; i < shapes.length; i++) {
        try {
          var r = shapes[i]();
          log(name + '() shape ' + (i + 1) + ' did not throw; returned ' + (r === undefined ? 'undefined' : typeof r) + '. Check the tablet for a notification.');
          return;
        } catch (e) { log(name + '() shape ' + (i + 1) + ' threw: ' + PS.errText(e)); }
      }
      log(name + '(): all three argument shapes threw');
    }

    var el = h('div', { class: 'ps-page' },
      ui.panel('A. In-tablet toasts (our own, with action buttons)',
        buttons,
        ui.note('These appear at the top of the app on every page, like the original app\'s overlay toasts. They are only visible while the tablet is open.')),
      ui.panel('B. EFB notification manager (probe)',
        h('div', { class: 'ps-row' }, ui.button('Inspect notificationManager', inspect), ui.field('Test text', payload)),
        probeButtons, probeOut,
        ui.note('Each Try button calls the method with three argument shapes until one does not throw. The member list tells us what the EFB really offers; read it before trusting any result.')),
      ui.panel('Log', ui.logBox(['notify']))
    );
    return { el: el, onShow: function () {}, onHide: function () {} };
  }
});
