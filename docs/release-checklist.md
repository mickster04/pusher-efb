# Release checklist

Open items before the first release, in the order we agreed. Tick them off here.

- [x] Licence: MIT (`LICENSE`, `THIRD_PARTY_NOTICES.md`, shipped in the package). Still to do: ask Palm Coasty to add a `LICENSE` file to the original Pusher repo and confirm the copyright line (the notices use "2026 Palm Coasty Simulations", taken from the original's `electron-builder.yml`), then adjust the notices if they differ.
- [ ] **Verify in the sim:** the files module 0.2.1 (rebuild with `npm run build:wasm`, rebuild the package, restart the sim, then Settings > Diagnostics shows Files module OK) and the Steam work-folder path (needs a Steam user).
- [ ] **Package metadata (reminder, owner to do):** Creator is "Pusher" and Manufacturer is empty in `PackageDefinitions/push-planner.xml`; choose a name, set a thumbnail, tidy the title, and decide on `VisibleInStore` (false means Community-folder only).
- [x] Airline themes: "not affiliated, colours approximate" is in the app (Settings > Colours) and the README.
- [x] Linter: `npm run lint`, part of `npm test`. CI is not needed: `npm test` is the one command, and build output is no longer committed.
- [ ] **Test across aircraft** (owner): at least a Boeing, an Airbus and a smaller jet, for tug, tiller, brake and ground services. B6 (tiller LVars) is still open.
- [x] Safety note: README "Safety".
- [ ] **Last step:** one version number (all three places), a tag and release notes.

## Deferred features

- F1 AI traffic: ignore or pause, and a "blocked ahead" warning (one piece of work, to build after more testing).
- G1/G2 ground services: verify per aircraft before relying on them.
- D6 save and load plans, B6 tiller LVars.
- Dropped: B7 learned yaw calibration, A2 aircraft info, A4 camera state. E4 (stand display) is done: the Push tab shows "AT GATE <name>".
