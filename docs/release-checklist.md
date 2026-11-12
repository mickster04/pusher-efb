# Release checklist

Where the first release stands (latest pre-release tag `v0.2.23-pre`; working version 0.2.35 in `package.json`; release notes draft in [release-notes.md](release-notes.md)). Tick items off here.

## Done and verified in the sim

- [x] Licence: MIT (`LICENSE`, `THIRD_PARTY_NOTICES.md`, shipped in the package).
- [x] Airline themes: "not affiliated, colours approximate" is in the app (Settings > Colours) and the README.
- [x] Linter and tests: `npm test` is the one command (lint, build, unit tests); the build also prints a `RESULT:` line naming the version.
- [x] Safety note: README "Safety".
- [x] Files module (saved theme files): works in the sim.
- [x] Translation through the sim's own `.loc` (Localization asset group, `Coherent.translate`), including accented letters (`'Roboto-Regular'` font).
- [x] Tug driving on the A330-900neo (Headwind), the A320 (Fenix), the A380 and the Asobo 737 MAX: steering, brake release, beacon wait, FlyByWire pushback switch-off, end of push, gate detection and Return to gate.
- [x] Automatic tug reconnect after the sim lets go of the tug: seen in a real push, which carried on without trouble.
- [x] Reload airport data button (map toolbar, on both Plan sub-tabs): loads the nearest airport after moving (the log shows EGLL loaded after NZCH).
- [x] Suggestions at other airports (junction rule: named taxiways and links count, unnamed apron lanes do not): checked in the logs at NZCH and EGLL.
- [x] Automatic airport reload after a long move, the 3 degree nose-pitch stop, and the straight-back planner fix (owner confirmed in the sim, 2026-11-10).
- [x] Push tab next-step main button with automatic start, the beacon readings, and the compact layout on the flight-deck tablet (831 x 558); the three-leg 787 push (258 m) ran through both changes of direction.
- [x] Settings, the chosen theme and the learned pivots are restored after a sim restart (`pushplanner-settings.json`), and the new footer (owner, 2026-11-11).
- [x] Pushes on the ATR 72-600 (needs the brake binding conflict removed and "Start without the beacon", see the README's known issues) and the Cessna Caravan (single leg, pivot about 0.7 m).
- [x] Boeing 787-10 push (the 787 profile, pivot 7 m): steering within 0.7 m, pitch steady.

## Still to confirm: translation only

- [ ] Spanish in the sim (`es-ES` and `es-MX`): check long texts on buttons. Set the sim to Spanish or Spanish (Mexico), restart, and look at the Push and Settings tabs.
- [ ] German and French text fit on buttons (the compact layout helps; look at the Push tab pills and the next-step button).

## Needs an owner or a tester

- [ ] **A 777 and a business jet** (owner), before a full release: tug, tiller, brake, ground services (a jet gets the 40 m turn radius and the 15 m gate radius, which the Caravan did not exercise). So far the A330, A320, A380, 787, Asobo 737 MAX, ATR 72-600 and Caravan have been pushed.
- [ ] **ATR profile** (optional): a full ATR push with detailed logging, then add the learned pivot (about 3.5 m) to `src/push/aircraft-profiles.js`.
- [ ] **0.2.35 in the sim** (owner): the ATR brake with the controller binding removed, the hidden ATR beacon, the Ignore-the-parking-brake setting, the tug pill going to TUG OFF after Finish, the per-leg route log.
- [ ] **Steam work-folder path** (needs a Steam user).
- [ ] **Native review** of German, French, Spanish (Spain) and Spanish (Mexico): all machine drafts. Release notes and the README ask the community for corrections.
- [x] **Package metadata** (owner): title "Push Planner", Creator "Mike Cleaver", Manufacturer "Tuatara Airlines" and `VisibleInStore` false (Community-folder only) are set; still check the `ContentInfo` thumbnail matches the current icon.
- [ ] **Documentation** is up to date as of 0.2.35 (README, app-design, BUILDING, data-formats, release-notes); re-read the README's Known issues before tagging.
- [ ] **Release step** (last, only then): one version in `package.json` (the build copies it into the package definition and the app; `test/version.test.mjs` fails if they differ), a git tag, and release notes.

## Decided to leave for now

- Hover text (`title`) on disabled buttons does not show in the sim's browser. It stays in the code (harmless, and it works in a normal browser). If users ask for explanations, show the reason as text under the button instead.
- The sim letting go of the tug about 90 m along a route (both A330 runs at the same spot): the app now logs the pushback state and position when it happens (`the sim let go of the tug at <lat>, <lon>`) and reconnects. Revisit only if the snapshot shows a cause worth working around.

## Deferred features

- F1 AI traffic: ignore or pause, and a "blocked ahead" warning (one piece of work, to build after more testing).
- G1/G2 ground services: verify per aircraft before relying on them.
- D6 save and load plans, B6 tiller LVars.
- A "same spot, facing another way" suggestion (for example facing north where "straight back" ends): the no-two-suggestions-end-within-12-m rule hides it.
- Dropped: B7 learned yaw calibration, A2 aircraft info, A4 camera state. E4 (stand display) is done: the Push tab shows "AT GATE <name>".
