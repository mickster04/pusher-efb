# Spike app design

A single EFB app, internal name `PusherSpikes`, whose pages are the feasibility spikes from `docs/efb-requirements.md`. Its job is to give answers from inside the sim, not to be the product. When a spike is settled, record the result in the table at the end of this file.

## Structure

- `src/*.js` are concatenated by `build.mjs` (in filename order) into `PackageSources/PusherSpikes/PusherSpikes.js`, wrapped in one IIFE. Modules share one object, `PS`.
- `src/styles.css` is inlined into the bundle and injected as a `<style>` element. All class names start with `ps-`.
- Pure helpers (formatting, geometry, taxiway extraction) must not touch the DOM at load time, so `test/` can load the built file in node.
- Pages are objects `{ id, title, create(ctx) }` pushed onto `PS.pages`; `create` returns `{ el, onShow(), onHide() }`. Each page owns its timers: it starts them in `onShow` and stops them in `onHide`. The shell shows one page at a time and keeps built pages alive.
- Page 1 deliberately stops its poll timer when hidden, so the separate heartbeat timer (`PS.hb`, started by the view) is what measures ticking while the app is paused.
- Anything that moves the aircraft registers a stop function in `PS.closeHooks`; the view runs these on pause, close and destroy.
- Shared state for the map page: `PS.state.taxi` (set by page 3) and `PS.state.contacts` (set by page 4).
- `harness/` serves a browser mock of the EFB (`EFB_API`, `msfssdk`, `SimVar`, `Coherent`) so the UI can be reviewed on a Mac. A page working in the harness says nothing about the sim.

## Pages

| # | Page | Question it answers | Notes |
|---|---|---|---|
| 1 | Telemetry | Which SimVars, LVars and strings can an EFB app read, at what rate, and does anything keep ticking while the app is hidden? | Table of polled variables with live values; an input row to add any variable name and unit, read it, and try to set it. Heartbeat counters (own timer, `onUpdate`) with ticks-while-paused. |
| 2 | Tug | Can the tug be driven from JS, either by per-tick velocity writes or by native tug events? | Toggle between Direct and Native modes. Direct mode writes `PUSHBACK WAIT`, `VELOCITY BODY Z`, `ROTATION VELOCITY BODY Y` on a timer and reports the measured write rate and whether the readback changed. Native mode sends `TOGGLE_PUSHBACK`, `KEY_TUG_HEADING`, hold/go. Both have a hard run-time limit and a stop button. |
| 3 | Taxiways | Can taxiway data be read from JS? | ICAO input, tries the facility APIs, extracts named taxiways, runways and parking, shows name, category, length, width, and distance and bearing from the aircraft. Raw dump of what came back. Offline sample button for UI review. |
| 4 | Traffic | Can AI aircraft be listed from JS? | Discovery of candidate APIs (names found on `window` and `msfssdk`), a contacts table (distance, bearing, altitude, ground speed, heading, closing speed, time to closest approach) fed by whatever source is found, and a simulated-contacts button for UI review. |
| 5 | Notifications | What in-tablet popups can carry action buttons, and does the EFB's notification manager help? | In-app toast host with the original toast kinds (release brake, set brake with Dismiss tug and Return to gate, distance left with Pause/Resume, traffic hold with Ignore). Probe of `props.notificationManager` methods with buttons to try candidate calls. |
| 6 | Map | Can the sim's built-in map be used, and with overlays? | Probes for map elements and `msfssdk` map classes, attempts to mount one, and shows a tile-less canvas plot (own aircraft, range rings, taxiways, traffic) as a baseline. |

## Safety rules for page 2

- Writing tug velocity moves the aircraft. Direct mode has a maximum run time (default 10 s, shown on screen), zero-writes on stop, on page hide and on view close, and a visible armed indicator.
- Only run it parked on the ground with the brake handling understood. State this on the page.

## Reporting results

Each page has a results log (timestamped lines, copyable). After a sim session, paste the logs back into the conversation and record outcomes below.

## Spike results (fill in)

| Spike | Result | Date | Notes |
|---|---|---|---|
| 1 Telemetry | not run | | |
| 2 Tug, direct | not run | | |
| 2 Tug, native | not run | | |
| 3 Taxiways | not run | | |
| 4 Traffic | not run | | |
| 5 Notifications | not run | | |
| 6 Map | not run | | |
