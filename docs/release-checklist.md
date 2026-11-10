# Release checklist

Where the first release stands (latest pre-release tag `v0.2.23-pre`; working version in `package.json`). Tick items off here.

## Done and verified in the sim

- [x] Licence: MIT (`LICENSE`, `THIRD_PARTY_NOTICES.md`, shipped in the package).
- [x] Airline themes: "not affiliated, colours approximate" is in the app (Settings > Colours) and the README.
- [x] Linter and tests: `npm test` is the one command (lint, build, unit tests); the build also prints a `RESULT:` line naming the version.
- [x] Safety note: README "Safety".
- [x] Files module (saved theme files): works in the sim.
- [x] Translation through the sim's own `.loc` (Localization asset group, `Coherent.translate`), including accented letters (`'Roboto-Regular'` font).
- [x] Tug driving on the A330-900neo (Headwind), the A320 (Fenix) and the A380: steering, brake release, beacon wait, FlyByWire pushback switch-off, end of push, gate detection and Return to gate.
- [x] Automatic tug reconnect after the sim lets go of the tug: seen in a real push, which carried on without trouble.
- [x] Reload airport data button (map toolbar, on both Plan sub-tabs): loads the nearest airport after moving (the log shows EGLL loaded after NZCH).
- [x] Suggestions at other airports (junction rule: named taxiways and links count, unnamed apron lanes do not): checked in the logs at NZCH and EGLL.
- [x] Automatic airport reload after a long move, the 3 degree nose-pitch stop, and the straight-back planner fix (owner confirmed in the sim, 2026-11-10).
- [x] Push tab next-step main button with automatic start, the beacon readings, and the compact layout on the flight-deck tablet (831 x 558); the three-leg 787 push (258 m) ran through both changes of direction.
- [x] Boeing 787-10 push (the 787 profile, pivot 7 m): steering within 0.7 m, pitch steady.

## Still to confirm: translation only

- [ ] Spanish in the sim (`es-ES` and `es-MX`): check long texts on buttons. Set the sim to Spanish or Spanish (Mexico), restart, and look at the Push and Settings tabs.
- [ ] German and French text fit on buttons (the compact layout helps; look at the Push tab pills and the next-step button).

## Needs an owner or a tester

- [ ] **A 737 or 777 and a smaller jet** (owner), before a full release: tug, tiller, brake, ground services. So far the A330, A320, A380 and 787 have been pushed.
- [ ] **Steam work-folder path** (needs a Steam user).
- [ ] **Native review** of German, French, Spanish (Spain) and Spanish (Mexico): all machine drafts. Release notes and the README ask the community for corrections.
- [ ] **Package metadata** (owner): Creator "Mike Cleaver" and Manufacturer "Tuatara Airlines" are set; decide on the title and `VisibleInStore` (false means Community-folder only); check the `ContentInfo` thumbnail matches the current icon.
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
