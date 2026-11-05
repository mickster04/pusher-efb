# Pusher EFB

MSFS 2024 EFB app port of the Pusher pushback manager (the original lives in the sibling folder `../msfs-pusher-main`: C# SimConnect bridge plus Electron/React UI).
This project is a **standalone** EFB app: no companion exe, no localhost bridge.

## Read first

1. [docs/efb-requirements.md](docs/efb-requirements.md): requirements with MoSCoW priorities (set by the product owner) and feasibility ratings.
2. [docs/implementation/efb-platform-notes.md](docs/implementation/efb-platform-notes.md): how an EFB app is packaged, registered and built; sim browser limits; what is verified and what is not.
3. [docs/implementation/pusher-internals.md](docs/implementation/pusher-internals.md): the tug physics, units, key events, tuning constants and data shapes from the original app that the port must reproduce.
4. [docs/implementation/wasm-taxi.md](docs/implementation/wasm-taxi.md): the taxi WASM module (SimConnect facility data to the EFB over the CommBus), what is verified and what is not.
5. [docs/implementation/app-design.md](docs/implementation/app-design.md): the app as it is now (Plan and Push tabs built; the Push tab not yet run in the sim) and what remains.
6. [docs/implementation/feasibility-findings.md](docs/implementation/feasibility-findings.md): what the earlier feasibility app showed about the sim (that app is on the `spikes-app` branch).

## Ground rules

- Priorities in `docs/efb-requirements.md` are decisions. Do not reprioritise; flag conflicts instead.
- Everything about the sim's JS environment is **unverified until tested in the sim** unless a note says otherwise (the notes in `docs/implementation/` record what has been verified). This machine is a Mac with no MSFS; the owner runs things in the sim on a Windows machine and pastes logs back (`logs.txt`, `wasm/build.log`). Say what is unverified when reporting.
- Built artifacts are not committed: `PackageSources/modules/*.wasm`, `Packages/`, `wasm/build/`, `wasm/build.log`, `logs.txt`.
- The sim's embedded browser is old. Write conservative ES5/ES2017 JS, no CSS variables, `calc()` or grid.
- Do not use the app name `TemplateApp` (collides with other add-ons). Internal name is `PushPlanner`; file, folder and package `OutputDir` names must all match it exactly or the sim silently ignores the app.
- `node_modules/` is excluded from cloud sync by the owner. Keep large generated folders out of the repo.

## Commands

- `npm run build`: concatenates the modules in `src/` (order listed in `build.mjs`; icons from `src/icons/*.svg` and the stylesheet are inlined) into `PackageSources/PushPlanner/PushPlanner.js` (node only, no dependencies).
- `npm test`: build, `npm run lint` (ES5-only code for the sim's browser, line length, the bundle parses) and the node unit tests. `npm run format` applies Prettier; `npm run build:wasm` and `npm run build:all` build the WASM modules (Windows).
- Build output is not in git (`PackageSources/PushPlanner/PushPlanner.js`, `PackageSources/PushPlanner/themes/`, `.wasm` files, `Packages/`, `logs.txt`): never edit it, run `npm run build`. See the maintainer cautions in README.md (shared scope and load order, push status strings, untested pages).
- `npm run harness`: serve a browser mock of the EFB and sim at the printed URL to review the UI on a Mac.
- `bash wasm/build.sh` (Git Bash on Windows only): builds the taxi WASM module with the SDK's clang, no Visual Studio. Writes `wasm/build.log`. Link flags and sim load errors are in `wasm/README.md`.

## Where things are
- Add a module: put it in the right `src/` folder and add it to `ORDER` in `build.mjs` (the build refuses to run if a `.js` is not listed). Order matters: a module must come after any it uses while loading.
- Add an icon: drop a `<path>`-only SVG on a 24 x 24 grid into `src/icons/` (kebab-case name; `fill="currentColor"` on a path makes it a filled shape) and use it as `PS.icon('camelCaseName')` or `ui.iconButton`.
- Colours: never hard-code a hex in CSS or drawing code; use an `@role@` token in `styles.css` or `PS.theme.c('role')` (roles are in `src/ui/theme.js`).
- Logging has two levels: `PS.log` for what happened and what went wrong, `PS.logv` for fine detail that only shows while a diagnostic check runs or Detailed logging is on (Settings > Diagnostics). New detail goes in `PS.logv`. Diagnostic checks are in `src/diag/checks.js`; they must only read from the sim.
