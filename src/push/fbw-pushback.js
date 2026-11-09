// FlyByWire aircraft (the A32NX family, and Headwind's A330 which is built on it) have a pushback system of their own in the flyPad. While it is switched on
// it keeps its own hold on the aircraft's movement, so the velocity our tug writes is overridden and the aircraft stays where it is (the push stops with
// "not moving along the path"). L:A32NX_PUSHBACK_SYSTEM_ENABLED is the variable FlyByWire documents for add-ons to switch it off. We switch it off while
// our tug is on and put it back as it was when the tug is gone. An aircraft without the variable reads 0 or nothing and is left alone.

PS.fbwPush = (function () {
  var NAME = 'L:A32NX_PUSHBACK_SYSTEM_ENABLED';
  var saved = null; // the value it had when we switched it off (1), until we put it back
  var holding = false; // logged already for this time it was found on

  return {
    // Switch it off if it is on (called when a push starts and again while the tug is on, in case the pilot turns it back on).
    hold: function () {
      var r = PS.getVar(NAME, 'number');
      if (!r.ok || typeof r.value !== 'number' || r.value < 0.5) {
        holding = false;
        return;
      }
      var w = PS.setVar(NAME, 'number', 0);
      if (saved === null) saved = r.value;
      if (!holding) PS.log('push', 'the aircraft\'s own pushback system (' + NAME.replace(/^L:/, '') + ') was on: switched off while our tug is on' + (w.ok ? '' : ' (the write failed)'));
      holding = true;
    },
    // Put it back as it was.
    restore: function () {
      if (saved === null) return;
      PS.setVar(NAME, 'number', saved);
      PS.log('push', 'the aircraft\'s own pushback system switched back on');
      saved = null;
      holding = false;
    }
  };
})();
