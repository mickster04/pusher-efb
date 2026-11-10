# Data formats and migration

Push Planner writes two kinds of file into the files module's work folder (next to each other, `Packages/.../work` for the module). Both carry a **format number** and the **app version** that wrote them, so a future version knows what it is reading and how to bring it up to date.

| File | Written by | Format field | App field |
|---|---|---|---|
| `pushplanner-settings.json` | `src/core/persist.js` | `v` (whole number) | `app` (e.g. `"0.2.34"`) |
| `<theme>.json` (a saved theme) | `saveTheme` in `src/ui/theme.js` | `format` (whole number) | `app` |

The package's own preset themes (`src/themes/*.json`) go through the same reader; they carry no number, which means format 1.

## Rules

- **No number means format 1**, the first one. Every file written before the numbers existed is read as format 1.
- **The format number only changes for a break:** a field renamed, removed or given a new meaning, a value's type changed. Adding an optional field is not a break (old apps ignore it, new apps default it).
- **The app version is for information** (to say who wrote the file in a log or a bug report). Migration is decided by the format number alone.
- **Older format: migrate on read.** `PS.migrate(obj, key, current, steps)` walks the file up one step at a time, `steps[n]` turning format *n* into *n+1*, and the file is rewritten in the current format by the normal save.
- **Newer format: read what is understood, never overwrite.** An older app meeting a file from a newer format reads the fields it knows and does not write the file back (settings file: writing is switched off for the session; a theme file is only read). It logs `... is format N, newer than this app`. A theme from a newer format that does not validate fails with "made by a newer version of the app: theme format N".
- **A missing step** (no way from format *n* to the current one) is reported in the log and the file is left alone.

## How to make a breaking change

1. Decide the change, say a settings key `requireBeacon` becomes `beaconMode` with three values.
2. Raise the current number: `SCHEMA` in `src/core/persist.js` (settings) or `THEME_FORMAT` in `src/ui/theme.js` (themes), say from 1 to 2.
3. Add the step that turns the old shape into the new one, in `STEPS` (settings) or `THEME_STEPS` (themes):

   ```js
   STEPS[1] = function (o) {
     // format 1 -> 2
     o.settings.beaconMode = o.settings.requireBeacon ? 'wait' : 'ignore';
     delete o.settings.requireBeacon;
     return o;
   };
   ```
   The step gets its own copy of the file, may change it freely and must return the new object. `PS.migrate` sets the new number itself.
4. Add a test beside the existing `migrate` tests in `test/persist.test.mjs` with a real format 1 file as it was written.
5. Keep every step: a file from any earlier format is walked through all of them.
6. Note the change in the release notes (a user going back to an older app keeps their file untouched, as described above).

## What is in each file (format 1)

**`pushplanner-settings.json`**: `v`, `app`, `settings` (every Settings value by name), `theme` (`id`, `custom` colours, `customMap` map widths), `learned` (per aircraft model: `pivotM`, `pushes`, `at`), `speedPercent`.

**A saved theme**: `format`, `app`, `id` (`saved-...`), `name`, `note`, `page` (colour roles in groups), `map` (path colours and widths, labels). Older map shapes (`map.lines`, a flat `map`) still load; they are format 1 as written before the numbers.
