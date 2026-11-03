# Spike app design

A single EFB app, internal name `PusherSpikes`, whose pages are the feasibility spikes from `docs/efb-requirements.md`. Its job is to give answers from inside the sim, not to be the product. When a spike is settled, record the result in the table at the end of this file.

## Structure

- `src/*.js` are concatenated by `build.mjs` (in filename order) into `PackageSources/PusherSpikes/PusherSpikes.js`, wrapped in one IIFE. Modules share one object, `PS`.
- `src/styles.css` is inlined into the bundle and injected as a `<style>` element. All class names start with `ps-`.
- Pure helpers (formatting, geometry, taxiway extraction) must not touch the DOM at load time, so `test/` can load the built file in node.
- Pages are objects `{ id, title, create(ctx) }` pushed onto `PS.pages`; `create` returns `{ el, onShow(), onHide() }`. Each page owns its timers: it starts them in `onShow` and stops them in `onHide`. The shell shows one page at a time and keeps built pages alive.
- Page 1 deliberately stops its poll timer when hidden, so the separate heartbeat timer (`PS.hb`, started by the view) is what measures ticking while the app is paused.
- Anything that moves the aircraft registers a stop function in `PS.closeHooks`; the view runs these on pause, close and destroy.
- Shared state for the map page: `PS.state.taxi` (set by page 3 or loaded by the map itself), `PS.state.contacts` (simulated contacts from page 4) and `PS.state.pins` (the pins on the plot). The plot reads real AI traffic straight from `PS.airTraffic` on every redraw rather than from `PS.state.contacts`, which went stale.
- `harness/` serves a browser mock of the EFB (`EFB_API`, `msfssdk`, `SimVar`, `Coherent`) so the UI can be reviewed on a Mac. A page working in the harness says nothing about the sim.

## Pages

| # | Page | Question it answers | Notes |
|---|---|---|---|
| 1 | Telemetry | Which SimVars, LVars and strings can an EFB app read, at what rate, and does anything keep ticking while the app is hidden? | Table of polled variables with live values; an input row to add any variable name and unit, read it, and try to set it. Heartbeat counters (own timer, `onUpdate`) with ticks-while-paused. |
| 2 | Tug | Can the tug be driven from JS, either by per-tick velocity writes or by native tug events? | Toggle between Direct and Native modes. Direct mode writes `PUSHBACK WAIT`, `VELOCITY BODY Z`, `ROTATION VELOCITY BODY Y` on a timer and reports the measured write rate and whether the readback changed. Native mode sends `TOGGLE_PUSHBACK`, `KEY_TUG_HEADING`, hold/go. Both have a hard run-time limit and a stop button. |
| 3 | Taxiways | Can taxiway data be read from JS? | ICAO input, tries the facility APIs, extracts named taxiways, runways and parking, shows name, category, length, width, and distance and bearing from the aircraft. Raw dump of what came back. Offline sample button for UI review. |
| 4 | Traffic | Can AI aircraft be listed from JS? | Discovery of candidate APIs (names found on `window` and `msfssdk`), a contacts table (distance, bearing, altitude, ground speed, heading, closing speed, time to closest approach) fed by whatever source is found, and a simulated-contacts button for UI review. |
| 5 | Notifications | What in-tablet popups can carry action buttons, and does the EFB's notification manager help? | In-app toast host with the original toast kinds (release brake, set brake with Dismiss tug and Return to gate, distance left with Pause/Resume, traffic hold with Ignore). Probe of `props.notificationManager` methods with buttons to try candidate calls. |
| 6 | Map | Can the sim's built-in map be used, and with overlays? What can a tile-less plot do? | The plot is the main view: own aircraft, range rings, runways, named taxiways, parking, AI traffic, pins (tap to add, drag to move, `PS.state.pins`) and suggested pushes (`src/07-push-suggest.js`). The built-in Bing map and its probes sit below it and are mounted only on request. |

## Safety rules for page 2

- Writing tug velocity moves the aircraft. Direct mode has a maximum run time (default 10 s, shown on screen), zero-writes on stop, on page hide and on view close, and a visible armed indicator.
- Only run it parked on the ground with the brake handling understood. State this on the page.

## Reporting results

Each page has a results log (timestamped lines, copyable). After a sim session, paste the logs back into the conversation and record outcomes below.

## Spike results (fill in)

