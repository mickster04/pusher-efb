# Pusher WASM modules

Two standalone modules, kept apart so experiments with one cannot break the other: **PusherTaxi** (below; proven in the sim) and **PusherFiles** (`wasm/files/files_module.cpp`, EFB client `src/data/wasm-files.js`; unverified). PusherFiles has no SimConnect, only the CommBus and plain C file calls. It keeps the user's **saved themes** as `.json` files in its work folder (a module can read, write and list `\work\` and nothing inside the package, so `layout.json` cannot be edited from the sim). Events: `PusherFilesPing`, `PusherFilesList` (one message per `.json` file, then an end message), `PusherFilesSave` and `PusherFilesDelete` (plain names ending `.json` only), answered on `PusherFilesResponse`. Host test: `test/wasm-files.test.mjs` compiles the module with stand-in MSFS headers and a temporary work folder. On a Microsoft Store install the folder is `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalState\WASM\MSFS2024\push-planner\work`; a Steam install is suggested to be at `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\push-planner\work` (from community reports; not checked here; other places reported for Steam are `%APPDATA%\Microsoft Flight Simulator 2024\Packages\push-planner\work\wasm` and the same path with `MSFS2020` in place of `MSFS2024`; if none exists, search `%APPDATA%\Microsoft Flight Simulator 2024` for a folder called `push-planner`). `bash wasm/build.sh` builds both modules and copies `PusherTaxi.wasm` and `PusherFiles.wasm` to `PackageSources/modules/` (the package copies that folder, so reinstall and restart the sim after a build).

## Pusher taxi module

A standalone MSFS 2024 WASM module. It reads an airport's taxi points, parking spots, taxi paths and taxiway names from
SimConnect facility data (the same data the original Pusher bridge used) and sends them to the EFB app as JSON over the
sim's CommBus. The EFB app cannot read these from JavaScript.

## Status

| Part | State |
|---|---|
| `src/taxi_core.*` (parsing records, geometry, JSON) | Compiled with `-Wall -Wextra -Werror` and tested on the host (`npm test`) |
| EFB client `src/05-wasm-taxi.js` | Tested against the real C++ output, including out-of-order and tiny chunks |
| `src/module.cpp` (MSFS and SimConnect glue) | Compiles with the SDK's clang (`build.sh`), loads in the sim, answers the ping and returns NZCH data (3 Nov 2026, MSFS 2024 1.9.21, SDK 1.8.1) |
| Whole thing inside the sim | Loads and returns data: 681 points, 52 parking, 846 paths, 21 names for NZCH in 13 messages. **Not yet checked:** that the names, positions and path types are correct, and a full push using them |

## Build (Windows, MSFS 2024 SDK)

### `build.sh` (no Visual Studio needed)

From Git Bash: `bash wasm/build.sh` (optional argument: the SDK folder, default `/g/MSFS 2024 SDK`). It calls the SDK's own `WASM/llvm/bin/clang-cl.exe` and `wasm-ld.exe`, writes `wasm/build.log`, and copies `PusherTaxi.wasm` to `PackageSources/modules/`.

The MSFS 2024 toolset's flags are not published; these were found by trial against the sim's load errors. Each one fixed a specific rejection:

| Flag | Why |
|---|---|
| `--export-table` | Sim error `Error getting indirect function table in module ...` without it |
| `--export=malloc --export=free` | Sim error `Error get malloc function pointer in module ...` without it |
| `/GS-` | Otherwise the module imports `__stack_chk_fail`, which the sim does not provide |
| `/clang:-O3 /clang:-fno-rtti /clang:-std=c++17` | clang-cl only takes plain clang flags through `/clang:` (plain `-O2`, `-fno-exceptions` were ignored with a warning) |
| `--no-entry --allow-undefined --export=module_init --export=module_deinit` | Library module with the sim supplying the SimConnect and CommBus imports |

It also links `MSFS_WasmVersions.a`, `libc`, `libc++`, `libc++abi` and `libclang_rt.builtins-wasm32.a` from the SDK's `WASM` folder. Check a new build with a wasm export/import listing: it should export `memory`, `__indirect_function_table`, `module_init`, `module_deinit`, `malloc`, `free`, and import only SimConnect, CommBus and a few `fd_*`/`commit_pages` calls.

### After the build

