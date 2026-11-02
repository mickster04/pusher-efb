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
| 0 App loads in EFB | Works | 2026-11-02 | Plain-JS pattern with `window.EFB_API` / `window.msfssdk` registers and renders. |
| 1 Telemetry | Pass | 2026-11-02 | All 24 default variables read with no errors, about 0.1 ms per cycle. Hidden for 67 s: 130 timer ticks (about 134 expected) and 958 browser animation frames, but **0 `onUpdate` calls**. So `setInterval` keeps running while the app is hidden, `onUpdate` runs only while visible (7788 calls over the session), and animation frames continue at a reduced rate. Hooks seen: onOpen, onResume, onUpdate, onPause. Use `setInterval` for anything that must run hidden. |
| 2 Tug, direct | Inconclusive: tug was never attached | 2026-11-02 | In the log `PUSHBACK ATTACHED` was 0 and `PUSHBACK STATE` 3 throughout, and no `TOGGLE_PUSHBACK` was sent that session, so velocity writes pushed a free aircraft (it appeared to lift rather than push back). Writes are accepted (0 failed ticks, about 16 Hz) but VEL Z read back at about 55-75% of the command. The rotation-unit dropdown could not be changed in the EFB. Aircraft was a Fenix A320 (may have its own pushback system). Retest with the tug attached: the page now has an attach sequence and refuses to drive without a tug. |
| 2 Tug, native | Dropped | 2026-11-02 | Owner dropped it: direct mode works. Its buttons also showed squares (the sim font lacks the arrow glyphs). Mode removed from the app. |
| 3 Taxiways | Airport data yes, taxi paths no | 2026-11-02 | `msfssdk.FacilityLoader` works from the EFB with the ICAO spelled `"A      " + ident` (the bare ident was rejected first). For NZCH it returned 3 runways and no taxiway or parking data. Taxi paths need another route (WASM module or bundled data). |
| 4 Traffic | Source found in the SDK source, untested | 2026-11-02 | Discovery found `msfssdk.TrafficInstrument`, `Tcas` and related. Reading the sdk source: AI traffic comes from `RegisterViewListener("JS_LISTENER_AIR_TRAFFIC")` then `listener.call("GET_AIR_TRAFFIC")`, returning `{uId, name, lat, lon, alt (metres), heading}`. The page now polls that once a second and works out speed from successive positions. |
| 5 Notifications | Pass for in-tablet toasts; EFB manager unknown | 2026-11-02 | Toasts and their action buttons work. `notificationManager` has 21 members, including `addNotification`, `clearNotifications`, `deletePermanentNotification`, `onNotificationAppOpen/Closed`, `onShownNotifsUpdate`, `onStoredNotifsUpdate`. `addNotification({title,message,description,body})` did not throw; whether anything appeared on the tablet is not yet reported, and the argument shape is unknown. The probe now logs the method source. |
| 6 Map | Black because earth colours default to black; fix untested | 2026-11-02 | `<bing-map>` registered, `BingComponent` mounted and woke. The sdk source says earth colours default to black, which explains the black square. The mount now supplies water and terrain colours and logs bound/awake state and the img source. Wanted: the detailed map from the EFB flight planner; the probe now logs `EFB_API` members and all map-related `msfssdk` names to look for it. |
