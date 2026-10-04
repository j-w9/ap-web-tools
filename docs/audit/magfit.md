# Audit: MAGFit

Port: `apps/magfit`. Upstream: `upstream/MAGFit/` (`index.html`, `magfit.js`, `wmm.js`,
`quaternion.js`, `params.json`), plus `Libraries/Array_Math.js`, `Libraries/Param_Helpers.js`,
`Libraries/DecodeDevID.js`, `Libraries/FileSaver.js`, the vendored ml-matrix build and the
JsDataflashParser.

Standard: [`docs/porting-policy.md`](../porting-policy.md). The maths is compared by oracle tests that
run upstream `magfit.js`, `wmm.js`, `quaternion.js` and the shared libraries in a `node:vm` context with
a stub DOM and the real upstream parser (`src/test-utils/upstream.ts`). Shared packages used:
`@apwt/dataflash` (parsing), `@apwt/signal` (`linearInterp`, `arrayMean`, `arrayAll*`),
`@apwt/ardupilot` (`compassParamNames`, `paramToString`/`paramLine`, `decodeDevId`). No shared package
was changed in this audit.

Status values: **identical** (same result, possibly restructured code), **presentation**,
**convenience** (added or changed UX that changes no computed result), **browser-forced**,
**reverted-in-this-audit** (port changed to match upstream).

## Inventory

### Loading (`load`, `extractLatLon`, `wmm.js`)

