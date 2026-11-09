// What is known about how particular aircraft respond to the tug, so a push starts with the right numbers instead of learning them mid-push.
// An aircraft with no entry still works: the follower learns the pivot while it drives (follow.js), and the value it learned is logged at the end
// of every push so it can be added here. Every entry says where its numbers came from.
//   pivotM  : how far ahead of the point the aircraft turns about the sim's reported position is (metres, along the nose; negative = behind)
//   brakeLvar : the L variable that holds the parking brake lever, for an aircraft that leaves BRAKE PARKING POSITION at 0
//   yawGain : degrees per second the nose turns per unit of commanded turn (the default, from the Fenix A320, is in follow.js)

PS.profiles = (function () {
  var LIST = [
    {
      id: 'a330',
      name: 'Airbus A330 family',
      match: /A33[0-9]/i,
      pivotM: 10,
      yawGain: 3.2,
      brakeLvar: 'L:A32NX_PARK_BRAKE_LEVER_POS', // read live from this aircraft: 1 with the lever set
      source:
        'fitted from one logged reverse push, 2026-11-08 (A330-900neo): the pivot predicted the logged cross-track error to 0.6 m rms (7 m without it); gain from measured turn rate against command'
    }
  ];

  // The profile for an aircraft ({ title, model, type } as from PS.aircraftInfo), or null.
  function find(info) {
    if (!info) return null;
    var text = [info.title, info.model, info.type].join(' ');
    for (var i = 0; i < LIST.length; i++) if (LIST[i].match.test(text)) return LIST[i];
    return null;
  }

  // How near a stand's marker the sim's reported position counts as "at the gate". A wide-body's reported position is further from the marker than a
  // narrow-body's (an A330 read 20 m at Gate 30, an A320 12 m at Gate 31), so wide-bodies get more. Matched on the title/model/type text.
  var WIDEBODY = /A3[3-5][0-9]|A38[0-9]|A300|A310|(^|[^0-9])7[4678]7([^0-9]|$)|MD-?11|DC-?10|L-?1011|IL-?96/i;
  function gateNearM(info) {
    if (!info) return 15;
    var text = [info.title, info.model, info.type].join(' ');
    return WIDEBODY.test(text) ? 25 : 15;
  }

  return { find: find, list: LIST, gateNearM: gateNearM };
})();
