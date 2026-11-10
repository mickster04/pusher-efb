# Release checklist

Where the first release stands (pre-release tag `v0.2.15-pre`; working version in `package.json`). Tick items off here.

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

## Tested in the mock or by unit tests only

- [ ] Automatic airport reload after a long move (0.2.15 and later; the 0.2.14 run used the button). Test: on the Plan tab, teleport 5 km or more; the log shows `the aircraft is N km from where <ICAO> was loaded: loading the nearest airport`, then `loaded <ICAO> for the map`.
- [ ] The 3 degree nose-pitch stop during a push (it has not fired; pitch stayed within 0.12 degrees in the A330 and A380 pushes).
- [ ] The planner fix for a pin with a set heading straight back (no needless turnaround pin). Test: after a push finishes 10 to 20 m short of its end pin, set the end pin's heading with its handle so it points the way the aircraft already faces and press Start: it should be one straight push back, with no turnaround pin.
- [ ] Spanish in the sim (`es-ES` and `es-MX`): check long texts on buttons. Set the sim to Spanish or Spanish (Mexico), restart, and look at the Push and Settings tabs.

## Needs an owner or a tester

- [ ] **Boeing and smaller jets** (owner): tug, tiller, brake, ground services, and the beacon wait (it does not wait when the beacon cannot be read). So far only the A330, A320 and A380.
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
