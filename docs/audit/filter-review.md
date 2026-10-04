# Filter Review audit

Port: `apps/filter-review`. Upstream: `upstream/FilterReview/` (`index.html`, `FilterReview.js`,
`params.json`, `tracking/*.js`), plus the libraries it loads: `Libraries/Array_Math.js`, `fft.js`,
`ParameterMetadata.js`, `Param_Helpers.js`, `DecodeDevID.js`, `LogHelpers.js`, `OpenIn.js` and the
JsDataflashParser module.

Oracles (all `node:vm`, the upstream files run unmodified apart from the dynamic parser import):

- `src/analysis/test-utils/upstream.ts` loads the upstream scripts with a minimal DOM stub;
  `pipeline.test.ts` compares FFTs, transfer functions and every plot trace (FFT means, post-filter
  estimate, notch markers, Bode amplitude/phase and bands, spectrogram heat map and gaps, simulated
  and logged tracking lines) bit for bit for three scenarios (raw, raw pre+post, batch pre+post; all
  four tracking kinds, double/triple/quintuple notches, filter versions 1, 2 and 4, dB/linear/PSD,
  Hz/RPM, all three aliasing modes, wrapped and unwrapped phase, including a single-window range).
- `load.test.ts` compares `load_from_raw_log` / `load_from_batch` (including corrupt batches and
  ignored parameter changes); `tracking/tracking.test.ts` compares every tracking target, its
  interpolation and means, the logged notches and the atmosphere model.
- `src/analysis/test-utils/upstream-page.ts` (added in this audit) runs the whole page: `setup_plots()`,
  `reset()`, `load()`, `load_parameters()`, `save_parameters()` and `open_in_filter_tool()`, with a
  DOM stub that keeps radio groups, drop-downs that only take their option values, number inputs that
  drop invalid text, and file inputs that refuse a value. `page.test.ts` compares the input values
  after loading (and after loading a second log), the log type used, analysis window, window size
  write-back, filter version, default trace and plot selections, the "Primary" label, every alert,
  the transfer functions from the resulting inputs, the parameter file reader, the saved file text
  and the Filter Tool link.
- `src/analysis/filter-review.real-logs.test.ts` runs only when `APWT_REAL_LOGS` names a directory of
  real flight logs (never committed): for every log, each data source it has is loaded in the page
  and the port, and the page state and alerts, every instance's FFT and filter responses, and every
  plot under the default view and each IMU, spectrogram source and axis, scale, aliasing mode and a
  narrower range are compared, then notch 1 on each tracking mode (`re_calc()`), two FFT window
  settings and the Filter Tool link. A log without gyro data must give upstream's alert. It also
  checks that the original page differs only as row 4 of the bug proofs says (FFT rate).
  `test-utils/page-compare.ts` holds the comparisons shared with `page.test.ts`.

Statuses: **identical** (same result, possibly restructured code), **code-improved**,
**presentation**, **convenience** (changes no computed result), **browser-forced**,
**reverted-in-this-audit** (the port differed and now matches upstream).

## Inventory

### Loading (`load()`, `load_from_batch`, `load_from_raw_log`)

