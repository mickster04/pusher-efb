# Third-party notices

Push Planner as a whole is licensed under the MIT licence in `LICENSE`. Some of it was derived from the original **Pusher** desktop app (MSFS pushback manager; its Credits page says "Built by Palm Coasty Simulations" and "Pusher is open source (MIT)"). Those parts stay under the licence of the original, reproduced below, which also covers our changes to them.

The original repository we started from carried no `LICENSE` file, only that statement of intent. The original's installer configuration (`electron-builder.yml`) states "Copyright © 2026 Palm Coasty Simulations", so that year and name are used below. If the copyright holder states something different, it replaces the line below.

## What is derived from Pusher

| Here | Derived from |
|---|---|
| `src/planning/route-planner.js` | `apps/windows/src/mapGeo.ts` (planned route code) |
| `src/planning/push-suggest.js` | `apps/windows/src/taxiSuggest.ts` |
| `test/fixtures/suggest-golden.json` | output of the original suggester (used by `test/suggest.test.mjs`) |
| `src/push/follow.js` | the bridge's pure-pursuit steering and constants (`bridge/`) |
| `src/push/tug.js` | `bridge/TugDrive.cs` and the brake handling in `bridge/SimService.cs` |
| `src/data/taxi-data.js` | the original's taxiway data shapes |
| `wasm/src/taxi_core.h`, `wasm/src/module.cpp` | record layouts and requested fields from `bridge/TaxiwayService.cs` |
| `docs/implementation/pusher-internals.md` | a summary of the original's source |

Everything else (the map drawing, themes, Diagnostics, the files module, settings, plan and pin UI, toasts and the app shell) was written for Push Planner.

## Pusher licence (MIT)

MIT License

Copyright (c) 2026 Palm Coasty Simulations

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
