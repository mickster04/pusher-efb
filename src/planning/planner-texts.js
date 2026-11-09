// The sentences the planner, the suggester and the path follower build from pieces and numbers, as patterns for the translation (see core/i18n.js).
// Those modules keep writing English (their logs and logic depend on it); the Plan and Push tabs translate what they show with PS.t(text), which
// matches the sentence against these. {x} is a piece, [ ... ] an optional part. When a sentence in those modules changes, change its pattern here:
// the tests build real suggestions and routes and fail when a sentence has no pattern.

PS.tt('and');
// compass words and group names (the pieces of the titles)
PS.tt('north');
PS.tt('north-east');
PS.tt('east');
PS.tt('south-east');
PS.tt('south');
PS.tt('south-west');
PS.tt('west');
PS.tt('north-west');
PS.tt('Apron lane');
PS.tt('the apron lane');
PS.tp('Taxiway {name}');
PS.tp('taxiway {name}');
PS.tt('push back');
PS.tt('drive forward');
PS.tt('forward');
PS.tp('{n} kt');

// suggestion titles
PS.tt('Straight back to the apron lane');
PS.tp('Straight back to taxiway {name}');
PS.tp('Straight back to {name}');
PS.tp('{g}, facing {dir}[, clear of {x}][ (tight)]');
PS.tp('{g}, pointing {dir}');
PS.tt('Straight back to the end of the stand connector');
PS.tp('End of the stand connector, facing {dir}');

// suggestion details. The clauses that end several of them are texts of their own, translated once.
PS.tt(', with a turnaround pin to get lined up');
PS.tt(', curving in to line up');
PS.tp('the nose stays {h} deg');
PS.tp('heading {h} deg[{lineup}]');
PS.tp('{m} m straight back; {tail}');
PS.tp(
  "{m} m: straight back to {w}, then {d} m along it[ (round its bend)][ (round its bends)][, ending beyond {x} so the link isn't blocked]; ends facing {h} deg"
);
PS.tp(
  '{m} m of push; ends on the centreline heading {h} deg along it[{lineup}][. The tug may not manage this one: no cleaner end point found]'
);
PS.tp('{m} m: back to {w}, ending on it turned to point {dir} ({off} deg from the nose)[, with a turnaround pin]');
PS.tp("{m} m of push to where the stand's lead-in meets the taxiway (no named taxiway here, so this is a guess); {tail}");
PS.tp('. Tightest arc {r} m (tug turns at {t} m)');

// route warnings
PS.tp('Leg {i}: {w}');
PS.tp(
  'The tug may not be able to make this {kind} manoeuvre: {why}. Move a pin further away, or shorten the final straight with the heading handle.'
);
PS.tp('its tightest turn is about {r} m radius, but the tug needs {n} m');
PS.tp('its path turns {deg} deg in total, which is a loop');
PS.tp('it starts {deg} deg away from the way the aircraft is pointing');

// what the path follower says it is doing (the Push tab's progress lines)
PS.tp('straight: top speed {v}');
PS.tp('in a curve (radius {r} m): {v}');
PS.tp('{state} for the curve in {n} m: {v}');
PS.tp('{state} ({n} m to go): {v}');
PS.tp('off the path by {x} m: slowed');
PS.tt('slowing');
PS.tt('speeding up');
PS.tt('slowing for the stop');
PS.tt('steering at its limit (the path needs a tighter turn than the tug can make at this speed)');
PS.tp('next leg: {dir}');
PS.tp('end of leg {n}: stopping to change direction');
