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
    var langOptions = [{ value: 'auto', label: PS.t('Automatic') }].concat(
      PS.LANGS.map(function (l) {
        return { value: l.code, label: l.label }; // each language by its own name, whatever the current one is
      })
    );
    var simLine = h('div', { class: 'ps-kv', text: '' }); // what the sim's own translation gave (English: it is for finding out, not for pilots)
    var language = ui.toggle(langOptions, PS.settings.get('lang'), function (v) {
      PS.settings.set('lang', v);
      PS.log('settings', 'language set to ' + v + ' (the browser reports ' + (PS.i18n.browserTag() || 'nothing') + ')');
      PS.applyLanguage();
    });
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
          PS.t('Language'),
          ui.field(PS.t('Language'), language.el),
          simLine,
          ui.note(
            PS.t(
              "Automatic uses the sim's own translations when it provides them, otherwise the language the browser reports, and English if it is not one of these. A text with no translation shows in English."
            )
          )
        ),
        ui.panel(
          PS.t('Pushing'),
          ui.field(PS.t('Maximum cruise speed'), maxSpeed.el),
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
      onShow: function () {
        simLine.textContent = 'Sim translation: ' + PS.simT.status();
      },
      onHide: foldDiag
    };
  }
});
