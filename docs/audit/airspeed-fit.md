# Audit: AirspeedFit

Port: `apps/airspeed-fit`. Upstream: `upstream/AirspeedFit/` (`index.html`, `airspeedfit.js`,
`airspeedfit_core.js`, `params.json`), plus `Libraries/Array_Math.js`, `Libraries/Param_Helpers.js`,
`Libraries/DecodeDevID.js`, `Libraries/FileSaver.js`, the vendored ml-matrix build and the
JsDataflashParser.

Standard: [`docs/porting-policy.md`](../porting-policy.md). `airspeedfit_core.js` is compared function
by function (`src/analysis/core.test.ts`); the whole tool (`airspeedfit.js` with a stub DOM, the real
parser and a stubbed `fetch`) is compared end to end (`src/analysis/oracle.test.ts`). No shared package
was changed in this audit.

Status values: **identical**, **presentation**, **convenience** (changes no computed result),
**browser-forced**, **reverted-in-this-audit**.

## Inventory

### Core (`airspeedfit_core.js`)

| Upstream item                                                                                                                            | Port location                 | Status                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------- |
| Constants, `isa_temperature_at_alt_c`, `air_temperature_c`, `eas2tas`, `density_altitude_m`                                              | `analysis/core.ts`            | identical (oracle)              |
| `auto_window` (quarter of mean dpress over the flight span, errors)                                                                      | `core.ts` `autoWindow`        | identical (oracle)              |
| `course_spread_deg`, `refine` (Gauss-Newton, ml-matrix solve/inverse, singular handling), `calibrate` (k0 seed, warnings and their text) | `core.ts`                     | identical (oracle, bit for bit) |
| `wind_smoother` (EKF + RTS, Joseph form, det guard)                                                                                      | `core.ts` `windSmoother`      | identical (oracle)              |
| `calibrate_combined` (median dt, stride, decimation, r_meas, alternating rounds, per-sensor stats)                                       | `core.ts` `calibrateCombined` | identical (oracle)              |

### Loading (`load`)

| Upstream item                                                                                                                          | Port location                                        | Status                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alerts: no ARSP instances, no XKF1/NKF1, no BARO, could not read EKF velocity, no POS, no usable airspeed data                         | `analysis/load.ts` `loadAirspeedLog` errors          | identical text and order                                                                                                                              |
| Velocity sources: XKF1 then NKF1 cores, name "EKFn core c", wind from XKF2/NKF2 of the same core; first ticked; single source disabled | `load.ts` `velocitySources`, `ui/Rail.tsx`           | identical                                                                                                                                             |
| Missing VN/VE/VD or VWN/VWE column crashes upstream                                                                                    | `velocitySources` throws                             | **reverted-in-this-audit** (port skipped the source / dropped the wind)                                                                               |
| BARO instance 0 else first instance; BARO without instance field crashes (`0 in undefined`)                                            | `load.ts`                                            | **fixed (proven upstream bug)**: a BARO without instance field is read as one barometer (oracle against upstream with the same records as instance 0) |
| POS time/RelHomeAlt/Alt; ATT roll for the plot                                                                                         | `load.ts`                                            | identical                                                                                                                                             |
| `STAT.isFlying` flight span; STAT without isFlying crashes                                                                             | `load.ts`                                            | identical / **reverted-in-this-audit** for the crash case                                                                                             |
| Field elevation and time (interpolated POS.Alt at first flying, else last POS.Alt)                                                     | `load.ts`                                            | identical (oracle)                                                                                                                                    |
| Takeoff lat/lng and UTC start for the weather lookup                                                                                   | `load.ts`                                            | identical (oracle)                                                                                                                                    |
| Temperature presets: ISA at field elevation, BARO.GndTemp at field time, Carbonix METAR `GCS:WX`                                       | `load.ts`, `analysis/temperature.ts`                 | identical (oracle)                                                                                                                                    |
| `set_temp_select`: order openmeteo, isa, baro, metar, Custom; default ISA, else first, else Custom (box unchanged)                     | `temperature.ts` `chooseTempSource`, `App.tsx`       | identical                                                                                                                                             |
| Box filled with `value.toFixed(0)`; editing the box selects Custom                                                                     | `tempBoxText`, `App.tsx`                             | identical                                                                                                                                             |
| ARSP instances sorted; ratio/use/devid parameter names; health all 1; primary = last Pri                                               | `load.ts` `airspeedSensor`                           | identical (oracle)                                                                                                                                    |
| Auto window from sensor 0 over the flight span, whole log on failure; inputs `floor`/`ceil`                                            | `load.ts` `autoWindow`                               | identical (oracle)                                                                                                                                    |
| Flight data plot zoomed to the exact (unrounded) auto window on load                                                                   | `load.ts` `autoWindowExact`, `App.tsx` `plotRange`   | **reverted-in-this-audit** (port zoomed to the rounded inputs)                                                                                        |
| Open-Meteo lookup (URL by recency, 5 s timeout, nearest hour), selected and recalculated when it returns                               | `analysis/weather.ts`, `io/open-meteo.ts`, `App.tsx` | identical (oracle with stubbed fetch)                                                                                                                 |

