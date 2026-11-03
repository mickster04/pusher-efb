# App design: Plan and Push tabs

Replaces the spike pages. The spikes are on the `spikes-app` branch; what they proved is in `spike-app.md`, `efb-platform-notes.md` and `wasm-taxi.md`.

## Plan tab (built; browser harness and unit tests only, not yet run in the sim)

- **Plan model** (`src/08-plan.js`, `PS.plan`): the user's pins in the original app's waypoint shape (`id, label, lat, lon, seq, terminal, headingDeg, headingUser, drive, leadInM`). The last pin is the end pin. A pin's heading is Auto (the planner works out the nose it ends with) until the user rotates it, when it becomes a heading the route must arrive along. `evaluate(origin)` plans the route from the aircraft and returns the legs (push back or forward), the line to draw, the nose at each pin, any warnings, and any turnaround pin the planner added. It is cached until the pins or the aircraft change.
- **Planner** (`src/06-route-planner.js`, `PS.planner`): a port of the planner section of the original `apps/windows/src/mapGeo.ts`, which mirrors the bridge's `FilletPath` (turn radius 40 m, arcs between straight legs, a straight start along the aircraft's axis, forward when a leg is within 70 degrees of the nose on the first leg and 90 later, hairpin detection and turnaround pins, `segmentWarning`). `withAutoOrientation` is not ported (the suggester does not use it).
- **Suggester** (`src/07-push-suggest.js`, `PS.suggest`): a port of the original `taxiSuggest.ts`, built on the planner. Checked against the original TypeScript run in Node (`test/tools/make-suggest-golden.mjs` regenerates `test/fixtures/suggest-golden.json`); the option titles agree on the recorded scenarios, with a few equal-cost ties decided differently by float noise. One deliberate difference: the tail-axis hit has a small tolerance, so a line passing exactly through the joint between two taxiway stretches is not lost to rounding.
- **UI** (`src/60-page-plan.js`): canvas plot, directional pins (an aircraft marker rotated to the nose heading) with a selection ring and a draggable heading handle, the route summary and warnings, the suggestion list ("Use as my plan"), the pin list, and the refresh diagnostics panel from the Map spike. Pin drag and tap use mouse events; whether the EFB's touch input produces them is untested.
- **Differences from the original UI:** no first-click-is-last-pin setting (pins are added in order and the last is the end pin); the heading handle is a fixed distance behind the tail on screen, not 22 m on the ground; no lead-in handle yet (`leadInM` is carried but cannot be edited).

## Push tab (next)

- Toggle the tug (attach with `PUSHBACK WAIT` pinned, wait for `PUSHBACK ATTACHED`), then check the parking brake and require it off (brake read and release with per-aircraft LVar probing: requirement B4, B5) before driving.
- Then follow `PS.plan.evaluate(...)`'s route. Start with a simple follower over the planned line (the fillet path) with a speed profile, reusing the proven drive loop in `src/reference/20-page-tug.js`; only port the original's 2,100-line `PushbackController.cs` if that is not good enough in the sim.
- Show remaining distance, pause and resume, stop, and a toast like the old app's (distance left with Pause/Resume). Stop at once when the sim detaches the tug.
