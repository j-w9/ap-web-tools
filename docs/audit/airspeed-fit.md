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

| Upstream item                                                                                                                          | Port location                                        | Status                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Alerts: no ARSP instances, no XKF1/NKF1, no BARO, could not read EKF velocity, no POS, no usable airspeed data                         | `analysis/load.ts` `loadAirspeedLog` errors          | identical text and order                                                            |
| Velocity sources: XKF1 then NKF1 cores, name "EKFn core c", wind from XKF2/NKF2 of the same core; first ticked; single source disabled | `load.ts` `velocitySources`, `ui/Rail.tsx`           | identical                                                                           |
| Missing VN/VE/VD or VWN/VWE column crashes upstream                                                                                    | `velocitySources` throws                             | **reverted-in-this-audit** (port skipped the source / dropped the wind)             |
| BARO instance 0 else first instance; BARO without instance field crashes (`0 in undefined`)                                            | `load.ts`                                            | **reverted-in-this-audit** (port read the whole BARO message and continued; oracle) |
| POS time/RelHomeAlt/Alt; ATT roll for the plot                                                                                         | `load.ts`                                            | identical                                                                           |
| `STAT.isFlying` flight span; STAT without isFlying crashes                                                                             | `load.ts`                                            | identical / **reverted-in-this-audit** for the crash case                           |
| Field elevation and time (interpolated POS.Alt at first flying, else last POS.Alt)                                                     | `load.ts`                                            | identical (oracle)                                                                  |
| Takeoff lat/lng and UTC start for the weather lookup                                                                                   | `load.ts`                                            | identical (oracle)                                                                  |
| Temperature presets: ISA at field elevation, BARO.GndTemp at field time, Carbonix METAR `GCS:WX`                                       | `load.ts`, `analysis/temperature.ts`                 | identical (oracle)                                                                  |
| `set_temp_select`: order openmeteo, isa, baro, metar, Custom; default ISA, else first, else Custom (box unchanged)                     | `temperature.ts` `chooseTempSource`, `App.tsx`       | identical                                                                           |
| Box filled with `value.toFixed(0)`; editing the box selects Custom                                                                     | `tempBoxText`, `App.tsx`                             | identical                                                                           |
| ARSP instances sorted; ratio/use/devid parameter names; health all 1; primary = last Pri                                               | `load.ts` `airspeedSensor`                           | identical (oracle)                                                                  |
| Auto window from sensor 0 over the flight span, whole log on failure; inputs `floor`/`ceil`                                            | `load.ts` `autoWindow`                               | identical (oracle)                                                                  |
| Flight data plot zoomed to the exact (unrounded) auto window on load                                                                   | `load.ts` `autoWindowExact`, `App.tsx` `plotRange`   | **reverted-in-this-audit** (port zoomed to the rounded inputs)                      |
| Open-Meteo lookup (URL by recency, 5 s timeout, nearest hour), selected and recalculated when it returns                               | `analysis/weather.ts`, `io/open-meteo.ts`, `App.tsx` | identical (oracle with stubbed fetch)                                               |

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
- **Crashes**: missing columns, BARO without instances and STAT without isFlying stop with an error.
- `alert`/`confirm` are in-page messages with the same text and choices.

## Upstream bugs reproduced

1. **BARO without an instance field crashes the load.** `load`: `0 in log.messageTypes.BARO.instances`
   with `instances` undefined. Reproduce: synthetic log with BARO lacking the `#` instance unit (oracle).
   Effect: nothing is loaded.
2. **Missing EKF/STAT columns crash the load** (`Array.from(undefined)`, `flying.length`). Effect:
   nothing is loaded.
3. **Bias bar of 0 for sensors without a logged ratio** (`Math.abs(null)`): a zero-height bar is drawn
   for "Existing". Cosmetic.

## Tests added in this audit

`src/analysis/oracle.test.ts`: odd window inputs (empty, partly empty, reversed, fractional) compared
sample for sample with readout text; "No valid calibration to save" alert; out-of-range confirm,
file and summary; save summary on the default log; BARO without instances; exact auto-window plot
range. `params.test.ts`: `planSave` texts, non-finite ratio rows. Synthetic log gained a
`baroNoInstance` option.
