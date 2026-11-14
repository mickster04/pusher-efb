// Settings tab: the options that apply to planning and pushing.

PS.pages.push({
  id: 'settings',
  title: PS.tt('Settings'),
  create: function () {
    var ui = PS.ui,
      h = PS.h;
    var TIGHT_STEPS = [18, 22, 26, 30, 34, 40];
    var tight = PS.settings.get('tightest');
    var tightest = ui.stepper(
      TIGHT_STEPS,
      TIGHT_STEPS.indexOf(tight) >= 0 ? tight : 26,
      function (v) {
        PS.settings.set('tightest', v);
        PS.log('plan', 'tightest allowed turn radius set to ' + v + ' m');
      },
      'settings',
      [PS.t('Tighter') + '  -', PS.t('Looser') + '  +'],
      function (v) {
        return v + ' m';
      }
    );
    var SPEED_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    var maxSpeed = ui.stepper(
      SPEED_STEPS,
      PS.push.view().speedPercent,
      function (v) {
        PS.push.setSpeedPercent(v);
      },
      'settings',
      [PS.t('Slower') + '  -', PS.t('Faster') + '  +'],
      function (v) {
        return PS.t('{p}% ({f} kt forward, {r} kt in reverse)', {
          p: v,
          f: PS.fmt.num((v / 100) * 10 * 0.5925, 1),
          r: PS.fmt.num((v / 100) * 10 * 0.75 * 0.5925, 1)
        });
      }
    );
    var snap = ui.toggle(
      [
        { value: 'on', label: PS.t('Snap on') },
        { value: 'off', label: PS.t('Snap off') }
      ],
      PS.settings.get('snap') ? 'on' : 'off',
      function (v) {
        PS.settings.set('snap', v === 'on');
      }
    );
    var SNAP_STEPS = [10, 20, 30, 50, 75, 100, 150];
    var snapDist = ui.stepper(
      SNAP_STEPS,
      SNAP_STEPS.indexOf(PS.settings.get('snapM')) >= 0 ? PS.settings.get('snapM') : 50,
      function (v) {
        PS.settings.set('snapM', v);
      },
      'settings',
      [PS.t('Closer') + '  -', PS.t('Further') + '  +'],
      function (v) {
        return v + ' m';
      }
    );
    var engines = ui.toggle(
      [
        { value: 'on', label: PS.t('Wait for an engine') },
        { value: 'off', label: PS.t('Dismiss any time') }
      ],
      PS.settings.get('requireEngines') ? 'on' : 'off',
      function (v) {
        PS.settings.set('requireEngines', v === 'on');
      }
    );
    var beacon = ui.toggle(
      [
        { value: 'on', label: PS.t('Wait for the beacon') },
        { value: 'off', label: PS.t('Start without the beacon') }
      ],
      PS.settings.get('requireBeacon') ? 'on' : 'off',
      function (v) {
        PS.settings.set('requireBeacon', v === 'on');
      }
    );
    var turnSpeed = ui.stepper(
      [0, 60, 70, 80, 90, 100],
      PS.settings.get('turnSpeed'),
      function (v) {
        PS.settings.set('turnSpeed', v);
        PS.push.setSpeedPercent(PS.push.getSpeedPercent()); // rebuilds the speed profile of a push under way
      },
      'settings',
      [PS.t('Slower') + '  -', PS.t('Faster') + '  +'],
      function (v) {
        return v ? v + '%' : PS.t('Usual');
      }
    );
    var brakeReq = ui.toggle(
      [
        { value: 'on', label: PS.t('Wait for the parking brake') },
        { value: 'off', label: PS.t('Ignore the parking brake') }
      ],
      PS.settings.get('requireBrake') ? 'on' : 'off',
      function (v) {
        PS.settings.set('requireBrake', v === 'on');
      }
    );
    var uiSize = ui.toggle(
      [
        { value: 'auto', label: PS.t('Automatic') },
        { value: 'normal', label: PS.t('Normal') },
        { value: 'compact', label: PS.t('Compact') }
      ],
      PS.settings.get('uiSize'),
      function (v) {
        PS.settings.set('uiSize', v);
      }
    );
    var rings = ui.toggle(
      [
        { value: 'off', label: PS.t('Rings off') },
        { value: 'on', label: PS.t('Rings on') }
      ],
      PS.settings.get('rings') ? 'on' : 'off',
      function (v) {
        PS.settings.set('rings', v === 'on');
      }
    );
    var tab = ui.toggle(
      [
        { value: 'suggested', label: PS.t('Suggested pushes') },
        { value: 'pins', label: PS.t('Custom pins') }
      ],
      PS.settings.get('planTab'),
      function (v) {
        PS.settings.set('planTab', v);
      }
    );
    // Diagnostics (the checks and the log) stay out of sight until the button is pressed, and fold away again when the tab is left.
    var diag = null,
      diagOpen = false,
      diagHolder = h('div'),
      diagBtn = ui.button(
        PS.t('Diagnostics'),
        function () {
          if (!diag) {
            diag = PS.diagPanel();
            diagHolder.appendChild(diag.el);
          }
          diagOpen = !diagOpen;
          if (diagOpen) diag.show();
          else diag.hide();
          diagBtn.textContent = diagOpen ? PS.t('Hide diagnostics') : PS.t('Diagnostics');
        },
        'ps-small ps-ghost'
      );
    function foldDiag() {
      if (diag) diag.hide();
      diagOpen = false;
      diagBtn.textContent = PS.t('Diagnostics');
    }
    return {
      el: h(
        'div',
        { class: 'ps-page' },
        ui.panel(
          PS.t('Pushing'),
          ui.field(PS.t('Maximum cruise speed'), maxSpeed.el),
          ui.field(PS.t('Speed in turns'), turnSpeed.el),
          ui.note(
            PS.t(
              'How fast the tug goes round a curve, as a percentage of its straight-line speed. Usual slows it more the tighter the curve is. 100% does not slow it for curves at all. It still slows when it is pointing away from the line, and never goes slower than a crawl. If the tug drifts off the line in turns, lower it.'
            )
          ),
          ui.field(PS.t('Before the tug is called'), beacon.el),
          ui.note(
            PS.t(
              'With "Wait for the beacon" the push waits, before it calls the tug, until the beacon is on, as in a real pushback. The FlyByWire wheel chocks brake the aircraft until then. It does not wait if the aircraft\'s beacon cannot be read.'
            )
          ),
          ui.field(PS.t('Parking brake'), brakeReq.el),
          ui.note(
            PS.t(
              'With "Wait for the parking brake" the push waits until the brake is off and stops if it is set during the push. Choose "Ignore the parking brake" for an aircraft whose brake the app cannot read reliably: the push then neither waits for it nor stops for it, so release it yourself.'
            )
          ),
          ui.field(PS.t('Dismissing the tug'), engines.el),
          ui.note(
            PS.t(
              'With "Wait for an engine" the tug is only let go (the Dismiss button and Finish push) after one good engine start, as a real tug operator waits for it. One engine is enough. It applies once the tug has moved the aircraft, and not if the aircraft\'s engines cannot be read.'
            )
          ),
          ui.note(
            PS.t(
              'The most the tug will do on a straight. It chooses its own speed along the route, up to this: slower in curves (more so the tighter they are), slowing in good time before each curve, and easing down to a crawl as it nears the end. Changes apply to a push already under way.'
            )
          )
        ),
        ui.panel(
          PS.t('Planning'),
          ui.field(PS.t('Tightest turn the plan may use'), tightest.el),
          ui.note(
            PS.t(
              'The plan uses a 40 m turn radius. Where a corner is too cramped for that it tries tighter ones, down to this. Smaller means the tug has to turn harder: the Plan tab shows any warning.'
            )
          ),
          ui.field(PS.t('Snap pins to the taxiway'), snap.el),
          ui.note(
            PS.t(
              "With snap on, a pin you drop or move within the snap reach of a taxiway takes the taxiway's heading (the direction needing the smaller turn). Rotating a pin by hand overrides it."
            )
          ),
          ui.field(PS.t('Snap reach (how close to a taxiway a pin must be)'), snapDist.el),
          ui.field(PS.t('Plan tab opens on'), tab.el),
          ui.note(
            PS.t(
              'Which list the Plan tab shows first. It also switches by itself: placing a pin shows the pins, picking a suggestion shows the suggestions.'
            )
          )
        ),
        ui.panel(
          PS.t('Interface size'),
          ui.field(PS.t('Text and spacing'), uiSize.el),
          ui.note(
            PS.t(
              'Compact makes the text and buttons smaller, for a small tablet such as the one on the flight deck. Automatic chooses it when the screen is small.'
            )
          )
        ),
        ui.panel(
          PS.t('Map'),
          ui.field(PS.t('Range rings'), rings.el),
          ui.note(
            PS.t(
              'Circles at a quarter, half, three quarters and the full range of the map. Off by default: a scale bar in the bottom left always shows the distance.'
            )
          )
        ),
        PS.colourPanel(),
        diagHolder,
        h('div', { class: 'ps-btnrow' }, diagBtn)
      ),
      onHide: foldDiag
    };
  }
});
