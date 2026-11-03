# Original Pusher internals the port must reproduce

Source of truth is the sibling repo `../msfs-pusher-main` (C# bridge in `bridge/`, shared types in `packages/shared/api/types.ts`, UI in `apps/windows/src`). This file records the details that are easy to miss. Check the named file for the current value before relying on a number.

## Driving the tug (`bridge/TugDrive.cs`, `bridge/Constants.cs`)

- The sim's own tug is attached with the `TOGGLE_PUSHBACK` key event. **`PUSHBACK WAIT` is pinned to 1 before `TOGGLE_PUSHBACK`**, otherwise the sim tug starts reversing by itself.
- Body velocity is **not sticky**: it must be rewritten every tick or the aircraft coasts to a stop. Each tick writes:
  - `PUSHBACK WAIT` (bool) = wait flag
  - `VELOCITY BODY Y` = 0 and `ROTATION VELOCITY BODY X` = 0 (both with unit `feet per second`)
  - `VELOCITY BODY Z` = forward/reverse speed (`feet per second`)
  - `ROTATION VELOCITY BODY Y` = yaw rate in **rad/s**, computed as `rotation × RotationToRotY (0.002) × tugSpeed`, where `tugSpeed` is in speed units (velocity ft/s = speed units × 0.2) and keeps its sign, so reversing flips the turn direction. At rotation 1 and cruise speed 25 this is about 0.05 rad/s, or 2.9 deg/s. The original writes it through SimConnect with unit `feet per second` (a numeric hack). An earlier version of this note omitted the speed factor; the first EFB spike followed that and wrote a turn rate about 25 times too small, so the tug pushed straight.
- The wait flag has hysteresis: wait turns on below speed 0.02 and off above 0.08 (`WaitOnBelowSpeed`, `WaitOffAboveSpeed`).
- Speed: speed factor 5–50 (default 25), `SpeedUnitToFtPerSec` = 0.2, ramp to cruise in `SecondsToCruise` = 0.35 s. Rotation ramps at 1.7 per second; max rotation 2.2 (manual) and 3.0 (auto). Tick delta is clamped between 0.01 s and 0.12 s.
- The parking brake holds the drive command at 0; a latched drive command waits (`waitingForBrake`) until the brake is released.
- Not driven while airborne: AGL above 25 ft aborts.
- After attaching, the tug needs a settle time (500 ms normally, 10.5 s on a fresh attach) before commands are trusted. Steering is returned to neutral over 8 frames, 50 ms apart.
- Tiller LVars are reset to 0 each drive tick (`SimNames.TillerLvars`): `L:A32NX_TILLER_HANDLE_POSITION`, `L:A32NX_HYD_NOSE_WHEEL_ANGLE`, `L:STEERING_ANGLE`, and others in `Constants.cs`.
- The sim detaching the tug (for example the user takes over) must stop the push at once (commit `05ef7c5`).

## Native tug heading (the fallback)

`KEY_TUG_HEADING` takes a 32-bit unsigned value mapping 0..360°: `value = 11930465 × headingDeg` (wrapped to 32 bits). The original app uses it alongside the velocity writes. A pure-native mode (heading events only, no velocity writes) is the fallback if per-tick writes cannot be done; speed control in that mode is unproven.

## Parking brake (`bridge/SimService.cs`, `Constants.cs`)

- Read `BRAKE PARKING POSITION` in `percent over 100`, and also as bool; some aircraft need LVars. Probed LVars include `L:A32NX_PARK_BRAKE_LEVER_POS`, `L:A32NX_PARKING_BRAKE_LEVER_POS`, `L:A32NX_PARK_BRAKE`, `L:XMLVAR_PARK_BRAKE_POS`, `L:S_OH_ELEC_PARK_BRAKE`, `L:N_PED_PARKBRAKE`, `L:B21_PARKING_BRAKE`.
- Setting writes both units and every LVar candidate, ignoring failures. The bridge caches which LVar name worked per aircraft.

## Telemetry set (`SimService.cs`)

`PLANE LATITUDE/LONGITUDE` (degrees), `PLANE HEADING DEGREES TRUE`, `PLANE ALTITUDE` (feet), `PLANE ALT ABOVE GROUND` (feet), `GROUND VELOCITY` (knots), `AIRSPEED INDICATED` (knots), `VERTICAL SPEED` (feet per minute), `SIM ON GROUND` (bool), `GENERAL ENG COMBUSTION:1` (bool), `PUSHBACK ATTACHED` (bool), `CAMERA STATE` (enum), strings `TITLE`, `ATC MODEL`, `ATC AIRLINE`, `ATC FLIGHT NUMBER` (cached, re-read rarely).

**At gate** = on ground, ground speed below `AtGateMaxGroundSpeedKt`, and no tug attached (`IsAtGate` in `bridge/Program.cs`). It needs no airport data.

## Key events used (`SimEventService.cs`, `JetBridgeService.cs`)

`TOGGLE_PUSHBACK`, `KEY_TUG_HEADING`, `AXIS_STEERING_SET`, `STEERING_SET`, `RUDDER_SET`, `PARKING_BRAKES`, and jet bridge and services events: `TOGGLE_JETWAY`, `REQUEST_FUEL_KEY`, `REQUEST_LUGGAGE`, `REQUEST_CATERING`, `REQUEST_POWER_SUPPLY`. There is also a request-boarding endpoint; check `JetBridgeService.cs` for the event it sends. `TOGGLE_JETWAY` is used for both attach and detach (it is a toggle).

## Auto pushback (`bridge/PushbackController.cs`, ~2,100 lines)

- Waypoint: `{ id, label, lat, lon, headingDeg?, headingUser?, leadInM?, drive: auto|forward|reverse, terminal?, seq }` (see `packages/shared/api/types.ts`).
- Follows a route with curves, cusp (direction flip) handling, lead-in straight lines, auto speed (slow in turns, crawl at the stand), and an end-pin approach with a time limit (`MaxEndPhaseSec`, warning at `EndPhaseWarnSec`).
- Route tick is 20 ms (`RouteTuning.TickMs`), with lag resync after 100 ms. This tick rate is the main feasibility question for JS.
- Yaw response is learned during the push (`bridge/YawCalibration.cs`): `measured = gain × commanded + offset` per direction and turn side, weighted prior of 6 samples, decay 0.97, gain clamped 0.5–1.3 and offset −0.8..0.8.
- Pause toggles, stop, disconnect tug, return to gate, and "set parking brake" prompts after completion.

## Taxiways (`bridge/TaxiwayService.cs`, `apps/windows/src/taxiSuggest.ts`)

- Data read through SimConnect facility data (reflection into SimConnect.NET). Shape: `TaxiwayLayout { icao, refLat, refLon, paths[], parking[] }`.
- Path: `{ name, type, widthM, points: [[lat, lon], [lat, lon]] }` (start and end of one stretch). Type: 1 taxiway, 2 runway, 3 parking connector, others are paint, roads and closed paths.
- Parking: `{ name, type, lat, lon, headingDeg, radiusM }`.
- Never touch SimConnect mid-push for taxiway requests; results cached per airport; request timeout and retry timers.
- `taxiSuggest.ts` is pure TypeScript and reusable. It suggests pushbacks along named taxiways, LINK stretches, lanes, compass directions, the opposite direction, straight back, and follows bends.

## AI traffic (`bridge/TrafficService.cs`)

Polled once a second: aircraft within a radius using `SimConnect_RequestDataOnSimObjectType` (type aircraft = 2). A push pauses while another aircraft is on the route ahead; the user can ignore it. Nothing equivalent is confirmed for JS.

## Overlay notifications (`bridge/OverlayService.cs`)

Kinds in use: `parking_brake` ("Release parking brake", persistent until the brake is released), `set_parking_brake` (asks for the brake), `parking_brake_set` (offers Dismiss tug and Return to gate), plus the distance-left toast with Pause/Resume, and the traffic-hold toast. Dismissals are remembered for a period so the same toast does not reappear immediately.

## Persistence

Plans: `PlanStore.cs` (JSON files; fields include id, name, airportIcao, updatedUtc, originLat/Lon, waypoints). Settings: `SettingsStore.cs` and `AppSettings` in the shared types. Settings and plan saving are **Could** priority in the port.

## Turn radius, speed and the planned arcs (checked in `bridge/Constants.cs` and `TugDrive.cs`)

- The tug's yaw rate is `rotation x 0.002 x tugSpeed` rad/s and its ground speed is `tugSpeed x 0.2` ft/s, so **the turn radius is `30.5 / rotation` metres whatever the speed**. Slowing down does not tighten an arc by itself; it shrinks the lag (the steering ramps at 1.7 rotation/s and is smoothed over about 200 ms) and the overshoot the steering has to correct.
- Rotation limits: manual 2.2, auto 3.0 (`AutoMaxRotation`), but the controller's own steering output is capped at 2.0 forward and 1.8 reverse (2.4 and 2.2 when recovering off the path, 1.8 near the end pin). So the tightest turn the controller will command is about 15 m forward and 17 m in reverse.
- The planned arcs use **40 m** (`PathTurnRadiusM`, which needs rotation 0.76), leaving more than twice that for corrections so cross-track fixes do not saturate the steering. A comment in `Constants.cs` records that planning at 26 m once made the tug run wide: the arc sat at the then reverse limit. The limits are higher now.
- Auto speed already slows in turns (`TurnSlowFullAlphaDeg` 60, `MinTurnSpeedFraction` 0.5, `CurveSpeedFwd` 0.6, `CurveSpeedRev` 0.55, never below `MinAutoSpeed` 8 speed units). That slowdown keeps the tug on the arc; it does not change the arc.
- **In the EFB plan** (`PS.plan`): it plans at 40 m, and where a corner is too cramped for that (the planner warns when the tightest arc is under 60% of the radius) it steps the radius down about 12% at a time to a **tightest allowed turn** setting (default 26 m, 10 to 40 m, saved in `localStorage` as `pushplanner.tightest`) and takes the first plan with no warning. The route summary says when it did. Whether the real tug follows a 26 to 30 m arc cleanly is **not yet measured**: that is the in-sim turn test (drive arcs at several rotation settings and speeds, log the measured radius) planned as the first drive feature of the Push tab. The follower should also slow in proportion when the planned radius is under 40 m.
