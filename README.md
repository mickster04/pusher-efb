# Pusher EFB: spike app

A single MSFS 2024 EFB app with six pages, each answering a feasibility question for porting Pusher (pushback manager) to a standalone EFB app. Plain JavaScript, no dependencies, no SDK needed to build.

**Status: runs in the MSFS 2024 EFB.** The app loads, and telemetry, the tug drive, AI traffic, the facility loader, toasts and the map have been exercised in the sim. The taxi WASM module loads and returns taxiway data (3 Nov 2026). Results and open questions are in [docs/implementation/spike-app.md](docs/implementation/spike-app.md) and [docs/implementation/wasm-taxi.md](docs/implementation/wasm-taxi.md). Anything not listed there as verified has only been run in the browser mock on a Mac.

## Pages

1. **Telemetry**: live table of the variables the original app reads, an input row to read, add, set or send any variable on the fly, and counters that show whether anything keeps ticking while the app is hidden.
2. **Tug**: attaches the sim's tug and drives it with per-tick velocity and turn writes, as the original does, with speed and turn-rate inputs, steering buttons and numeric logging. It has a run-time limit and stops on hide or pause.
3. **Taxiways**: finds the nearest airport, loads its runways from the facility API and its taxi paths and parking from the **taxi WASM module** (see below), and lists named taxiways, runways and connectors with category, length, width, and nearest distance and bearing. Raw data panel, a **Check taxi module** button, and an offline sample for reviewing the table.
4. **Traffic**: discovers candidate AI traffic APIs and lists contacts with distance, bearing, relative bearing, altitude difference, speed, closing speed and time to closest approach. Simulated-contacts button for reviewing the table.
5. **Notifications**: in-tablet toasts with action buttons (release brake, set brake with two actions, distance left with Pause/Resume, traffic hold with Ignore), and a probe of the EFB's notification manager.
6. **Map**: probes for the sim's built-in map components, tries to mount one, and draws a baseline plot with no imagery (aircraft, range rings, taxiways, contacts).

Each page has a log with a Copy button. After a sim session, paste the logs back so results can be recorded in [docs/implementation/spike-app.md](docs/implementation/spike-app.md).

## Install in the sim

1. Build the JS: `npm run build` (needs only Node).
2. Optional: build the taxi module with `bash wasm/build.sh` (see above).
3. Package it with the MSFS SDK Project Editor using `PusherEfbSpikesProject.xml` (Windows). The package definition copies `PackageSources/PusherSpikes/` to `html_ui/efb_ui/efb_apps/PusherSpikes/` and `PackageSources/modules/` to `modules/`.
4. Put the built package in the MSFS 2024 Community folder (on this install the sim reads `...\LocalCache\Packages\Community2024`), start the sim, open the EFB and look for **Pusher Spikes**.

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
