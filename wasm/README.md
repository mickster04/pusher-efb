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

You need the MSFS 2024 SDK and Visual Studio with the MSFS WASM platform toolset. The SDK's sample is the reliable starting point:

1. In the SDK, find the **StandaloneModule** sample (SDK docs: Samples > Misc > StandaloneModule). It has a Visual Studio project under its `Sources/Code` folder.
2. Copy that sample somewhere writable. Replace its source file with `wasm/src/module.cpp`, and add `wasm/src/taxi_core.cpp` and `wasm/src/taxi_core.h` to the project. Keep the sample's project settings (platform toolset, linked `MSFS_WasmVersions.a`, exports of `module_init` and `module_deinit`).
3. Build the Release configuration. Rename the output to `PusherTaxi.wasm` and copy it to `PackageSources/modules/` in this project.
4. Build the package with the Project Editor as usual (`PusherEfbSpikesProject.xml`). The package definition copies `PackageSources/modules/` to the package's `modules/` folder, where the sim loads standalone modules automatically.
5. Start a flight. In Developer Mode open the Console and search for `[PusherTaxi] module_init`. In the EFB, open Pusher Spikes, page 3 (Taxiways) and press **Check taxi module**.

If the module does not load: the folder in the package must be exactly `modules`, and the module must link `MSFS_WasmVersions.a` (automatic with the MSFS 2024 toolset) or the sim treats it as an MSFS 2020 module. One forum thread reports a module that mounted but never loaded with no error.

## Protocol

See the comment at the top of `src/05-wasm-taxi.js`. Events: `PusherTaxiPing`, `PusherTaxiRequest` (JS to module) and `PusherTaxiResponse` (module to JS).

## Host test

```bash
npm test
```

compiles `src/taxi_core.cpp` with `clang++` or `g++` and runs `test/gen_sample.cpp`, which builds facility records the way the sim lays them out. Skipped if no compiler is found.
