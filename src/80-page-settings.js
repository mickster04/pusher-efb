// Settings tab: the options that apply to planning and pushing.

PS.pages.push({
  id: 'settings',
  title: 'Settings',
  create: function () {
    var ui = PS.ui, h = PS.h;
    var TIGHT_STEPS = [18, 22, 26, 30, 34, 40];
    var tight = PS.settings.get('tightest');
    var tightest = ui.stepper(TIGHT_STEPS, TIGHT_STEPS.indexOf(tight) >= 0 ? tight : 26, function (v) {
      PS.settings.set('tightest', v); PS.log('plan', 'tightest allowed turn radius set to ' + v + ' m');
    }, 'settings', ['Tighter  -', 'Looser  +'], function (v) { return v + ' m'; });
    var SPEED_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    var maxSpeed = ui.stepper(SPEED_STEPS, PS.push.view().speedPercent, function (v) { PS.push.setSpeedPercent(v); }, 'settings', ['Slower  -', 'Faster  +'],
      function (v) { return v + '% (' + PS.fmt.num(v / 100 * 10 * 0.5925, 1) + ' kt forward, ' + PS.fmt.num(v / 100 * 10 * 0.75 * 0.5925, 1) + ' kt in reverse)'; });
    var snap = ui.toggle([{ value: 'on', label: 'Snap on' }, { value: 'off', label: 'Snap off' }], PS.settings.get('snap') ? 'on' : 'off', function (v) { PS.settings.set('snap', v === 'on'); });
    var tab = ui.toggle([{ value: 'suggested', label: 'Suggested pushes' }, { value: 'pins', label: 'Custom pins' }], PS.settings.get('planTab'), function (v) { PS.settings.set('planTab', v); });
    return {
      el: h('div', { class: 'ps-page' },
        ui.panel('Pushing',
          ui.field('Maximum cruise speed', maxSpeed.el),
          ui.note('The most the tug will do on a straight. It chooses its own speed along the route, up to this: slower in curves (more so the tighter they are), slowing in good time before each curve, and easing down to a crawl as it nears the end. Changes apply to a push already under way.')),
        ui.panel('Planning',
          ui.field('Tightest turn the plan may use', tightest.el),
          ui.note('The plan uses a 40 m turn radius. Where a corner is too cramped for that it tries tighter ones, down to this. Smaller means the tug has to turn harder: check the Route panel on the Push tab for warnings.'),
          ui.field('Snap pins to the taxiway', snap.el),
          ui.note('With snap on, a pin you drop or move within 35 m of a taxiway takes the taxiway\'s heading (the direction needing the smaller turn). Rotating a pin by hand overrides it.'),
          ui.field('Plan tab opens on', tab.el),
          ui.note('Which list the Plan tab shows first. It also switches by itself: placing a pin shows the pins, picking a suggestion shows the suggestions.'))),
      onShow: function () {}, onHide: function () {}
    };
  }
});
