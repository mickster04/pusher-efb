# Pusher EFB: spike app

A single MSFS 2024 EFB app with six pages, each answering a feasibility question for porting Pusher (pushback manager) to a standalone EFB app. Plain JavaScript, no dependencies, no SDK needed to build.

**Status: built and exercised only in a browser mock on a Mac. It has never run in the sim.** Whether it loads in the EFB at all is the first thing to check.

## Pages

1. **Telemetry**: live table of the variables the original app reads, an input row to read, add, set or send any variable on the fly, and counters that show whether anything keeps ticking while the app is hidden.
2. **Tug**: toggle between *Direct* (per-tick velocity writes, as the original does) and *Native* (the sim's own tug events: toggle, hold/go, tug heading left/right). Direct mode has a run-time limit and stops on hide or pause.
3. **Taxiways**: tries the sim's facility APIs for an ICAO and lists named taxiways, runways and connectors with category, length, width, and nearest distance and bearing. Raw data panel. Offline sample button for reviewing the table.
4. **Traffic**: discovers candidate AI traffic APIs and lists contacts with distance, bearing, relative bearing, altitude difference, speed, closing speed and time to closest approach. Simulated-contacts button for reviewing the table.
5. **Notifications**: in-tablet toasts with action buttons (release brake, set brake with two actions, distance left with Pause/Resume, traffic hold with Ignore), and a probe of the EFB's notification manager.
6. **Map**: probes for the sim's built-in map components, tries to mount one, and draws a baseline plot with no imagery (aircraft, range rings, taxiways, contacts).

Each page has a log with a Copy button. After a sim session, paste the logs back so results can be recorded in [docs/implementation/spike-app.md](docs/implementation/spike-app.md).

## Install in the sim

1. Build the JS: `npm run build` (needs only Node).
2. Package it with the MSFS SDK package tool using `PusherEfbSpikesProject.xml` (Windows). The package definition copies `PackageSources/PusherSpikes/` to `html_ui/efb_ui/efb_apps/PusherSpikes/`.
3. Put the built package in the MSFS 2024 Community folder, start the sim, open the EFB and look for **Pusher Spikes**.

If the app does not appear, the usual cause is a name mismatch: the internal name `PusherSpikes` must be identical in the JS, the JS file name, the `PackageSources` folder and the `OutputDir` in the package definition. See [docs/implementation/efb-platform-notes.md](docs/implementation/efb-platform-notes.md).

I have not verified the exact package build command. Treat step 2 as unconfirmed until it has been done once.

## Safety

The Tug page's Direct mode writes velocity to the aircraft. Use it only parked on the ground, with the tug attached and brake released. It stops at the time limit, on the stop button, when you leave the page, and when the app is paused or closed.

## Develop

```bash
npm test
```

Builds the bundle and runs the unit tests for the geometry, taxiway, traffic and toast helpers.

```bash
npm run harness
```

Serves the mock EFB at http://127.0.0.1:8765/. The mock fakes the EFB, the SDK, `SimVar` and `Coherent`, so it shows layout and logic only. It says nothing about what the sim allows.

Source is in `src/` (concatenated in filename order by `build.mjs`). Project notes for Claude are in [CLAUDE.md](CLAUDE.md).
