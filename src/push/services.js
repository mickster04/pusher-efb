// Ground services by key event: the jet bridge, fuel, baggage, catering and ground power. The names are the ones the original app and Pushback Helper use.
// The sim does not report whether any of them happened, so all this knows is that a request was sent (and when).

PS.services = (function () {
  var LIST = [
    { id: 'jetbridge', label: PS.tt('Jet bridge'), icon: 'jetbridge', event: 'TOGGLE_JETWAY', done: 'Jet bridge toggled' },
    { id: 'fuel', label: PS.tt('Fuel'), icon: 'fuel', event: 'REQUEST_FUEL_KEY', done: 'Fuel truck requested' },
    { id: 'baggage', label: PS.tt('Baggage'), icon: 'baggage', event: 'REQUEST_LUGGAGE', done: 'Baggage requested' },
    { id: 'catering', label: PS.tt('Catering'), icon: 'catering', event: 'REQUEST_CATERING', done: 'Catering requested' },
    { id: 'power', label: PS.tt('Ground power'), icon: 'power', event: 'REQUEST_POWER_SUPPLY', done: 'Ground power requested' }
  ];
  var SHOW_MS = 20000; // a button stays marked "requested" this long
  var MOVING_KT = 3;
  var asked = {}; // id -> { at, ok, error }

  function byId(id) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === id) return LIST[i];
    }
    return null;
  }

  // Services only make sense parked: on the ground, not moving, and no push under way.
  function can() {
    var v = PS.push && PS.push.view ? PS.push.view() : null;
    if (v && { attaching: 1, waitBrake: 1, settling: 1, driving: 1, stopping: 1, paused: 1, brakeHold: 1 }[v.status])
      return { ok: false, why: PS.tt('Not while a push is under way.') };
    var g = PS.getVar('SIM ON GROUND', 'bool');
    if (g.ok && !(Number(g.value) > 0)) return { ok: false, why: PS.tt('The aircraft is not on the ground.') };
    var gs = PS.getVar('GROUND VELOCITY', 'knots');
    if (gs.ok && typeof gs.value === 'number' && gs.value > MOVING_KT) return { ok: false, why: PS.tt('The aircraft is moving.') };
    return { ok: true, why: '' };
  }

  function request(id) {
    var s = byId(id);
    if (!s) return { ok: false, error: 'unknown service ' + id };
    var c = can();
    if (!c.ok) {
      PS.log('services', s.label + ' not sent: ' + c.why);
      return { ok: false, error: c.why };
    }
    var r = PS.keyEvent(s.event, 0, 'simvar');
    asked[id] = { at: Date.now(), ok: !!r.ok, error: r.ok ? '' : r.error || 'failed' };
    PS.log('services', s.label + ' (' + s.event + ') ' + (r.ok ? 'sent' : 'FAILED: ' + asked[id].error));
    if (r.ok && PS.toasts)
      PS.toasts.show({
        kind: 'info',
        title: s.done,
        message: 'The sim does not say whether it happened: look at the aircraft.',
        ttlMs: 4000
      });
    return r;
  }
  // Was this one asked for in the last few seconds? (for marking its button)
  function recently(id) {
    return !!asked[id] && asked[id].ok && Date.now() - asked[id].at < SHOW_MS;
  }

  return {
    LIST: LIST,
    byId: byId,
    can: can,
    request: request,
    recently: recently,
    state: function () {
      return asked;
    }
  };
})();
