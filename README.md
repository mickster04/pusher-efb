# Push Planner (EFB)

An MSFS 2024 EFB app that plans and drives a pushback, ported from the Pusher desktop app. Plain JavaScript, no dependencies, no SDK needed to build the app itself (the two small WASM modules need the MSFS SDK). The internal name is still `PushPlanner` (the sim matches it against file and folder names, so renaming is a separate step).

**Status: pre-release.** Planning, suggestions, pushing, gate detection, Return to gate, engine-gated tug dismissal, themes and settings have been run in the sim. Not yet verified there: the files module (saved theme files), ground services on every aircraft, and behaviour across aircraft types (tiller and brake handling). The earlier feasibility app is kept on the `spikes-app` branch ([findings](docs/implementation/feasibility-findings.md), [taxi module](docs/implementation/wasm-taxi.md)).

New here? [docs/BUILDING.md](docs/BUILDING.md) takes a fresh checkout to an installed package.

## Tabs

1. **Plan**: a north-up map centred on the aircraft with runways, taxiways, stands and AI aircraft. Tap to drop pins; each pin is drawn as an aircraft pointing the way the nose will be there, with its number in the middle. Drag a pin to move it, drag the yellow handle behind a selected pin to rotate it, drag empty map to move the map. The route is drawn with the tug's turn arcs (white = push back, blue = forward, red = the tug may not manage that leg). Suggested pushes from the original app's suggester can be chosen as the plan.
2. **Push**: **Start push** does it all in one press: it calls the tug if it is not on, waits for the parking brake to be off (it can release it for you), then drives the plan with a path follower. It shows the distance left, speed and how far off the path it is, a live map, and a popup over every tab with Pause/Resume/Stop. At the end it offers to set the brake and dismiss the tug (by default only after an engine has started). The ground services (jet bridge, fuel, baggage, catering, power) are buttons here. Return to gate retraces the push.
3. **Settings**: speed, how the tug is dismissed, planning limits, snapping, the map (line widths, range rings) and the colour themes. The **Diagnostics** button at the bottom opens the checks and the log; both are hidden until it is pressed.

## Diagnostics and logging

The log is deliberately short: what happened and what went wrong. Press **Settings > Diagnostics** for a set of read-only checks (sim access, the two WASM modules, the nearest airport, gate detection, AI traffic, the tug and brake variables, engines, ground services, theme files). Each logs the detail relevant to what it checks while it runs. **Detailed logging** keeps that fine print all the time (use it to reproduce a problem), and **Copy all logs** copies the log and page snapshots to report one. In code, `PS.log` is the normal log and `PS.logv` the detail that only shows during a check or in detailed mode.

## Safety

This app moves a real aircraft in the simulator by writing velocity and brake variables. Use it parked on the ground at a stand, with the tug attached and brake released. The tug stops at once on Stop, when the sim detaches it, when the app is paused or closed, and when the brake is set. Always watch the aircraft and the map yourself: the app does not see other aircraft, vehicles or obstacles ahead, and it will not stop for them. Pause or Stop if anything is in the way.

## Not affiliated

Push Planner is an independent project. It is not affiliated with or endorsed by Microsoft, Asobo, or any airline. The airline-inspired themes use approximate colours only (no logos); airline names belong to their owners.

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

Taxi paths are not available from the EFB's JavaScript, so a small standalone WASM module (`wasm/`) reads them from SimConnect facility data and sends them to the app over the CommBus. Without it the map shows runways only and there is no parking, so gate detection and Return to gate do not work. A second module (`PusherFiles`) stores saved themes as files.

- Build it **without Visual Studio**: `bash wasm/build.sh` from Git Bash on Windows. It uses the SDK's own clang, writes `PackageSources/modules/PusherTaxi.wasm` and logs to `wasm/build.log`.
- Then rebuild the package, copy it to the Community folder and **restart the sim**, because modules only load at start-up. Full steps, the link flags the sim requires and the load errors to look for are in [wasm/README.md](wasm/README.md).
- The built `.wasm` is a build artifact and is not committed.

## Develop

```bash
npm test          # build, lint, then the unit tests (this is what to run before every commit)
npm run build     # just the bundle: PackageSources/PushPlanner/PushPlanner.js and the themes/ folder
npm run lint      # the checks the sim's old browser needs (no let/const, arrow functions or template strings; line length; the bundle parses)
npm run format    # Prettier (config in .prettierrc.json), run through npx so nothing is installed in the repo
npm run build:wasm  # both WASM modules (Windows, Git Bash, MSFS 2024 SDK; see wasm/README.md)
npm run build:all   # test, then the WASM modules
npm run harness   # the mock EFB at http://127.0.0.1:8765/
```

`npm test` also compiles the taxi module's C++ core and the files module on the host with `clang++` or `g++` if one is installed.

The harness fakes the EFB, the SDK, `SimVar` and `Coherent`, so it shows layout and logic only. It says nothing about what the sim allows.

### Build artifacts are not in git

Everything generated is ignored: `PackageSources/PushPlanner/PushPlanner.js` and `PackageSources/PushPlanner/themes/` (made by `npm run build` from `src/` and `src/themes/`), `PackageSources/modules/*.wasm`, `wasm/build/`, `wasm/build.log`, `Packages/`, `PackagesMetadata/`, `_PackageInt/` and `logs.txt`. A fresh checkout has to run `npm run build` (and `npm run build:wasm` for the modules) before the package is built. Edit `src/`, never the files in `PackageSources/PushPlanner/`.

### Cautions for maintainers

- **One shared scope, one load order.** Every module hangs off a single `PS` object and uses the ones loaded before it, in the order listed in `build.mjs` (`ORDER`). The build refuses a file that is not listed, but it cannot tell that a module uses another that is loaded later: that fails at start-up in the sim, not at build time. Put a new module after everything it uses while loading.
- **The push state is one big object driven by status strings.** `S` in `src/push/push.js` (`idle`, `ready`, `attaching`, `waitBrake`, `driving`, `paused`, `stopping`, `done`, ...) is read by the Push tab, the toasts and the tug code, and each reads it its own way. A status the UI does not expect can leave no button usable (the Push tab was once stuck after a finished push when new pins were added). When adding or changing a status, check every place that tests `status` (`grep -n "status ===" src`), and add a test in `test/push.test.mjs` for the state the pilot ends up in.
- **The pages are not unit-tested.** `src/pages/` and `src/ui/colours.js` are only checked by hand in the harness and the sim; the logic they call is tested. Put decisions in a testable function (as `PS.push.finishMode` is) rather than inline in a page.
- **Old browser.** The sim's browser is old: `npm run lint` enforces ES5-style code (`var`, `function`), and there are no CSS variables, `calc()` or grid.

## Licence and contributing

MIT, (c) 2026 Mike Cleaver: see [LICENSE](LICENSE). Parts derive from the original Pusher app, also MIT: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Both files are shipped in the package. Pull requests are welcome; by sending one you agree it is under the same MIT licence. Run `npm test` first.