| Spike | Result | Date | Notes |
|---|---|---|---|
| 0 App loads in EFB | Works | 2026-11-02 | Plain-JS pattern with `window.EFB_API` / `window.msfssdk` registers and renders. |
| 1 Telemetry | Pass | 2026-11-02 | All 24 default variables read with no errors, about 0.1 ms per cycle. Hidden for 67 s: 130 timer ticks (about 134 expected) and 958 browser animation frames, but **0 `onUpdate` calls**. So `setInterval` keeps running while the app is hidden, `onUpdate` runs only while visible (7788 calls over the session), and animation frames continue at a reduced rate. Hooks seen: onOpen, onResume, onUpdate, onPause. Use `setInterval` for anything that must run hidden. |
| 2 Tug, direct | Works: pushes back and turns | 2026-11-02 | Stock A320 spun a lot when given raw values (-2 and -0.5 written unscaled, which is about 40 times too strong), so **the rotation write works**; heading moved 130 to 198 degrees. Earlier "no turning" was a too-weak command plus the loop reading speed and turn only once at Start (live changes did nothing). Fixed: values are read every tick with a speed and turn ramp. Loop rate: requested 20 ms gave a mean of 33 ms (about 30 Hz); requested 50 ms gave about 60 ms. Velocity readback tracks the command within the spin. Still to calibrate: measured deg/s against commanded deg/s per unit (rad/s, deg/s, ft/s hack). |
| 2 Tug, native | Dropped | 2026-11-02 | Owner dropped it: direct mode works. Its buttons also showed squares (the sim font lacks the arrow glyphs). Mode removed from the app. |
| 3 Taxiways | Nearest airport works; taxi paths no | 2026-11-02 | Nearest search found NZCH 220 m away from six airports within 30 km. Airport facility load works (ICAO spelled `"A      NZCH "` as returned by the search) but gives 3 runways and no taxi paths or parking. Decision (2026-11-02): taxi paths will come from a standalone WASM module (`wasm/`, see `wasm-taxi.md`). Core and client are tested on the host; the module has not been built or run in the sim. |
| 4 Traffic | Works | 2026-11-02 | `JS_LISTENER_AIR_TRAFFIC` was ready immediately; `GET_AIR_TRAFFIC` returned entries like `{__Type:"JS_NPCPlane", name, plane_model_icao, uId, lat, lon, alt (metres), heading, isOnGround}`. Speed is derived from positions. |
| 5 Notifications | Pass for in-tablet toasts; EFB manager unknown | 2026-11-02 | Toasts and their action buttons work. `notificationManager` has 21 members, including `addNotification`, `clearNotifications`, `deletePermanentNotification`, `onNotificationAppOpen/Closed`, `onShownNotifsUpdate`, `onStoredNotifsUpdate`. `addNotification({title,message,description,body})` did not throw; whether anything appeared on the tablet is not yet reported, and the argument shape is unknown. The probe now logs the method source. |
| 6 Map | Bing map works; showed a blurry blob | 2026-11-02 | With earth colours the map is bound, awake and shows an image (`coui://html_ui/efb_ui/efb_os/JS_BINGMAP_<id>_1`). It was a blurry green/blue blob because it was zoomed to 500 m in PLANE mode. `EBingMode` has CURSOR, PLANE, VFR, HORIZON, TOPVIEW; VFR is probably the detailed map. `EFB_API` members: `apps`, `bus`, `loadCss`, `loadJs`, `use`, `notificationManager`, `onboardingManager`, `unitsSettingManager`, `efbSettingsManager`, etc. The page now offers mode (VFR default) and range choices. |


## Map page: plot, pins and suggested pushes (3 Nov 2026, browser harness only)

Reworked after the sim showed the built-in map was not useful but the plot was. **None of this has run in the sim yet**; it was checked in the browser harness (zoom, pin add and drag, suggestions, moving mock traffic) and by unit tests (`test/suggest.test.mjs`).

- **Range buttons.** The old range control was a `ui.select` button group and did not work in the sim. It is replaced by `PS.ui.stepper`: "Zoom in -" / "Zoom out +" over 100 m to 3 km, which does not rely on highlight state. Every press is logged on the `map` channel (`range button pressed (zoom in): 500 m -> 300 m`). If the sim log has no such lines after pressing the buttons, the presses are not reaching the page; if it has them and the plot does not change, the redraw is at fault.
- **Traffic not updating.** The plot used `PS.state.contacts` first, which the Traffic page sets and which stayed at whatever it last held. It now polls `PS.airTraffic` on every redraw (every 500 ms) and shows when the listener last answered and how many replies it has given. `PS.state.contacts` is used only for simulated contacts.
- **Pins.** Pin mode on: tap the plot to drop a pin, drag a pin to move it. Pin mode off: tap an aircraft for its details. Pins are drawn joined from the aircraft in order, listed with leg distance and bearing, with Undo, Clear and per-pin Delete. They are in memory only (no plan saving: priority Could).
- **Suggested pushes.** A simplified port of `apps/windows/src/taxiSuggest.ts`. Offered: straight back to the nearest named taxiways, links and lanes the tail line reaches (nose unchanged), and back then along a taxiway either way to 60 m and 110 m, following bends. A suggestion can be shown on the plot (route, end point and the nose direction the push ends with) and copied into pins with "Use as pins". **Not ported:** the tug path planner (`plannedRouteSegments`, `withTurnaroundPin`, `segmentWarning` in the original `mapGeo`), so there is no check that the tug can make a turn beyond "not sharper than 110 degrees at the taxiway", no turnaround pins, no compass-pointing options, no opposite-direction option that needs a turnaround, and no stand-connector fallback for airports without named taxiways. Closing that gap needs the planner ported (feasibility item for requirement E).
- **Data it relies on.** Taxiway items now keep the sim's `rawType` (1 taxi, 4 path) and `rawName`; the suggester ignores runways (2), parking connectors (3) and anything else.
- **Open.** Whether the zoom buttons work in the sim; whether mouse events (used for pin tap and drag) arrive from the EFB's touch input; suggestion quality at real airports (NZCH is the test case); redraw cost at 850 path items every 500 ms.
