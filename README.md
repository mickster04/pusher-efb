# Pusher EFB

An MSFS 2024 EFB app that plans and drives a pushback, ported from the Pusher desktop app. Plain JavaScript, no dependencies, no SDK needed to build. The internal name is still `PushPlanner` (the sim matches it against file and folder names, so renaming is a separate step).

**Status: under construction.** The earlier feasibility app (telemetry, tug, taxiways, traffic, notifications and built-in map pages) is kept on the `spikes-app` branch. It showed the sim can do what the port needs: reads, the tug (attach and per-tick driving), AI traffic, the facility loader, and taxi paths through a WASM module ([docs/implementation/feasibility-findings.md](docs/implementation/feasibility-findings.md), [docs/implementation/wasm-taxi.md](docs/implementation/wasm-taxi.md)). Everything below has run in the browser harness and in unit tests; the Plan tab has only been tried in the sim by hand so far.

## Tabs

1. **Plan** (built, working in the sim): a north-up plot centred on the aircraft with runways, taxiways, stands and AI aircraft. Tap to drop pins; each pin is drawn as an aircraft pointing the way the nose will be there. Drag a pin to move it, drag the yellow handle behind a selected pin to rotate it, drag empty map to move the map. The planned route is drawn with the tug's turn arcs (white = push back, blue = forward, red = the tug may not manage that leg), tightening the turn radius where a corner is cramped. Suggested pushes from the original app's suggester can be chosen as the plan.
2. **Push** (built; tested only against a fake sim so far, not in the real sim): **Start** does it all in one press: it calls the tug if it is not on, checks the parking brake and waits for it to be off (it can release it for you), then drives the plan with a path follower. It shows the distance left, the leg, speed and how far off the path it is, a live map, and a popup over every tab with the distance left and Pause/Resume/Stop. When it arrives, a popup offers to set the brake and dismiss the tug. It stops at once if you press STOP, the sim takes the tug away, the brake is set mid-push (it carries on when the brake is released), or the app is paused or closed.

Use **Copy all logs** (top right) to copy the whole log. The Push tab has its own log panel.

## Layout of the code

`build.mjs` concatenates the modules in `src/` (in an explicit order listed in the script; it fails if a file is missing from the list) into the one file the sim loads:

- `src/core/`: sim access and logging, geometry, saved settings.
- `src/data/`: taxi and traffic data, the taxi WASM client, facility loading, AI traffic.
- `src/planning/`: the route planner (a port of the original's `mapGeo.ts` planner), the push suggester (a port of `taxiSuggest.ts`), the plan (pins).
- `src/push/`: the parking brake and tug, the path follower, the push controller.
- `src/ui/`: widgets and icons, themes and colours, map maths and drawing.
- `src/pages/`: the Plan, Push and Settings tabs. `src/app.js` is the shell and EFB registration.
- `src/styles/styles.css`: the stylesheet, a template filled from the colour theme. `src/icons/*.svg`: one SVG file per icon, inlined by the build.

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

Source is in `src/` (see "Layout of the code"; concatenated by `build.mjs`). Project notes for Claude are in [CLAUDE.md](CLAUDE.md).