| Upstream item                                                                                                                                                                                                                                                                                                                                                                                                                           | Port location                                                                                  | Status                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "No params in log", "No batch data or raw IMU found in log", "No valid gyro data found in log"                                                                                                                                                                                                                                                                                                                                          | `load.ts` `loadFilterReviewLog` (thrown, shown in the error banner)                            | identical                                                                                            |
| Gyro IDs `INS_GYR_ID`, `INS_GYRn_ID`; rate = mean `IMU.GHz` of IMU instance `i`; info text `name via bus at N Hz` (`?` when unknown)                                                                                                                                                                                                                                                                                                    | `gyro-sensors.ts` `readGyroSensors`, `gyroInfoText`                                            | identical                                                                                            |
| Log type: batch only if there is no `GYR`; with both kinds of data the "Batch" radio is read after `reset()` has ticked "Raw sensor", so raw is always used                                                                                                                                                                                                                                                                             | `load.ts` (`useBatch = haveBatch && !haveRaw`); `Rail.tsx` shows the source used, read-only    | proven upstream bug fixed: the choice made before loading is used (see "Proven upstream bugs fixed") |
| `load_from_batch`: ISBH/ISBD sequence matching, 32 samples per ISBD, `mul` scaling, missing/extra message aborts, end-of-log handling, empty instances removed, `INS_LOG_BAT_OPT` first value (change alerted and ignored), pre/post instance offset and the "assuming pre-post" alert, 3-IMU limit, rate = max of batch rates and `IMU.GHz` of the sensor, start/end = first/last batch start, quantisation noise `1/(sqrt(3) 2^15.5)` | `load-batch.ts` `loadFromBatch`                                                                | identical (oracle)                                                                                   |
| `load_from_raw_log`: `INS_RAW_LOG_OPT` first value, post / pre+post bits and their alert, gap split (5 x running mean gap, at least 64 samples), slice end `j - i`, mean of batch rates, `gyro_rate[i]` by log instance, end = last start + samples / rate, zero quantisation noise                                                                                                                                                     | `load-raw.ts`                                                                                  | identical (oracle; slice and rate lookup quirks kept, see bugs)                                      |
| Filter version from `VER.FV` (needs the `FV` field), "Unsupported filter version" alert and fallback to 4, version 1 when absent (`reset()`)                                                                                                                                                                                                                                                                                            | `filter-version.ts`                                                                            | identical                                                                                            |
| Tracking sources `[Static, Throttle, RPM1 (mode 2), ESC, FFT, RPM2 (mode 5)]`, logged notches 0 and 1                                                                                                                                                                                                                                                                                                                                   | `tracking/targets.ts`                                                                          | identical                                                                                            |
| Filter inputs: `reset()` writes `_FREQ` 80, `_BW` 40, `_ATT` 40, `_HMNCS` 3, `_MODE` 1, `_FM_RAT` 1, then each parameter the log has (last value)                                                                                                                                                                                                                                                                                       | `page-values.ts` `pageValuesFromLog`                                                           | reverted-in-this-audit (see "Inputs modelled as page values")                                        |
| `_HMNCS` bitmask width 32 when `INS_RAW_LOG_OPT` exists, else 8                                                                                                                                                                                                                                                                                                                                                                         | `filter-params.ts` `hasSixteenHarmonics`, `page-values.ts` `bitmaskBits`                       | identical                                                                                            |
| Logged notches use the loaded `_HMNCS`                                                                                                                                                                                                                                                                                                                                                                                                  | `load.ts`                                                                                      | identical                                                                                            |
| Flight data: ATT roll/pitch, RATE.AOut, POS.RelHomeAlt                                                                                                                                                                                                                                                                                                                                                                                  | `flight-data.ts` `readFlightData`, `ui/traces.ts`                                              | identical / presentation                                                                             |
| Analysis window: floor/ceil of the gyro span, cropped to `ceil(first throttle) + 1` .. `floor(last throttle) - 1`, index tested for truthiness                                                                                                                                                                                                                                                                                          | `flight-data.ts` `defaultTimeRange`, `throttleActiveRange`                                     | identical (index 0 quirk kept, see bugs)                                                             |
| Primary IMU from `AHRS_EKF_TYPE == 3` and `EK3_PRIMARY` 0..2; "- Primary" label even if that IMU has no data; default selections only for the primary when it has data                                                                                                                                                                                                                                                                  | `load.ts` (`primaryGyro`, `primaryFromEkf`, `ekfPrimary`), `selections.ts` `defaultSelections` | identical (label condition reverted-in-this-audit: the port labelled it only when it had data)       |
| Default checkboxes: logged lines of the shown IMUs, estimated post when there is pre but no post data; Bode and spectrogram on the primary (else lowest IMU); spectrogram pre if any                                                                                                                                                                                                                                                    | `selections.ts` `defaultSelections`                                                            | identical (oracle)                                                                                   |
| `calculate()`, `calculate_transfer_function()`, `redraw()` at the end of `load()`                                                                                                                                                                                                                                                                                                                                                       | `session.ts` `loadIntoPage`, `App.tsx`                                                         | identical                                                                                            |
| Open/Save/Load buttons stay disabled when `load()` stops after an alert (e.g. bad window size)                                                                                                                                                                                                                                                                                                                                          | `Rail.tsx` (enabled whenever a log is loaded)                                                  | convenience                                                                                          |

### Inputs modelled as page values

Upstream keeps every setting in a page input and reads it back when it rebuilds the filters. The
port now keeps the same strings (`page-values.ts`), so it reads, saves and links the same values.

