# Pusher EFB

MSFS 2024 EFB app port of the Pusher pushback manager (the original lives in the sibling folder `../msfs-pusher-main`: C# SimConnect bridge plus Electron/React UI).
This project is a **standalone** EFB app: no companion exe, no localhost bridge.

## Read first

1. [docs/efb-requirements.md](docs/efb-requirements.md): requirements with MoSCoW priorities (set by the product owner) and feasibility ratings.
2. [docs/implementation/efb-platform-notes.md](docs/implementation/efb-platform-notes.md): how an EFB app is packaged, registered and built; sim browser limits; what is verified and what is not.
3. [docs/implementation/pusher-internals.md](docs/implementation/pusher-internals.md): the tug physics, units, key events, tuning constants and data shapes from the original app that the port must reproduce.
4. [docs/implementation/wasm-taxi.md](docs/implementation/wasm-taxi.md): the taxi WASM module (SimConnect facility data to the EFB over the CommBus), what is verified and what is not.
5. [docs/implementation/spike-app.md](docs/implementation/spike-app.md): design of the spike app (this repo's current code), its pages and what each one is meant to answer.

## Ground rules

- Priorities in `docs/efb-requirements.md` are decisions. Do not reprioritise; flag conflicts instead.
- Everything about the sim's JS environment is **unverified until tested in the sim** unless a note says otherwise (the notes in `docs/implementation/` record what has been verified). This machine is a Mac with no MSFS; the owner runs things in the sim on a Windows machine and pastes logs back (`logs.txt`, `wasm/build.log`). Say what is unverified when reporting.
- Built artifacts are not committed: `PackageSources/modules/*.wasm`, `Packages/`, `wasm/build/`, `wasm/build.log`, `logs.txt`.
- The sim's embedded browser is old. Write conservative ES5/ES2017 JS, no CSS variables, `calc()` or grid.
- Do not use the app name `TemplateApp` (collides with other add-ons). Internal name is `PusherSpikes`; file, folder and package `OutputDir` names must all match it exactly or the sim silently ignores the app.
- `node_modules/` is excluded from cloud sync by the owner. Keep large generated folders out of the repo.

## Commands

- `npm run build`: concatenates `src/*.js` into `PackageSources/PusherSpikes/PusherSpikes.js` (node only, no dependencies).
- `npm test`: build plus node unit tests for the pure helpers.
- `npm run harness`: serve a browser mock of the EFB and sim at the printed URL to review the UI on a Mac.
- `bash wasm/build.sh` (Git Bash on Windows only): builds the taxi WASM module with the SDK's clang, no Visual Studio. Writes `wasm/build.log`. Link flags and sim load errors are in `wasm/README.md`.
