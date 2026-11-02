# Pusher for the MSFS 2024 EFB: requirements and feasibility

Status: draft. Requirements are extracted from the current Pusher code (bridge C#, Electron/React app, `packages/shared/api/types.ts`). The repo has no other spec.
Feasibility ratings come from the MSFS 2024 SDK docs and forum posts found so far. Anything marked **Unverified** needs a spike before it is relied on.

Priority is MoSCoW (Must, Should, Could), set by the product owner. Ratings: **G** = should port directly, **A** = port with changes or a workaround, **R** = high risk or unknown, **X** = drop or replace.

## 1. Scope

A standalone EFB app for MSFS 2024 only. It installs as a sim package, with no companion exe, no Electron and no localhost bridge.
MSFS 2020 support is out of scope, so there is no sim detection. That removes the `sim` / `simProcess` handling.

### Decisions recorded with the priorities

- **B2 (per-tick velocity driving) is Should, with a fallback.** If it can't be done, the tug is steered with basic left/right commands and speed curves, giving less graceful calculated paths. Manual pushback (C, Must) is built on that fallback if needed.
- **I1 (prompts) is Should.** The first build keeps the actions inside the tablet UI. Popups that reach a pilot looking away from the tablet come later.
- **H1: try the sim's built-in map instead of OSM.** **Unverified** whether an EFB app can use it, and whether it can draw our overlays and take pin placement.
- **H2 is a redesign from scratch for the EFB.** **H3 (tabs) is open:** the EFB's own navigation may make them unnecessary. Review later.
- **J (settings and persistence) is Could.**

### Open points from the priorities

1. **C (Must) depends on B2 (Should).** Manual forward/reverse/steer needs some way to move the tug. Either B2 works, or the fallback above (the sim's own tug heading and speed events) must be proven. Treat the fallback as part of the Must scope, not an extra.
2. **Nearest airport is no longer a Must (A3 split into A3a and A3b).** "At gate" turned out to need no airport data. Nearest airport is only used to choose which airport's taxiways to load (E), to label saved plans (D6) and to display. It moves with E. If the facility API turns out to report the current airport itself, the bundled 6.6 MB airport list isn't needed at all.
3. **H1 (Must) includes click-to-place pins and heading handles, but D (Should) is what uses them.** Suggest the Must part of H1 is the map with the live aircraft marker, and pin editing lands with D.
4. **D6 (Could) means plans may not be saved at first.** A route is built and used in one session.

## 2. Functional requirements extracted from the current app

### A. Sim state

| ID | Priority | Requirement | Current source | EFB |
|---|---|---|---|---|
| A1 | **Must** | Read position, heading, ground speed, IAS, VS, AGL, on-ground, engines running, parking brake, pushback attached | `SimService.cs`, `LiveTelemetry` | **G**, `SimVar.GetSimVarValue` |
| A2 | **Must** | Read aircraft title, ICAO model, airline, flight number | `SimService.cs` | **G** (string vars: check unit handling) |
| A3a | **Must** | Detect "at gate": on the ground, slow, no tug attached | `IsAtGate` in `Program.cs` | **G**, telemetry only, no airport data |
| A3b | **Could** | Nearest airport (only needed to pick which airport's taxiways to load for E, to label saved plans for D6, and to show on the Home tab) | `AirportDb.cs`, `/api/airports/nearest` | **A**, needs a bundled airport list or the facility API. Drop if E is dropped |
| A4 | **Must** | Camera state (hide or show UI, pause toasts) | `SimService.cs` | **G**, read only |

### B. Tug and pushback core

| ID | Priority | Requirement | Current source | EFB |
|---|---|---|---|---|
| B1 | **Must** | Call and attach the tug (`TOGGLE_PUSHBACK`), hold `PUSHBACK WAIT` | `SimEventService.cs`, `TugDrive.cs` | **A**, key events exist via `Coherent.call("TRIGGER_KEY_EVENT")`. Event mapping needs testing |
| B2 | **Should** | Drive the tug by writing `VELOCITY BODY Z` and `ROTATION VELOCITY BODY Y` every tick, because velocity is not sticky | `TugDrive.cs` | **R**, see risk 1 |
| B3 | **Must** | Stop at once when the sim detaches the tug | commit `05ef7c5` | **A**, needs a reliable `PUSHBACK ATTACHED` poll |
| B4 | **Must** | Parking brake: read, set and release, with per-aircraft LVar probing (A32NX, B21 and others) | `Constants.cs` `BrakeLvars`, `SimService.cs` | **A**, LVars are easier from JS, but `BRAKE PARKING POSITION` may be read-only |
| B5 | **Must** | Wait for brake release before driving (latched drive command) | `waitingForBrake` | **G** logic |
| B6 | **Must** | Steering and tiller: reset the aircraft tiller LVars while driven | `TugDrive.cs` `TillerLvars` | **A** |
| B7 | **Must** | Yaw calibration learned during the push (`measured = gain × commanded + offset` per direction and side) | `YawCalibration.cs` | **G** logic, pure maths |

### C. Manual pushback

| ID | Priority | Requirement | EFB |
|---|---|---|---|
| C1 | **Must** | Forward, reverse and stop commands | **G** logic (depends on B2) |
| C2 | **Must** | Steer tap steps and a set rudder rate (°/s) | **G** logic |
| C3 | **Must** | Speed percent setting (manual, 10–100) | **G** |

### D. Auto pushback

| ID | Priority | Requirement | Current source | EFB |
|---|---|---|---|---|
| D1 | **Should** | Waypoint route: pins with optional heading, lead-in length, forward/reverse/auto, terminal flag | `Waypoint` type | **G** data model |
| D2 | **Should** | Path-following controller: curves, cusp and flip handling, lead-in lines, end-pin creep with timeout | `PushbackController.cs` (~2,100 lines) | **A**, pure logic but the biggest port. Runs at a 20 ms tick today (see risk 2) |
| D3 | **Should** | Auto speed: slow in turns, crawl onto the stand | `speedAuto` | **G** logic |
| D4 | **Should** | Pause and resume, stop, distance left | `/api/pushback/pause-toggle` | **G** |
| D5 | **Should** | Return to gate | `/api/ui/return-to-gate` | **G** logic |
| D6 | **Could** | Save, load, name and delete plans per airport | `PlanStore.cs` | **A**, storage changes (section 4) |

### E. Taxiway-aware planning

| ID | Priority | Requirement | Current source | EFB |
|---|---|---|---|---|
| E1 | **Could** | Read taxiway centrelines, runways and parking spots for the current airport from the sim | `TaxiwayService.cs` | **R**, **Unverified**: no facility-data docs found for EFB apps. See risk 3 |
| E2 | **Could** | Overlay taxiways on the map | `taxiwayOverlay.ts` | **G** if E1 works |
| E3 | **Could** | Suggest pushbacks: named taxiway, LINK, lane, compass-pointing, opposite direction, straight back, follow bends | `taxiSuggest.ts` (737 lines, pure TS) | **G**, reusable as is |
| E4 | **Could** | Detect the current stand | `currentStand` | **G** if E1 works |

### F. Traffic watch

| ID | Priority | Requirement | EFB |
|---|---|---|---|
| F1 | **Could** | Poll AI aircraft within a radius once a second, pause the push if one is ahead on the route, allow "ignore" | **R**, **Unverified**: needs a SimObject-by-type request from the EFB environment. See risk 3 |

### G. Ground services

| ID | Priority | Requirement | EFB |
|---|---|---|---|
| G1 | **Must** | Jet bridge attach and detach (`TOGGLE_JETWAY`) | **A**, key event |
| G2 | **Must** | Request fuel, baggage, catering, boarding | **A**, key events, per-aircraft behaviour untested |

### H. Map and UI

| ID | Priority | Requirement | Current source | EFB |
|---|---|---|---|---|
| H1 | **Must** | Airport map with click-to-place pins, draggable heading handles, live aircraft marker | `MapView.tsx`, `MiniMap.tsx` | **A**, Leaflet should run, but OSM tiles need a network. See risk 4 |
| H2 | **Should** | Compact phone-size layout plus a full-screen map | `PhoneView.tsx` | **A**, redesign for the EFB frame and touch |
| H3 | **Review** | Home, Pushback, Services, Settings and Credits tabs | `*Tab.tsx` | **G** |

### I. Notifications

| ID | Priority | Requirement | EFB |
|---|---|---|---|
| I1 | **Should** | Prompts: release brake, set brake, distance left, pause or resume, traffic hold | **R**: today these are always-on-top OS toasts. The EFB is only visible while open. See risk 5 |

### J. Settings and persistence (**Could**)

Settings to keep: pilot name, manual and auto speed percent, rudder rate, `firstClickIsLastPin`, `pushbackSpeedAuto`, `autoTugAttach`, `simTaxiwayUse`, `trafficWatch`, `loggingEnabled`. All **G** apart from the storage change.

### K. Dropped for the EFB

Bridge process, port 8340 HTTP/WebSocket, Electron tray, auto-start at logon, NSIS installer, GitLab auto-update, `bridge.log` file logging, and 2020/2024 sim detection (**X**).

## 3. Platform facts we know

- EFB apps are TypeScript/JSX projects built from the SDK's template app and packaged for the EFB ([EFB API docs](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/efb/electronic-flight-bag-api/)).
- SimVars are read with `SimVar.GetSimVarValue`. Only some can be set from JS, and writing a read-only A var fails silently ([avionics docs](https://microsoft.github.io/msfs-avionics-mirror/docs/interacting-with-msfs/simvars)).
- A developer forum thread reports `SimVar.SetSimVarValue` and `Coherent.call("TRIGGER_KEY_EVENT", ...)` working in EFB apps. It is about two years old and unofficial ([thread](https://devsupport.flightsimulator.com/t/efb-app-api-docs-to-interact-with-sim/10986)).
- The same thread reports the EFB template has no equivalent of the gauge update callback, so polling is up to the app.
- No facility-data or AI-traffic documentation for EFB apps turned up.

## 4. Proposed standalone architecture

Two parts in one package:

1. **EFB app (TypeScript/React).** UI, map, plan editor, route building, suggestions. Reuses `taxiSuggest.ts`, `mapGeo.ts`, `planDraft.ts` and the shared types.
2. **WASM module (C++ or Rust), if risk 1 or 2 bites.** Owns the tug loop, facility reads and traffic polling, using the full SimConnect API inside the sim. The EFB talks to it through the sim's JS-to-WASM channel (CommBus). **Unverified**: confirm availability and latency in 2024.

It is standalone because both parts ship in the sim package, with no external exe. The WASM module also keeps a push running when the tablet is closed.

If the spikes show pure JS can drive the tug, skip the WASM module and keep everything in the EFB app.

Storage: plans and settings go to the sim's data-storage API or `localStorage`. Logs go to an in-app ring buffer that can be exported. **Unverified**: how persistent each store is.

## 5. Risks, in order

1. **Tug driving from JS.** Can an EFB app write `VELOCITY BODY Z` and `ROTATION VELOCITY BODY Y` through `SetSimVarValue`, or only through SimConnect (so WASM)? The whole feature depends on this.
2. **Does the EFB app keep ticking when closed or backgrounded?** An auto push needs a steady tick with the tablet closed. If not, the control loop must live in WASM.
3. **Facility data and AI traffic access.** Needed for E1, E4 and F1, and the taxiway-suggestion feature depends on it. A fallback is a bundled airport/taxiway dataset, which loses sim-accurate layouts and scenery edits.
4. **Map tiles.** OSM tiles need internet from inside the sim, and OSM's usage policy applies. Alternative: draw the airport from E1 data alone, without tiles.
5. **In-sim notifications.** Check the EFB notification API in the SDK docs. Without it, prompts only show while the EFB is open.
6. **Per-aircraft behaviour.** Brake and tiller LVars, and jet bridge and services key events, vary by aircraft. Keep the current probing and add a way to log what works.

## 6. Spikes before building

Do these in order. Each is a day or two.

1. Minimal EFB app that reads telemetry and shows it. Confirms setup, polling and update rate, and whether it ticks while hidden.
2. Try to write the tug velocity vars from JS. If they don't work, prove the WASM route instead.
3. Read an airport's taxiways and parking from the sim.
4. Read nearby AI aircraft.
5. Check the EFB notification API.

## 7. Suggested MVP

All the Musts: sim state (A), tug attach, detach and brake handling (B1, B3–B7), manual pushback (C, on B2 or its fallback), ground services (G) and a map with the live aircraft marker (H1). Then, in order: auto routes (D, Should) once the spikes confirm the tick, B2 smooth driving if not already in, prompts beyond the tablet (I1) and the EFB redesign polish (H2). Plan saving (D6), taxiway suggestions (E), traffic watch (F) and settings (J) are Could.
