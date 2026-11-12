# Push Planner: release notes (draft)

Draft for the first release. Version in `package.json` (0.2.35 at the time of writing); the final version, the tag and the date are set at the release step in [release-checklist.md](release-checklist.md).

## What it is

An MSFS 2024 EFB app that plans a pushback on a map and drives the sim's tug along it. It runs on its own: no companion program, no setup beyond installing the package into the Community folder (two small WASM modules load at sim start, so restart the sim after installing).

## What it does

- **Plan** on a map of the airport: drop pins, rotate them, or pick one of the suggested pushes. The route is drawn with the tug's turn arcs and warns when the tug may not manage a turn.
- **Push**: the big button walks you through Call the tug, Release the brake and Beacon light on (anything you do yourself is skipped), then the push starts by itself. Pause, Resume and Stop are always to hand, and a popup shows them over the other EFB apps. At the end it sets the brake and dismisses the tug once an engine has started.
- **Return to gate** retraces the push. **Ground services** (bridge, fuel, baggage, catering, power) are buttons.
- Settings and your chosen colour theme are remembered between sim runs. 18 colour themes, a compact layout for small tablets, and English, German, French, Spanish (Spain) and Spanish (Mexico) in the sim's language.

## Tested in the sim

A330-900neo (Headwind), A320 (Fenix), A380, Boeing 787-10, Asobo 737 MAX, ATR 72-600, Cessna Caravan. Not yet tried: the 777, business jets, the Steam install path.

## Known issues

- **ATR 72-600**: the app cannot see its beacon; the beacon wait is hidden for that aircraft. A joystick or pedal binding on the parking brake can stop a push (see Settings > Parking brake if an aircraft's brake cannot be read).
- A rare plan can include a short forward leg that retraces ground just covered.
- The German, French and Spanish texts are machine drafts: corrections welcome.
- Hover help on disabled buttons does not show in the sim.

## Safety

The app moves a real aircraft in the sim by writing velocity variables. Use it parked at a stand and watch the aircraft: it does not see other aircraft, vehicles or obstacles.

## Not affiliated

Independent project; not affiliated with or endorsed by Microsoft, Asobo or any airline. Airline themes use approximate colours only.

## Licence

MIT. Parts derive from the original Pusher app, also MIT (see `THIRD_PARTY_NOTICES.md`).