| Upstream behaviour                                                                                                                                                                                                          | Port location                                         | Status                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `parameter_get_value`: `parseFloat` of the input; an empty input is NaN; bitmasks narrower than 32 bits made unsigned                                                                                                       | `page-values.ts` `pageNumber`, `filterParamsFromPage` | reverted-in-this-audit (the port kept numbers and ignored empty fields)                                |
| `INS_GYRO_FILTER` and `SCHED_LOOP_RATE` read with plain `parseFloat`                                                                                                                                                        | `filterParamsFromPage`, alias loop rate               | identical                                                                                              |
| `_ENABLE` and `_MODE` are drop-downs (`params.json` `Values`): a value they do not offer (enable 2, mode 7, text "1.0") selects nothing and reads NaN, so the notch is disabled and "Unsupported notch mode NaN" is alerted | `assignedValue`, `NotchEditor.tsx` (blank option)     | proven upstream bug fixed: an unoffered value is kept as its number (see "Proven upstream bugs fixed") |
| Number inputs keep only valid number text (no `+`, trailing `.`, spaces or words)                                                                                                                                           | `sanitizeNumberInput` (Chromium's rule)               | reverted-in-this-audit                                                                                 |
| Parameters a new log does not set keep the previous log's (or the user's) value: `_ENABLE`, `_REF`, `_OPTS`, `INS_GYRO_FILTER`, `SCHED_LOOP_RATE`; the six `reset()` defaults are restored                                  | `resetPageValues`, `pageValuesFromLog`                | reverted-in-this-audit (the port reset everything to page defaults)                                    |
| Page defaults: `INS_GYRO_FILTER` "20.0", `SCHED_LOOP_RATE` 400, notch inputs 0 then the `reset()` defaults                                                                                                                  | `INITIAL_PAGE_VALUES`, `defaultPageValues`            | identical                                                                                              |
| Bitmask checkboxes (`read_bits`): OR of the ticked bits offered by `params.json` (16 harmonics, 7 option bits), masked and signed for an 8-bit `_HMNCS`; other bits dropped                                                 | `bitmaskFromBits`, `NotchEditor.tsx`                  | reverted-in-this-audit (the port kept bits it did not show)                                            |
| Raw number inputs for `_HMNCS` and `_OPTS`                                                                                                                                                                                  | `NotchEditor.tsx` "Value" fields                      | reverted-in-this-audit (were missing)                                                                  |
| `filter_param_read` disables a notch's inputs unless `parseFloat(_ENABLE) > 0`                                                                                                                                              | `NotchEditor.tsx`                                     | identical                                                                                              |

### FFT and filter simulation