### Calculation and display

| Upstream item                                                                                                                                                                                             | Port location                                                | Status                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TimeStart/TimeEnd (`min 0`, `step 1`) read with `parseFloat`                                                                                                                                              | `App.tsx` (`Draft.window` text), `Rail.tsx`                  | **reverted-in-this-audit** (port used `Number()`, so an empty input was 0 instead of NaN; oracle with empty, partial, reversed and fractional windows)  |
| Ground temperature (`value 15`, `step 1`), "Enter a ground temperature before calculating"                                                                                                                | `App.tsx`                                                    | identical                                                                                                                                               |
| `build_combined` on sensor 0's grid, positive dpress for every sensor, EAS2TAS from lapsed ground temperature                                                                                             | `analysis/fit.ts` `buildCombined`                            | identical (oracle)                                                                                                                                      |
| Seeds with ≥ 4 samples, `run_wind_model` with `q = 10^slider`                                                                                                                                             | `fit.ts` `prepareFit`, `runWindModel`                        | identical (oracle)                                                                                                                                      |
| q slider `-3..0`, step 0.05, default -1.5; readout and hints; refit on release using the last resampled data                                                                                              | `WindControls.tsx`, `fit.ts` `qReadout`, `App.tsx` `commitQ` | identical                                                                                                                                               |
| Temperature readout (field elevation, density altitude, avg EAS2TAS) from the current inputs                                                                                                              | `temperature.ts` `temperatureReadout`                        | identical (oracle text)                                                                                                                                 |
| `sensor_series` before/after, RMS and mean                                                                                                                                                                | `fit.ts` `sensorSeries`                                      | identical (oracle)                                                                                                                                      |
| Plots: expected vs measured TAS, residuals, RMS bars with bias bars, wind with 1-sigma bands and EKF wind                                                                                                 | `ui/traces.ts`                                               | identical data / presentation                                                                                                                           |
| Bias bar for a sensor without a "before" series: `Math.abs(null)` = 0                                                                                                                                     | `traces.ts` `rmsBarTraces`                                   | **reverted-in-this-audit** (port drew NaN)                                                                                                              |
| Suggested parameters: ratio `toFixed(3)`, current ratio, change of the unrounded ratio; row text when no fit                                                                                              | `analysis/params.ts` `ratioSuggestions`, `ParamPanel.tsx`    | identical                                                                                                                                               |
| Non-finite fitted ratio: input empty, current ratio and "n/a" change still shown                                                                                                                          | `ratioSuggestions` (`ratio: null`)                           | **reverted-in-this-audit** (port showed "not enough valid samples")                                                                                     |
| Seed warnings, deduplicated in sensor order                                                                                                                                                               | `fit.ts` `seedWarnings`                                      | identical (oracle)                                                                                                                                      |
| Results hidden while a recalculation is pending                                                                                                                                                           | `App.tsx` (`needCalc`)                                       | convenience: results reappear if the inputs are changed back to the calculated values (they are the same results)                                       |
| Save: "No valid calibration to save"; out-of-range confirm "Warning:\n…\nSave anyway?" (OK/Cancel); lines in sensor order with `param_to_string`; "Saved:\n\tNAME: ratio" alert; file `AirspeedFit.param` | `params.ts` `planSave`, `paramFileText`; `ParamPanel.tsx`    | **reverted-in-this-audit** (port had no confirm step, a differently worded summary and no "nothing to save" message; oracle for all texts and the file) |
| Sensor summary: device line (DroneCAN sensor id only when ≥ 0), "(primary)", Use (warning when the parameter is missing), Health                                                                          | `ui/SensorSummary.tsx`, `analysis/devid.ts`                  | presentation (words instead of emoji)                                                                                                                   |

