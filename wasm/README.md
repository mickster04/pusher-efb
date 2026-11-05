# Pusher WASM modules

Two standalone modules, kept apart so experiments with one cannot break the other: **PusherTaxi** (below; proven in the sim) and **PusherFiles** (`wasm/files/files_module.cpp`, EFB client `src/data/wasm-files.js`; unverified). PusherFiles has no SimConnect, only the CommBus and plain C file calls. It keeps the user's **saved themes** as `.json` files in its work folder (the probe showed a module can read, write and list `\work\` and nothing inside the package, so `layout.json` cannot be edited from the sim). Events: `PusherFilesPing`, `PusherFilesProbe` (what files can do), `PusherFilesList` (one message per `.json` file, then an end message), `PusherFilesSave` and `PusherFilesDelete` (plain names ending `.json` only), answered on `PusherFilesResponse`. Host test: `test/wasm-files.test.mjs` compiles the module with stand-in MSFS headers and a temporary work folder. On a Microsoft Store install the folder is `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalState\WASM\MSFS2024\push-planner\work`; a Steam install keeps it under a different root (search for `pusher-probe.txt`). `bash wasm/build.sh` builds both modules and copies `PusherTaxi.wasm` and `PusherFiles.wasm` to `PackageSources/modules/` (the package copies that folder, so reinstall and restart the sim after a build).

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

### Without Visual Studio: `build.sh` (used so far)

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

### With Visual Studio (documented route, not used yet)

`vs/PusherTaxi.sln` is copied from the SDK's StandaloneModule sample (`MSFS2024` toolset, `_MSFS_WASM`, no exceptions, no entry point). Build **Release | MSFS**; the post-build step copies `PusherTaxi.wasm` to `PackageSources/modules/`. Untested.

### After either build

1. Rebuild the package with the Project Editor (`PushPlannerProject.xml`). The package definition copies `PackageSources/modules/` to the package's `modules/` folder.
2. Copy the package to the Community folder (for MSFS 2024 this was `...\LocalCache\Packages\Community2024\push-planner`) and **restart the sim**: modules load only at start-up.
3. In the sim log look for `WASM: Module path is ...pushertaxi.wasm`, then `loaded` and `initialized`, then `[PusherTaxi] module_init`. In the EFB, page 3 **Check taxi module** should say found.

Sim load errors seen and what they mean: `Error getting indirect function table` (add `--export-table`), `Error get malloc function pointer` (export `malloc`). The sim's other warnings for optional exports (`get_pages_state`, `mallinfo` and similar) are harmless.

## Protocol

See the comment at the top of `src/05-wasm-taxi.js`. Events: `PusherTaxiPing`, `PusherTaxiRequest` (JS to module) and `PusherTaxiResponse` (module to JS).

## Host test

```bash
npm test
```

compiles `src/taxi_core.cpp` with `clang++` or `g++` and runs `test/gen_sample.cpp`, which builds facility records the way the sim lays them out. Skipped if no compiler is found.