| Upstream item                                                                                                                                                                                                                                                                                                            | Port location                                                                                                  | Status                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_batch_fft`: window size `floor(n0 / (1 + (w - 1) * 0.5))` with `w = max(parseInt(per batch), 1)` for batch, `parseInt(window size)` for raw; power-of-two check and alert; 50 % overlap, Hann window, correction factors; short batches skipped; sample period from the hoisted `window_size` / `data_set[0]` quirk | `fft/batch-fft.ts` `fftWindowSize`, `runGyroFft`; `session.ts` `fftOptions`                                    | identical (oracle; quirk kept, see bugs)                                                                                                     |
| Windows-per-batch parsed with `parseInt`                                                                                                                                                                                                                                                                                 | `session.ts` `fftOptions`, `Rail.tsx`                                                                          | reverted-in-this-audit (the port rounded: 2.6 gave 3 windows, upstream 2)                                                                    |
| `fft_window_size_inc` on the window size input's change event: a change of exactly one from the last committed value steps to the next power of two, any other value is kept as typed (a non-power-of-two then fails at the calculation); `min="1"`                                                                      | `Rail.tsx` `commitWindowSize` with `@apwt/signal` `fftWindowSizeInc`, `ui/NumberField.tsx` `CommitNumberField` | reverted-in-this-audit (the port snapped every keystroke to a power of two, stepping from the new value)                                     |
| `calculate()`: "Not enough continuous IMU data available"; per-IMU mean sample rate and resolution text; the first IMU's mean window size written back into the window size input (also for batch logs)                                                                                                                  | `analyse.ts` `analyseGyro`, `sensorFftInfo`, `windowSizeWriteBack`; `session.ts` `windowSizeAfter`             | identical (write-back reverted-in-this-audit: the port did not write it back, so a raw log loaded after a batch log used a different window) |
| Z grids for pre-filter data, Bode grid 0.05 Hz steps, tracking interpolated for instances that get a Bode grid                                                                                                                                                                                                           | `analyse.ts` `bodeGrid`, `interpolateTargets`                                                                  | identical (oracle)                                                                                                                           |
| `DigitalBiquadFilter`, `NotchFilter`, `MultiNotch`, `HarmonicNotchFilter` (mode lookup, alerts, double/triple/quintuple and the version-4 quintuple alert, `get_min_freq` per version and option 32, static notch applied once)                                                                                          | `filters/harmonic-notch.ts`, `filters/filter-set.ts`, `@apwt/filters`                                          | identical (oracle)                                                                                                                           |
| `calculate_transfer_function`                                                                                                                                                                                                                                                                                            | `analyse.ts` `instanceTransfer`                                                                                | identical (oracle)                                                                                                                           |

### Tracking (`tracking/*.js`)

| Upstream item                                                                                                                | Port location                                              | Status                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `NotchTarget` base: `have_data`, interpolation, `get_target_freq` (constant line for ref 0), mean over the analysis window   | `tracking/target.ts`                                       | identical (oracle)                                                                                       |
| `StaticTarget`                                                                                                               | `tracking/static.ts`                                       | identical                                                                                                |
| `ThrottleTarget` (incl. multi-source, motor thrust model, battery and air-density compensation, version differences, errors) | `tracking/throttle.ts`, `motor-thrust.ts`, `atmosphere.ts` | identical (oracle)                                                                                       |
| `RPMTarget` (instances 1 and 2, health)                                                                                      | `tracking/rpm.ts`                                          | identical (oracle)                                                                                       |
| `ESCTarget` (per motor and average, motor count)                                                                             | `tracking/esc.ts`                                          | identical (oracle)                                                                                       |
| `FFTTarget`: FTN2 peaks weighted by energy, FTN1 centre peak; no frequencies when FTN2 is absent                             | `tracking/fft.ts`                                          | identical (oracle, quirk kept)                                                                           |
| `FFTTarget.interpolate` when FTN2 is logged without FTN1: upstream throws and the calculation stops                          | `tracking/fft.ts` (throws; shown as an error)              | proven upstream bug fixed: no centre peak, the FTN2 peaks still track (see "Proven upstream bugs fixed") |
| `LoggedNotch` (FTN / FTNS)                                                                                                   | `tracking/logged.ts`                                       | identical (oracle)                                                                                       |

### Plots

| Upstream item                                                                                                                                                                                        | Port location                                                  | Status                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `get_alias_obj` (resample, fold, "only")                                                                                                                                                             | `plots/alias.ts`                                               | identical (oracle)                                                                                     |
| `new Array(n)` in `get_alias_obj` throws for an empty, zero or negative `SCHED_LOOP_RATE` with aliasing on                                                                                           | `plots/alias.ts` `arrayLength`; `App.tsx` shows the error      | reverted-in-this-audit (typed arrays took NaN as 0 and drew nothing silently); crash shown as an error |
| `find_start_index`, `find_end_index` (+1)                                                                                                                                                            | `time-index.ts`                                                | identical                                                                                              |
| FFT means with window correction, estimated post-filter with quantisation noise                                                                                                                      | `plots/spectrum.ts`                                            | identical (oracle)                                                                                     |
| Notch markers: mean line and min/max band per harmonic, multi-peak mean of means                                                                                                                     | `plots/notch-lines.ts` `notchMarkers`, `harmonicStats`         | identical (oracle)                                                                                     |
| Bode: mean/max/min amplitude and unwrapped phase (`get_phase` 45 deg bias), `phase_scale` wrap                                                                                                       | `plots/bode.ts`, `@apwt/filters` `wrapPhase`                   | identical (oracle, incl. the single-window double shift)                                               |
| Bode instance: last instance of the chosen IMU with a Bode grid                                                                                                                                      | `App.tsx` `bodeInstance`                                       | identical                                                                                              |
| Spectrogram: instance by IMU and pre/post, gaps at 2.5 x mean spacing, estimate, notch and logged tracking lines (logged only when the simulated notch is enabled, visible with "show" and "logged") | `plots/spectrogram.ts`, `plots/notch-lines.ts`, `ui/traces.ts` | identical (oracle)                                                                                     |
| Plot layouts, hover templates, legend groups, colours, linked frequency axes and resets                                                                                                              | `ui/traces.ts`, `App.tsx` with `@apwt/plot`                    | presentation                                                                                           |
| Flight data relayout: `floor`/`ceil` of the zoomed range, autorange to the gyro span                                                                                                                 | `App.tsx` `onFlightRelayout`                                   | identical                                                                                              |

### Parameters and links

| Upstream item                                                                                                                                                                                                                                                                         | Port location                                              | Status                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `save_parameters`: `INS_*` number inputs in page order, then the drop-downs, each value through `param_to_string` (empty input written as 0), file `filter.param`                                                                                                                     | `param-file.ts` `pageParams`, `filterParamFileText`        | identical (oracle)                                                                                                       |
| `load_parameters`: lines not trimmed, split on `/[\s,=\t]+/`, at least two parts, first part looked up as an element id; an indented line has an empty name and is ignored                                                                                                            | `param-file.ts` `applyParamFile`                           | reverted-in-this-audit (the port used the shared reader, which trims and accepts indented lines and rejects non-numbers) |
| Values go through the input's rules (invalid number text empties a number input, unknown option empties a drop-down)                                                                                                                                                                  | `applyParamFile` with `assignedValue`                      | reverted-in-this-audit                                                                                                   |
| Element ids that are not parameters: `TimeStart`, `TimeEnd`, `FFTWindow_size`, `FFTWindow_per_batch` are set (window sizes take effect at the next calculation); a non-empty value for the file inputs `fileItem` / `LoadParamsbase` throws and stops loading (earlier lines applied) | `applyParamFile` (`other` assignments, `error`), `App.tsx` | reverted-in-this-audit; the stop is shown as a message instead of the generic error alert                                |
| `open_in_filter_tool`: `INS_*` input names and value strings, `GYRO_SAMPLE_RATE` (rounded rate of the Bode IMU's first instance), Throttle, RPM1, ESC_RPM + NUM_MOTORS, RPM2 means over the analysis window; FFT tracking not passed                                                  | `filter-tool-link.ts` `filterToolUrl`, `filterToolValues`  | identical (oracle; values reverted-in-this-audit to the input strings, e.g. `20.0`, empty drop-downs as empty)           |
| Filter Tool URL base: current page URL with `FilterReview` replaced by `FilterTool`                                                                                                                                                                                                   | `toolHref(toolById('filter-tool'))`                        | browser-forced (the port's routes differ)                                                                                |
| "Open in" other tools                                                                                                                                                                                                                                                                 | `@apwt/tool-shell` `OpenInButton`                          | see the tool-shell audit                                                                                                 |

## Remaining intentional differences

- **Live recalculation.** Upstream recalculates when Calculate / "Calculate filters" is clicked
  (and on filter version or parameter file changes); the port recalculates on every committed
  change. The values computed are the same as clicking the button after the change. Inputs a
  parameter file sets for the window sizes still take effect only at the next calculation, as
  upstream. After a parameter file stops at a file-input line, upstream skips the recalculation;
  the port applies the earlier lines and recalculates.
- **Errors instead of crashes.** Upstream's `alert()` messages are shown in the page with the same
  text; its uncaught errors (non-power-of-two window, unusable loop rate with aliasing, FTN2
  without FTN1, file input in a parameter file) are shown as messages and the affected plots are
  left empty.
- **Stale plots.** When no instance matches the spectrogram or Bode selection, upstream returns
  without redrawing and keeps the previous plot; the port shows an empty plot (with a hint), and it
  disables Bode IMU choices that have no Bode data.
- **Log type control** is shown read-only: upstream lets the radios be clicked before a log is
  loaded but `reset()` overrides them, and disables them after loading.
- **Presentation.** Layout, wording (e.g. "(primary)" for "- Primary"), FFT info shown with the
  log facts, gyro labels, chips instead of checkboxes and tooltips.

## Upstream bugs reproduced

| Bug                                                            | Where (upstream)                                                          | Reproduction                                                                              | Effect                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Inputs a later log does not set keep the previous log's values | `reset()` only rewrites six defaults                                      | Load a log with `INS_HNTCH_REF` 0.5, `_OPTS` 2, then one without them (`page.test.ts`)    | The second log is simulated with the first log's `_ENABLE`/`_REF`/`_OPTS`/`INS_GYRO_FILTER`/`SCHED_LOOP_RATE` when it lacks them |
| Parameter files can set non-parameter inputs and can abort     | `load_parameters` looks names up with `getElementById` and does not catch | `TimeStart,12` changes the analysis window; `fileItem,x` throws part way (`page.test.ts`) | Unexpected analysis window or window size; partially applied file The abort is a proven bug, fixed (below).                      |
| Batch window size written into the raw window size input       | `calculate()` sets `FFTWindow_size` from the first IMU                    | Batch log with 3 windows per batch (512), then a raw log (`page.test.ts`)                 | The raw log is analysed with 512-sample windows instead of the user's 1024                                                       |

## Proven upstream bugs fixed

Fixed only because each is proven to the standard in [`../bug-proofs/README.md`](../bug-proofs/README.md); verdicts,
evidence and test names are in [`../bug-proofs/filter-review.md`](../bug-proofs/filter-review.md). The oracle tests load
upstream with the same fixes as text edits (`test-utils/proven-fixes.ts`, `{ fixed: true }`) and check the original's
result where an input reaches a fixed bug.

- **Batch data never used with raw data present** (`load()`, `reset()` before the radio is read). The log type chosen
  before loading is used (`load.ts` `loadFilterReviewLog(..., preferBatch)`).
- **Raw batches lose their last `i` samples on instance `i`** (`slice(batch_start, j-i)`). Every instance keeps its
  samples to `j` (`load-raw.ts`).
- **Raw reported rate by log instance** (`gyro_rate[i]`). Looked up by sensor, as the batch loader does (`load-raw.ts`).
- **FFT sample rate is the first batch's rate** (`run_batch_fft`, `data_set[0]`). The rates of the batches the FFT uses
  are averaged, once the window size is known (`fft/batch-fft.ts`).
- **Throttle at index 0 ignored for the auto zoom** (`if (first_index)`). A match at the first sample is found
  (`flight-data.ts`).
- **No FFT frequency without FTN2** and **FTN2 without FTN1 stops the calculation** (`tracking/FFT.js`). The centre peak
  needs only FTN1, the peaks only FTN2 (`tracking/fft.ts`).
- **Unoffered drop-down values read as NaN** (`<select>`). Kept as their number (`page-values.ts` `assignedValue`).
- **A parameter file aborts part way** (a file input line throws). The line is skipped and the rest applied
  (`param-file.ts`); setting non-parameter inputs is still reproduced.
- **Single-window phase band shifted twice** (`Phase_max` and `Phase_min` one array). Max and min are distinct arrays
  (`plots/bode.ts`).
- **Empty, zero or negative loop rate crashes the redraw with aliasing on**: a proven failure with no defined result;
  the port already shows the error, no change.
- **Open in Filter Tool sends the gyro rate as `GYRO_SAMPLE_RATE`**, which the Filter Tool never reads (its input is
  `GyroSampleRate`). The link stays identical to upstream's; the port's Filter Tool reads that key
  (`apps/filter-tool/src/analysis/settings.ts`), so it opens at the log's IMU rate instead of 2000 Hz.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in both themes, in three states: empty,
the new `test-fixtures/ui-batch.bin`, and the same log with log frequency axis, wrapped phase and
the estimated post-filter spectrogram. The fixture is a small synthetic batch sampling log (two
gyros logged pre and post filter, attitude, throttle and altitude, a throttle notch and an FFT
notch with logged notch frequencies) built by `src/analysis/test-utils/ui-fixture.ts` and kept in
step by `src/analysis/ui-fixture.test.ts`; the repository fixtures have no gyro data. Every section
was read from the captures; keyboard use of the chips, group toggles and rail inputs was checked in
Chromium. The harness reports no findings.

Changed (presentation only):

- Spectrum line chips are laid out like upstream's fieldsets: per gyro, Pre-filter, Post-filter and
  Estimated post groups of X, Y, Z. The gyro and group labels are buttons that do what
  double-clicking a fieldset legend did upstream (when fewer than half of the enabled lines are
  shown, show them all, else hide them; unavailable lines untouched). This replaces the port's
  "All" chip, which used a different rule, and restores the per-group toggle. Unit test:
  `ui/toggle-lines.test.ts`.
- Chip groups carry labels that stay with their chips when a toolbar wraps (Amplitude, Frequency,
  Aliasing, Notches, Gyro, Phase, Source, Axis); "Notches" no longer ends a line on its own.
- The Bode amplitude and phase bands are mid grey at 35 % opacity; they were drawn black, which hid
  the phase line's surroundings in dark mode.
- "No attitude, throttle or altitude in this log." on an empty flight data plot.
- Phone width: legends above the plots, and the flight data plot keeps only the roll and throttle
  axes (`ui/Chart.tsx`).

Remaining known issues:

- The fixture shows upstream's "Sequence incomplete ..." warning, which upstream raises whenever the
  last batch ends the log, and "at ? Hz" for the gyros because it has no IMU messages.
- At phone width the plots keep the shell's fixed heights.