## Remaining intentional differences

- **Presentation**: CustomBuild layout, chips instead of radios and the select, words instead of emoji
  in the sensor summary and flight summary, theme-aware colours for the truth line and bias bars,
  a suggested-parameters table, a log facts panel.
- **Convenience**: a "Logged ratio" column in the sensor summary (the logged `ARSPDn_RATIO`, which
  upstream reads and shows beside the suggestion); out-of-range warnings listed before saving;
  results shown again when the inputs return to the calculated values; "Fit samples" fact.
- **Crashes**: missing columns and STAT without isFlying stop with an error (proven upstream bug; the
  message is the fix). A BARO without instances is read as one barometer.
- `alert`/`confirm` are in-page messages with the same text and choices.

## Proven upstream bugs fixed

Verdicts and tests: [`../bug-proofs/airspeed-fit.md`](../bug-proofs/airspeed-fit.md).

1. **BARO without an instance field crashes the load** (`0 in log.messageTypes.BARO.instances` with
   `instances` undefined). The port reads it as one barometer.
2. **Missing EKF/STAT columns crash the load** (`Array.from(undefined)`, `flying.length`). No port
   change: the port already stops the load with a message ("XKF1 is missing VN, VE or VD", "STAT is
   missing TimeUS or isFlying").

## Upstream bugs reproduced

1. **Bias bar of 0 for sensors without a logged ratio** (`Math.abs(null)`): a zero-height bar is drawn
   for "Existing". Cosmetic.

## Tests added in this audit

`src/analysis/oracle.test.ts`: odd window inputs (empty, partly empty, reversed, fractional) compared
sample for sample with readout text; "No valid calibration to save" alert; out-of-range confirm,
file and summary; save summary on the default log; BARO without instances; exact auto-window plot
range. `params.test.ts`: `planSave` texts, non-finite ratio rows. Synthetic log gained a
`baroNoInstance` option.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in dark and light: empty and a
synthetic plane log with two airspeed sensors (`apps/airspeed-fit/test-fixtures/plane-airspeed.bin`,
made with `buildSyntheticAirspeedLog({ flightSeconds: 240 })` from `src/test-utils/synthetic-log.ts`).
The capture runs offline, so the Open-Meteo lookup fails quietly and the other temperature
sources show. Rail controls, the q slider (keyboard arrows refit on key release), the save button
and its confirm work from the keyboard. No console errors, overflow or clipped text. Compared
against `upstream/AirspeedFit/index.html`: every control, plot, the sensor summary and the save
flow are present.

Changed (presentation only):

- Wind plot: the legend sat on the time axis title; it now sits at the foot of the figure, and
  the title (with the drift value) is on two lines so it fits a phone-width plot.
- The flight data card shows an empty state before a log is open instead of empty axes.
- Inline styles moved to `ui/airspeed-fit.css`; rail notes use the same small note style as the
  other tools.
- RMS help says "narrow inner bar" for the bias bar, which is light in the dark theme.
- "Not enough valid samples" row text starts with a capital and wraps.

Remaining: the sensor and suggested-parameter tables scroll sideways on phones.