1. Rebuild the package with the Project Editor (`PushPlannerProject.xml`). The package definition copies `PackageSources/modules/` to the package's `modules/` folder.
2. Copy the package to the Community folder (for MSFS 2024 this was `...\LocalCache\Packages\Community2024\push-planner`) and **restart the sim**: modules load only at start-up.
3. In the sim log look for `WASM: Module path is ...pushertaxi.wasm`, then `loaded` and `initialized`, then `[PusherTaxi] module_init`. In the EFB, page 3 **Check taxi module** should say found.

Sim load errors seen and what they mean: `Error getting indirect function table` (add `--export-table`), `Error get malloc function pointer` (export `malloc`). The sim's other warnings for optional exports (`get_pages_state`, `mallinfo` and similar) are harmless.

## Using the WASM files as they are, in another project

The two `.wasm` files are self-contained and know nothing about Push Planner, so they can be copied into any MSFS 2024 package (the `.wasm` files are build output and are not committed: build them with `bash wasm/build.sh`, or take them from a copy of the built package). Each is a standalone module that talks to JavaScript only over the sim's CommBus.

1. **Copy** `PusherTaxi.wasm` and/or `PusherFiles.wasm` from `PackageSources/modules/` into your own package's `PackageSources/modules/`. The folder must be called `modules`, and the file names are the module names the sim logs (it lower-cases them: `pushertaxi.wasm`). Use both, or only the one you need; they do not depend on each other.
2. **Build the package** (Project Editor) so the files are copied to the package's `modules/` folder and listed in its `layout.json`, install it in the Community folder and **restart the sim**: modules load only at start-up. Look for `WASM: Module path is ...` and `[PusherTaxi] module_init` (or the files module's equivalent) in the sim log.
3. **Talk to a module from your page or EFB app** with the CommBus. Load `/JS/Services/CommBus.js`, call `RegisterCommBusListener`, listen for the module's response event, and send a request with `listener.callWasm(eventName, jsonString)`. The easiest start is to copy the matching client, which has no dependency on the rest of the app other than a log function (`PS.log`) and an error-text helper (`PS.errText`): `src/data/wasm-taxi.js` for the taxi module, `src/data/wasm-files.js` for the files module. Both send a ping first (`{"id":1}` answers `pong` with the version), which is the way to check the module is loaded.

| Module | Request events | Answers on | What it gives you |
|---|---|---|---|
| `PusherTaxi` | `PusherTaxiPing`, `PusherTaxiRequest {"id","icao"}` | `PusherTaxiResponse` | an airport's taxi points, parking, taxi paths and taxiway names (from SimConnect facility data) as chunked JSON; message shapes are in the header of `src/data/wasm-taxi.js` |
| `PusherFiles` | `PusherFilesPing`, `PusherFilesList`, `PusherFilesSave {"id","name","text"}`, `PusherFilesDelete {"id","name"}` | `PusherFilesResponse` | read, write, list and delete small `.json` files in the module's work folder; names are letters, digits, `-`, `_`, `.` and must end `.json` (64 characters at most), 16 KB per file; shapes are in the header of `wasm/files/files_module.cpp` |

Things to know when reusing them:

- **The work folder is named after your package**, not this one: `...\WASM\MSFS2024\<your-package-folder>\work` (Microsoft Store root `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalState`; Steam, suggested from community reports and not checked, `%APPDATA%\Microsoft Flight Simulator 2024`; sources disagree, see the alternatives in the app's "Where saved themes are kept" help). Check the sim log or look for the folder after the first save.
- **Event names are fixed** in the binaries (`PusherTaxi...`, `PusherFiles...`). Two packages that both ship one of these modules would share the events; to avoid that, rename the events in the C++ source and rebuild.
- The files module only touches its own work folder and cannot write inside the package, so it is not a way to change a package's own files.
- To change behaviour, edit `wasm/src` (taxi) or `wasm/files/files_module.cpp` (files), then rebuild with the flags in the build section above.

## Protocol

See the comment at the top of `src/05-wasm-taxi.js`. Events: `PusherTaxiPing`, `PusherTaxiRequest` (JS to module) and `PusherTaxiResponse` (module to JS).

## Host test

```bash
npm test
```

compiles `src/taxi_core.cpp` with `clang++` or `g++` and runs `test/gen_sample.cpp`, which builds facility records the way the sim lays them out. Skipped if no compiler is found.
