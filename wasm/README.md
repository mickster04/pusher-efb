# Pusher taxi module (WASM)

A standalone MSFS 2024 WASM module. It reads an airport's taxi points, parking spots, taxi paths and taxiway names from
SimConnect facility data (the same data the original Pusher bridge used) and sends them to the EFB app as JSON over the
sim's CommBus. The EFB app cannot read these from JavaScript.

## Status

| Part | State |
|---|---|
| `src/taxi_core.*` (parsing records, geometry, JSON) | Compiled with `-Wall -Wextra -Werror` and tested on the host (`npm test`) |
| EFB client `src/05-wasm-taxi.js` | Tested against the real C++ output, including out-of-order and tiny chunks |
| `src/module.cpp` (MSFS and SimConnect glue) | **Never compiled or run.** Written from the SDK docs on a machine without the SDK |
| Whole thing inside the sim | **Not tested** |

## Build (Windows, MSFS 2024 SDK)

You need the MSFS 2024 SDK and Visual Studio with the MSFS 2024 WASM platform toolset. `vs/PusherTaxi.sln` is already set up, copied from the SDK's StandaloneModule sample (settings kept: `MSFS2024` toolset, `_MSFS_WASM`, no exceptions, no entry point), pointing at `src/module.cpp`, `src/taxi_core.cpp` and `src/taxi_core.h`.

1. Open `wasm/vs/PusherTaxi.sln` in Visual Studio and build **Release | MSFS**.
2. The post-build step copies `PusherTaxi.wasm` to `PackageSources/modules/` in this project. No renaming needed.
3. Build the package with the Project Editor as usual (`PusherEfbSpikesProject.xml`). The package definition copies `PackageSources/modules/` to the package's `modules/` folder, where the sim loads standalone modules automatically.
4. Start a flight. In Developer Mode open the Console and search for `[PusherTaxi] module_init`. In the EFB, open Pusher Spikes, page 3 (Taxiways) and press **Check taxi module**.

If the module does not load: the folder in the package must be exactly `modules`, and the module must link `MSFS_WasmVersions.a` (automatic with the MSFS 2024 toolset) or the sim treats it as an MSFS 2020 module. One forum thread reports a module that mounted but never loaded with no error.

## Protocol

See the comment at the top of `src/05-wasm-taxi.js`. Events: `PusherTaxiPing`, `PusherTaxiRequest` (JS to module) and `PusherTaxiResponse` (module to JS).

## Host test

```bash
npm test
```

compiles `src/taxi_core.cpp` with `clang++` or `g++` and runs `test/gen_sample.cpp`, which builds facility records the way the sim lays them out. Skipped if no compiler is found.
