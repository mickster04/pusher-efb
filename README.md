# Pusher EFB

An MSFS 2024 EFB app that plans and drives a pushback, ported from the Pusher desktop app. Plain JavaScript, no dependencies, no SDK needed to build. The internal name is still `PusherSpikes` (the sim matches it against file and folder names, so renaming is a separate step).

**Status: under construction, replacing the feasibility spikes.** The spike app (telemetry, tug, taxiways, traffic, notifications, built-in map pages) is kept on the `spikes-app` branch. The spikes showed the sim can do what the port needs: reads, the tug (attach and per-tick driving), AI traffic, the facility loader, and taxi paths through a WASM module ([docs/implementation/spike-app.md](docs/implementation/spike-app.md), [docs/implementation/wasm-taxi.md](docs/implementation/wasm-taxi.md)). Everything below has run in the browser harness and in unit tests; the Plan tab has not yet run in the sim.

## Tabs

1. **Plan** (built): a north-up plot centred on the aircraft with runways, taxiways, stands and AI aircraft. Tap to drop pins; each pin is drawn as an aircraft pointing the way the nose will be there. Drag a pin to move it, drag the yellow handle behind a selected pin to rotate it. The planned route is drawn with the tug's turn arcs (white = push back, blue = forward, red = the tug may not manage that leg). Suggested pushes from the original app's suggester can be shown and used as the plan. Refresh diagnostics are at the bottom of the tab.
2. **Push** (next): toggle the tug, check and enforce the parking brake off, then follow the plan with remaining distance and a toast like the old app's.

Use **Copy all logs** (top right) to copy the whole log and the Plan tab's diagnostics.

## Layout of the code

`src/*.js` are concatenated in filename order by `build.mjs`: sim access and logging (00), geometry (01), taxi and traffic data (02, 03), UI helpers (04), the taxi WASM client (05), plot maths (06), the route planner (06, a port of the original's `mapGeo.ts` planner), the suggester (07, a port of `taxiSuggest.ts`), the plan model (08), facility loading (30), AI traffic (40), the Plan tab (60) and the app shell (90). `src/reference/` holds the spike Tug page, the code the Push tab will be built from; it is not built.

## Install in the sim

1. Build the JS: `npm run build` (needs only Node).
2. Optional: build the taxi module with `bash wasm/build.sh` (see above).
3. Package it with the MSFS SDK Project Editor using `PusherEfbSpikesProject.xml` (Windows). The package definition copies `PackageSources/PusherSpikes/` to `html_ui/efb_ui/efb_apps/PusherSpikes/` and `PackageSources/modules/` to `modules/`.
4. Put the built package in the MSFS 2024 Community folder (on this install the sim reads `...\LocalCache\Packages\Community2024`), start the sim, open the EFB and look for **Pusher Spikes** (the app keeps that name for now).

If the app does not appear, the usual cause is a name mismatch: the internal name `PusherSpikes` must be identical in the JS, the JS file name, the `PackageSources` folder and the `OutputDir` in the package definition. See [docs/implementation/efb-platform-notes.md](docs/implementation/efb-platform-notes.md).

## Taxi WASM module

Taxi paths are not available from the EFB's JavaScript, so a small standalone WASM module (`wasm/`) reads them from SimConnect facility data and sends them to the app over the CommBus. Without it the Taxiways page shows runways only.

- Build it **without Visual Studio**: `bash wasm/build.sh` from Git Bash on Windows. It uses the SDK's own clang, writes `PackageSources/modules/PusherTaxi.wasm` and logs to `wasm/build.log`. A Visual Studio project is also provided in `wasm/vs/` (untested).
- Then rebuild the package, copy it to the Community folder and **restart the sim**, because modules only load at start-up. Full steps, the link flags the sim requires and the load errors to look for are in [wasm/README.md](wasm/README.md).
- The built `.wasm` is a build artifact and is not committed.

## Safety

The Tug page's Direct mode writes velocity to the aircraft. Use it only parked on the ground, with the tug attached and brake released. It stops at the time limit, on the stop button, when you leave the page, and when the app is paused or closed.

## Develop

```bash
npm test
```

Builds the bundle and runs the unit tests for the geometry, taxiway, traffic and toast helpers, plus the taxi module's C++ core (compiled on the host with `clang++` or `g++` if one is installed).

```bash
npm run harness
```

Serves the mock EFB at http://127.0.0.1:8765/. The mock fakes the EFB, the SDK, `SimVar` and `Coherent`, so it shows layout and logic only. It says nothing about what the sim allows.

Source is in `src/` (concatenated in filename order by `build.mjs`). Project notes for Claude are in [CLAUDE.md](CLAUDE.md).
