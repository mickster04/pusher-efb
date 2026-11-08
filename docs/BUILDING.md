# Building Push Planner from a fresh checkout

What you need, in order. The steps marked **Windows** need a machine with MSFS 2024 and its SDK; the rest runs anywhere Node does.

## 0. Set up this machine

`npm run setup` checks the tools (Node, npm, git, bash, a C++ compiler for the WASM host tests, the MSFS SDK and its compiler, `fspackagetool`), offers to install what is missing and installable (Node and git through winget or Homebrew; it asks first, or use `-- --yes`), then does what can be done on this machine: prepares Prettier, builds the app and runs the tests. Whatever needs the MSFS SDK or Windows (the WASM modules and the package) is a **warning**, not a failure, so on a Mac the setup is complete without them. Everything is written to `setup.log`; `npm run setup -- --check` only reports and changes nothing.

The SDK is found from `--sdk <folder>`, then the `MSFS2024_SDK` environment variable (the SDK installer sets it), then two common folders; if it is not set, the script prints the `setx` command. Run it again on the Windows machine with the sim to check the WASM and package steps there.

## 1. The app (any OS)

1. Install Node 20 or newer. There is nothing to `npm install`: the app has no dependencies.
2. `npm test` builds, lints and runs the unit tests. It must pass.
3. `npm run build:app` writes the two generated things the package ships, both ignored by git:
   - `PackageSources/PushPlanner/PushPlanner.js`, the whole app in one file, made from `src/`.
   - `PackageSources/PushPlanner/themes/`, a copy of `src/themes/`.

   Never edit those; change `src/` and rebuild. To look at the app without the sim, `npm run harness` serves a mock EFB at http://127.0.0.1:8765/ (layout and logic only: it says nothing about what the sim allows).

## 2. The WASM modules (Windows)

The taxi module reads taxiways and parking; the files module stores saved themes. Install the MSFS 2024 SDK (with the Developer Mode), then from Git Bash in the repo:

```bash
npm run build:wasm      # same as: bash wasm/build.sh
```

It uses the SDK's own clang (no Visual Studio), writes `PackageSources/modules/PusherTaxi.wasm` and `PusherFiles.wasm`, and logs to `wasm/build.log`. Details, link flags and load errors are in [wasm/README.md](../wasm/README.md). The `.wasm` files are not in git. Without them the app still runs, with runways only and no saved theme files.

## 3. The package (Windows)

1. Open `PushPlannerProject.xml` in the sim's **Project Editor** (Developer Mode > Project Editor) and **Build** it. The definition (`PackageDefinitions/push-planner.xml`) copies `PackageSources/PushPlanner/` to the EFB apps folder and `PackageSources/modules/` to the package's `modules/` folder. The result lands in `Packages/push-planner`.
2. Copy that folder to the Community folder:
   - Microsoft Store: `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\Packages\Community2024\`
   - Steam: the equivalent folder under `%APPDATA%\Microsoft Flight Simulator 2024\Packages\Community2024\` (not verified by us).
3. **Restart the sim.** WASM modules load only at start-up, and the sim serves only files listed in the package's `layout.json`, so a new theme file or module needs a rebuild of the package.

The command-line package tool (`fspackagetool`) should do step 1 as well; we have not used it.

## 4. Check it works

Open the EFB, start the Push Planner app, go to **Settings > Diagnostics** and press **Run all checks**. Anything other than OK says which part is missing (the taxi or files module not installed, no airport data, and so on).

## Release steps

See [release-checklist.md](release-checklist.md). The version is in three places until that list is done: `package.json`, `PackageDefinitions/push-planner.xml` and `PS.VERSION` in `src/core/core.js`.
