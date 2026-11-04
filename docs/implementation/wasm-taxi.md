# Taxi WASM module: implementation notes

Why it exists: the EFB's JavaScript facility API returns runways (and maybe gates) but **no taxi paths**; searches of the SDK docs and sdk types found none. The original Pusher bridge got taxiways from SimConnect facility data (`bridge/TaxiwayService.cs`), which JS cannot call. A standalone WASM module can, so the design is: module reads SimConnect, EFB app asks over the CommBus.

## Verified vs not

- **Verified on the host (this repo's tests):** record parsing, coordinate conversion, JSON encoding, chunking, the JS assembler, out-of-order delivery, request parsing, the ping and request flow against a fake bus.
- **Verified in the sim (3 Nov 2026, MSFS 2024 1.9.21, SDK 1.8.1):** `module.cpp` compiles with the SDK's clang (`wasm/build.sh`, flags in `wasm/README.md`); the module loads from the package `modules` folder once it exports the function table, `malloc` and `free`; the ping is answered ("taxi module found, version 0.1.0"); a request for NZCH returned 681 points, 52 parking, 846 paths and 21 names in 13 messages, and the EFB assembled them (809 path items, 52 parking spots) about 100 ms after the request. The round trip works, so the CommBus accepts messages of this size and SimConnect record sizes are at least plausible.
- **Not yet verified:** that names, positions, widths and path types are correct (compare against the original app's data and the map overlay); that the 37 extra "runway" items (`40` runways reported against 3 from the facility API) are runway-type taxi paths and are classified as intended; behaviour at other airports or while a push is running.

## Sources used (MSFS 2024 SDK docs)

- JS CommBus: `RegisterCommBusListener()`, `listener.on(name, cb)`, `listener.callWasm(name, jsonString)`; script `/JS/Services/CommBus.js`. All calls asynchronous.
- WASM CommBus: `fsCommBusRegister(name, callback, ctx)`, `fsCommBusCall(name, buf, size, flags)`; `FsCommBusBroadcast_JS = 1`. The call is delayed and gives no delivery confirmation.
- Standalone module: placed in the package `modules` subfolder, loaded automatically; entry points `extern "C" MSFS_CALLBACK void module_init(void)` and `module_deinit(void)`; must link `MSFS_WasmVersions.a` to be seen as a 2024 module (automatic with the 2024 toolset).
- SDK sample used as the build base: StandaloneModule.

## Record layouts (from the original bridge, which worked)

`SIMCONNECT_RECV_FACILITY_DATA`: 12-byte header, then UserRequestId @12, Type @24, ItemIndex @32, Data @40. Requested fields, in order, are tightly packed 4-byte aligned:

| Type id | Record | Bytes |
|---|---|---|
| 0 AIRPORT | LATITUDE f64, LONGITUDE f64, ALTITUDE f64 | 24 |
| 14 TAXI_POINT | TYPE i32, ORIENTATION i32, BIAS_X f32, BIAS_Z f32 | 16 |
| 15 TAXI_PARKING | TYPE, TAXI_POINT_TYPE, NAME, SUFFIX, NUMBER (u32), ORIENTATION, HEADING f32, RADIUS f32, BIAS_X f32, BIAS_Z f32 | 40 |
| 16 TAXI_PATH | TYPE i32, WIDTH f32, START i32, END i32, NAME_INDEX u32 | 20 |
| 17 TAXI_NAME | NAME char[32] | 32 |

BIAS_X / BIAS_Z are metres east / north of the airport reference. `lat = refLat + z/111320`, `lon = refLon + x/(111320 × cos(refLat))`. START and END index the taxi points in arrival order, except on a type 3 path (parking connector) where END indexes a parking spot. NAME_INDEX indexes the names in arrival order. Path types: 1 taxiway, 2 runway, 3 parking connector, others paint, road or closed. Parking label enum: 0 none, 1-9 parking by compass, 10 gate, 11 dock, 12-37 gate A-Z.

**Risk:** the 2024 SDK notes that some SimConnect structures changed size from 2020 ("members are the same but the size of some of them has been changed"). The module logs counts of each record type; if they are zero or odd, check record sizes first.

## Protocol

Documented at the top of `src/data/wasm-taxi.js`. Messages are small JSON strings (default chunk 6000 bytes, adjustable). The JS client assembles by `seq` in any order and completes when the meta, all chunks and the end message have arrived.

## Where it is used

- Taxiways page (3): `PS.facility.loadAirport(ident)` runs the SDK `FacilityLoader` (runways, gates) and the module (paths, parking) together and merges them; either may fail.
- Map page (6): `PS.facility.loadNearestIntoState()` uses the same loader so taxiways draw on the plot.
- The harness answers the CommBus events from `harness/taxi-sample.txt`, which is real output of the C++ core. `window.__noTaxiModule = true` simulates the module missing.

## Next steps once it runs in the sim

1. Record the module console lines (`[PusherTaxi] ...`) and the page's log in `feasibility-findings.md`.
2. Check parking labels and path counts against an airport you know.
3. If it works, feed `taxiSuggest.ts` (from the original app) with the layout to restore pushback suggestions (requirement E3).