| Upstream item                                                                                                                                                                          | Port location                                                | Status                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "No compass data in log" when MAG has no instances                                                                                                                                     | `analysis/load.ts` `loadMagFitLog`                           | identical                                                                                                                                                                            |
| MAG instances 0..2: `orig` (MagX/Y/Z), `time`, param names, start/end times                                                                                                            | `analysis/compass.ts` `loadCompass`                          | identical (oracle)                                                                                                                                                                   |
| `get_param_value` (last value wins); missing parameter = `undefined`                                                                                                                   | `analysis/params.ts` `readCompassParams` (NaN)               | identical (oracle with missing `COMPASS_ORIENT`, `COMPASS_ORIENT2`, `COMPASS_SCALE2`, `EK3_PRIMARY`)                                                                                 |
| Calibration removal: minus MOX/Y/Z, inverse iron (unless all diagonals 0), `/scale` if `scale_valid`, minus OfsX/Y/Z, inverse rotation for external compasses with a known orientation | `analysis/calibration.ts` `removeCalibration`                | identical (oracle)                                                                                                                                                                   |
| Missing iron parameter: ml-matrix throws "Input data contains non-numeric values" and the load stops                                                                                   | `removeCalibration`                                          | **fixed (proven upstream bug)** when the whole DIA/ODI set is absent (iron step skipped, oracle against upstream with those parameters 0); a partial set still throws the same error |
| `extractLatLon`: last ORGN instance 0, else last POS, else `[undefined, undefined]`                                                                                                    | `analysis/location.ts` `logLocation`                         | **reverted-in-this-audit** (port added a GPS fallback, which changed which data is used; removed)                                                                                    |
| Empty ORGN/POS column gives NaN                                                                                                                                                        | `location.ts` `last`                                         | **reverted-in-this-audit** (port returned "no location")                                                                                                                             |
| `expected_earth_field_lat_lon` / `get_mag_field_ef` / `interpolate_table`, bounds, quaternion rotation of `[intensity*1000, 0, 0]`                                                     | `analysis/wmm.ts`                                            | identical (oracle over the whole table)                                                                                                                                              |
| NaN lat/lon passes the bounds checks and crashes on the table lookup                                                                                                                   | `wmm.ts` `cell` throws                                       | **reverted-in-this-audit** (port returned `undefined`, giving the "Could not get earth field" message instead of stopping as upstream does)                                          |
| Alert "Could not get earth field for Lat: … Lng: …"                                                                                                                                    | `loadMagFitLog` error                                        | identical text (oracle)                                                                                                                                                              |
| Attitude sources: AHR2 → "DCM", NKQ[0] → "EKF 2 IMU 1", XKQ[`EK3_PRIMARY` or 0] → "EKF 3 IMU n"; default = match of `AHRS_EKF_TYPE`; a single source is selected and disabled          | `analysis/attitude.ts` `loadAttitudeSources`, `ui/Rail.tsx`  | identical (single-source chip disabled in this audit)                                                                                                                                |
| Missing quaternion column crashes upstream (`Array.from(undefined)`)                                                                                                                   | `attitude.ts` `load` throws                                  | **reverted-in-this-audit** (port silently skipped the source)                                                                                                                        |
| "Unknown attitude source" when none                                                                                                                                                    | `loadMagFitLog`                                              | identical                                                                                                                                                                            |
| Battery current: BAT instance 0 only, skipped if all NaN or all 0, name "Battery 1 current", type 2                                                                                    | `analysis/motor.ts` `loadMotorSources`                       | identical                                                                                                                                                                            |
| Current resampled with `linear_interp(value, time, MAG_Data[i].time)` where `i` is the battery index (0) for every compass                                                             | `motor.ts` `motorSourceAt`, `load.ts` (`atCompass`)          | **fixed (proven upstream bug)**: each compass uses its own times; oracle asserts upstream's compass-1 resample                                                                       |
| Battery current without MAG instance 0 crashes upstream                                                                                                                                | `load.ts` (`atCompass`)                                      | **fixed (proven upstream bug)**: loads and fits (oracle asserts the upstream crash)                                                                                                  |
| Missing BAT Curr/TimeUS column crashes upstream                                                                                                                                        | `loadMotorSources` throws                                    | **reverted-in-this-audit** (port skipped)                                                                                                                                            |
| Flight data plot: ATT Roll/Pitch, RATE AOut, POS RelHomeAlt on four axes                                                                                                               | `analysis/flight-data.ts`, `ui/traces.ts` `flightDataTraces` | identical / presentation                                                                                                                                                             |
| TimeStart/TimeEnd filled with the exact first/last compass sample time                                                                                                                 | `App.tsx` `fullRange` (text inputs)                          | **reverted-in-this-audit** (port rounded to whole seconds, changing the analysis window)                                                                                             |
| Device line (`decode_devid`, DroneCAN form), Use / External / Health flags                                                                                                             | `ui/CompassCard.tsx`, `@apwt/ardupilot` `describeDevId`      | presentation (words instead of emoji)                                                                                                                                                |
| Per compass: "Use sensor" radio (No change / Use / Don't use), "Orientation" radio (Check / Fix 90 / Fix 45, disabled unless `rotate`), orientation change recalculates immediately    | `CompassCard.tsx`, `App.tsx`                                 | identical                                                                                                                                                                            |
| Calibration checkboxes: Existing (ticked), then per fit group Offsets / Offsets and scale / Offsets and iron                                                                           | `CompassCard.tsx`, `ui/calibrations.ts`                      | identical / presentation (chips)                                                                                                                                                     |
| `document.title = "MAGFit: " + file.name`                                                                                                                                              | `App.tsx`                                                    | identical                                                                                                                                                                            |

### Calculation (`calculate`)

| Upstream item                                                                                                                                                                                                                   | Port location                                                  | Status                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `select_body_frame_attitude`: cached until the source radio changes; `array_slerp`, `get_body_frame_ef`, attitude yaw, existing error, existing yaw (`get_yaw`)                                                                 | `analysis/magfit.ts` `prepareAttitude`, `analysis/expected.ts` | identical (oracle)                                                                                                                         |
| "No attitude source selected"                                                                                                                                                                                                   | `App.tsx` warning, Calculate disabled until a source is chosen | presentation (same text)                                                                                                                   |
| `calculate_bins`: 80-point Fibonacci lattice, nearest bin                                                                                                                                                                       | `analysis/bins.ts` `assignBins`                                | identical (oracle)                                                                                                                         |
| A sample matching no bin (NaN field) is `undefined`                                                                                                                                                                             | `assignBins` returns -1                                        | identical                                                                                                                                  |
| `get_weights`: `undefined` bin counted in the total, never as a unique bin, weight NaN                                                                                                                                          | `bins.ts` `binWeights`                                         | **reverted-in-this-audit** (port counted -1 as an occupied bin; oracle)                                                                    |
| `find_start_index` / `find_end_index` from `parseFloat` of the inputs, range `[start, end+1)`                                                                                                                                   | `analysis/time-range.ts`                                       | identical (oracle incl. empty input → NaN)                                                                                                 |
| Window edge cases: equal start/end, end before start (crash: invalid array length / singular matrix), empty inputs                                                                                                              | `runFits` throws where upstream throws                         | identical (oracle)                                                                                                                         |
| `check_orientation`: rotations 0..43 except 38, 41; 45° only with Fix 45; mean-offset weighted error; stable sort; cost ratio > 2; fix or alert text                                                                            | `analysis/orientation.ts`                                      | identical (oracle incl. alert text)                                                                                                        |
| Orientation summary logged to console                                                                                                                                                                                           | `CompassCard.tsx` orientation note                             | convenience (shown on the page)                                                                                                            |
| `fit`: offsets, offsets+scale, offsets+iron, each with motor columns for the current source; `params_valid` ranges; `evaluate_fit` defaults; weighted RMS; yaw                                                                  | `analysis/fit.ts` `fitCompass`                                 | identical (oracle, every parameter and series; separate exactly-sized matrices give the same ml-matrix results as upstream's narrowed one) |
| Coverage `num_unique / 80`                                                                                                                                                                                                      | `CompassCard.tsx` meter                                        | identical / presentation                                                                                                                   |
| Default tick: first valid fit of the no-motor group, re-ticked on every calculation                                                                                                                                             | `ui/calibrations.ts` `initialSelection`, `reconcileSelection`  | identical                                                                                                                                  |
| Invalid fit: checkbox disabled but left ticked; `Object.assign` keeps the previous plot data                                                                                                                                    | `calibrations.ts`, `App.tsx`                                   | left ticked: identical; stale plot data **fixed (proven upstream bug)**: an invalid fit draws nothing                                      |
| `param_selection` rebuilt in fit order by `redraw`: after recalculating the first ticked fit in upstream order is saved                                                                                                         | `reconcileSelection`                                           | **fixed (proven upstream bug)**: the port keeps the pick order (oracle asserts upstream's reset)                                           |
| `update_hidden`: newly ticked fit moves to the front; unticking falls back to the next ticked one                                                                                                                               | `toggleCalibration`, `savedCalibration`                        | identical (oracle)                                                                                                                         |
| Error bars: every compass visible after a calculation; a compass with nothing ticked hidden after a tick change                                                                                                                 | `errorBarsVisible`, `traces.ts` `errorBarTraces`               | **reverted-in-this-audit** (port never hid bars)                                                                                           |
| `update_shown_params`: parameter table shows the saved fit, else the existing calibration                                                                                                                                       | `ui/params-table.ts`, `ParamTable.tsx`                         | identical / presentation (changed values highlighted)                                                                                      |
| Plots: x/y/z field with "Expected", field error, heading change vs existing, heading vs attitude source, field length with expected line, battery current, error bars; time axes linked; x range from the inputs at calculation | `ui/traces.ts`, `App.tsx`                                      | identical data / presentation                                                                                                              |
| Heading-change plot: hidden zero-width "existing" trace kept only so line colours match across plots                                                                                                                            | `traces.ts` `yawVsExistingTraces`                              | presentation (colours are assigned explicitly instead)                                                                                     |
| Flight data plot zoom: autorange on load, parsed inputs after an input edit; zooming it fills the inputs with `floor`/`ceil` and enables Calculate                                                                              | `App.tsx` `plotRange`, `onFlightRelayout`                      | identical (changed in this audit; the port previously zoomed to the inputs at all times)                                                   |

### Saving (`save_parameters`, `check_params`)

| Upstream item                                                                                                                         | Port location                                                      | Status                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per compass: first shown selection; `check_params` warning (ranges, orientation change); `confirm`                                    | `ui/save.ts` `saveCandidates`, `nextSaveStep`; `App.tsx` OK/Cancel | **reverted-in-this-audit** (port had no confirm step and no way to decline one compass; now the same text and OK/Cancel per compass, declined compass skipped) |
| Orientation compare with `!=` (two missing values are equal)                                                                          | `analysis/params.ts` `checkParams`                                 | **reverted-in-this-audit** (NaN !== NaN reported a change)                                                                                                     |
| Motor type conflict alert, checked in compass order after each confirm                                                                | `params.ts` `motorCompType`, `nextSaveStep`                        | identical                                                                                                                                                      |
| Lines: offsets, diagonals, off-diagonals, motor, scale, orientation; optional `COMPASS_USEx`; `COMPASS_MOTCT` last; `param_to_string` | `params.ts` `compassParamLines`, `buildParamFile`                  | identical (oracle, file text)                                                                                                                                  |
| `param_to_string(undefined)` throws (missing orientation parameter)                                                                   | `buildParamFile` returns an error                                  | **fixed (proven upstream bug)**: the save stops with "COMPASS_ORIENT… is not in the log" (oracle)                                                              |
| "No parameters to save", "Saved:\n\tCompass n: …" alerts; file `MAGFit.param`                                                         | `App.tsx` save status                                              | identical text                                                                                                                                                 |
| Calculate / Save buttons: Save disabled while a recalculation is pending                                                              | `App.tsx`, `Rail.tsx`                                              | identical                                                                                                                                                      |

## Remaining intentional differences

- **Presentation**: CustomBuild layout, chips instead of checkboxes and radios, words instead of emoji
  for Use/External/Health, a coverage meter with percentage, explicit plot colours (so the hidden
  "existing" trace is not needed), a log facts panel (location, earth field, declination,
  inclination: values upstream computes and logs to the console), a "Parameters to save" table with
  changed values highlighted and the pending `check_params` warnings shown before saving.
- **Convenience**: the orientation check summary (upstream `console.log`) is shown per compass;
  mean error per calibration on its chip; an "(save)" marker on the calibration that will be saved.
- **Crashes**: where upstream throws (NaN location, a partial iron parameter set, missing columns,
  degenerate windows), the port shows the error and produces no result. The proven crashes are fixed
  (see below).
- `alert`/`confirm` are in-page messages with the same text and choices.

## Proven upstream bugs fixed

Verdicts and tests: [`../bug-proofs/magfit.md`](../bug-proofs/magfit.md).

1. **Battery current resampled on compass 1's time base for every compass** (and the crash without
   compass 1). The port resamples the current on each compass's own times and loads logs without
   compass 1.
2. **Invalid fits keep stale plot data** (stale traces only). An invalid fit has no plot data; it stays
   ticked and can be saved, as upstream.
3. **Recalculating forgets the pick order.** The pick order survives a recalculation, so the most
   recently ticked fit is still the one saved, as the tooltip says.
4. **Missing iron parameters crash the load** when the whole `COMPASS_DIA*`/`ODI*` set is absent: the
   iron step is skipped. A partial set still stops with upstream's error.
5. **Missing orientation parameter crashes saving.** The save stops with a message naming the
   parameter.

## Upstream bugs reproduced

1. **Invalid fits stay ticked.** `show.disabled = true` does not untick, so an invalid fit's parameters
   are saved if it is the first ticked fit (not proven: upstream saves out-of-range values on purpose
   after a confirm).
2. **NaN location crashes.** `get_mag_field_ef` compares NaN against the bounds (all false) and
   `interpolate_table` then indexes `table[NaN]` (not reachable through the tool: the parser drops
   types with no records).
3. **Partial iron parameter set crashes the load.** `array_all_equal([undefined, …], 0)` is false, so
   the matrix is built from `undefined` and ml-matrix throws. Reproduce: log without `COMPASS_DIA3_X`
   (oracle).
4. **Samples without a bin.** `calculate_bins` leaves `bins[j]` undefined when the expected field is NaN;
   `get_weights` counts it in the total but not as a unique bin and gives it a NaN weight
   (`count[undefined]` arithmetic), making every fit NaN.
5. **Window with end before start** gives a negative sample count (`new Array(-n)` throws); equal or
   one-sample windows give singular matrices. No message other than the generic error.
6. Implicit globals (`j` in `find_start_index`/`find_end_index`, `i` and `ret` in `get_body_frame_ef`)
   do not change results (no caller shares those names in scope); recorded for completeness.

## Tests added in this audit

`src/analysis/oracle.test.ts`: oracle cases for compasses on different time bases/rates (motor source
compared), missing parameters, load failures (missing iron parameter, battery without compass 1,
missing location text), analysis window edge cases (equal, reversed, empty, partially empty, short),
selection and save priority across a recalculation; motor source series compared for every group.
`bins.test.ts`: `get_weights` with undefined bins, NaN field binning, NaN window inputs.
`wmm.test.ts`: NaN location throws like upstream. `load.test.ts`: compass 1 requirement for current
fits. `ui.test.ts`: stale data of invalid fits, error bar visibility, confirm/decline save steps.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in both themes, in three states: empty,
`copter-sitl.bin` and the new `test-fixtures/ui-three-compasses.bin` (three compasses with known
errors and battery current, so every fit has a result; built by `src/ui-fixture.test.ts` from the
existing synthetic log builder). Every section was read from the captures; keyboard use of the
compass cards' chips and the rail was checked. The harness reports no findings.

Changed (presentation only):

- "No attitude, throttle or altitude in this log. Set the analysis window in the panel." on an
  empty flight data plot (the synthetic log has none, so there was nothing to zoom).
- The analysis window inputs are wider (170 px): they hold the unrounded log start and end times
  upstream writes, which were cut off at 110 px.
- Phone width: legends above the plots, and the flight data plot keeps only the roll and throttle
  axes (`ui/Chart.tsx`).

Remaining known issues:

- The start time can still be longer than the input (e.g. `1.0999999999999999`); it is upstream's
  value and is not rounded, since the input's text is what the calculation parses.
- The rail is taller than a laptop screen and scrolls inside its sticky card (shell behaviour).
