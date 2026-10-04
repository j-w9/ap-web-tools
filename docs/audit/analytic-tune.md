# Analytic Tune audit

Port: `apps/analytic-tune`. Upstream: `upstream/AnalyticTune/` (`index.html`, `AnalyticTune.js`,
`params.json`), plus `Libraries/Array_Math.js`, `Libraries/fft.js`, `Libraries/Param_Helpers.js`,
`Libraries/ParameterMetadata.js` and `modules/JsDataflashParser` that the page loads.

Oracle: `src/analysis/test-utils/upstream.ts` loads `AnalyticTune.js` with the three libraries in
`node:vm` with a stub DOM built from upstream's `index.html` (number inputs keep only valid
floating-point text, drop-downs keep only their option values, file inputs refuse a value, as the
DOM does) and the upstream log parser. The tests drive upstream's own `load_log`,
`calculate_freq_resp`, `redraw_freq_resp`, `save_parameters` and `load_parameters`:

- `pipeline.test.ts`: four synthetic logs (copter, copter with attitude logged at a quarter of the
  rate, quadplane with `ANG`, fixed wing), every run, gyro and attitude feedback, two window
  sizes: runs, vehicle, every input after loading, sample rate, window count, airspeed scaling,
  all six measured responses and coherences, all eight predicted responses, and every plotted
  trace (x, gain, phase, coherence, visibility) for all nine loops in two scale settings, one
  with the un-wrapped phase option on. Bit for bit.
- `load-upstream.test.ts`: `load_log` edge cases (no `PARM`, `SIDD` without `SIDS`, more `SIDS`
  records than runs, no SID data, plane without `SIDS`), state carried between logs (vehicle,
  airspeed scaling), notch selections naming no `FILTn` group, fixed-wing yaw.
- `param-file.test.ts`: `.param` save for every target and notch selection, empty inputs saved,
  `.param` load of eleven files (indentation, separators, MAVProxy number formats, drop-down
  options, invalid number text, page elements that are not parameters, a file input stopping the
  load), URL settings.
- `load.test.ts`: window size text as `calculate_freq_resp` reads it, `nearestIndex`.
- `filters.test.ts`: the gyro filter chain (`get_filters`) for 40 random notch configurations on
  four model grids.
- `metadata.test.ts`, `params.test.ts`: every parameter's metadata against `params.json`, every
  default and step against `index.html`.

Statuses: **identical** (same result, possibly restructured code), **code-improved**,
**presentation**, **convenience** (changes no computed result), **browser-forced**,
**reverted-in-this-audit**.

## Inventory

### Filter models (`AnalyticTune.js` 6-651)

| Upstream item                                                                                                                           | Port location                                                                              | Status                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `PID` (E and D low-pass, I as k z/(z-1), D as k (1-z⁻¹), kI/rate, kD·rate)                                                              | `@apwt/filters` `designPid`                                                                | identical (oracle in `@apwt/filters`, end to end here)                                                  |
| `Ang_P` (P as an integrator k/rate · z/(z-1))                                                                                           | `@apwt/filters` `designAngleP`                                                             | identical                                                                                               |
| `feedforward` (kFF + kFF_D·rate·(1-z⁻¹))                                                                                                | `@apwt/filters` `designFeedforward`                                                        | identical                                                                                               |
| `LPF_1P` (unity at cut-off ≤ 0, alpha from dt/(dt+rc); sample rate set first)                                                           | `@apwt/filters` `designFirstOrderLowPass`                                                  | identical                                                                                               |
| `DigitalBiquadFilter`, `NotchFilterusingQ`, `NotchFilter` (range checks, A, Q, a0_inv)                                                  | `@apwt/filters` `designBiquadLowPass`, `designNotchWithQ`, notch                           | identical                                                                                               |
| `HarmonicNotchFilter`: modes 0-5, throttle, RPM1/RPM2, ESC with `OPTS` bit 1 chaining, 8 harmonics, double/triple, nyquist 0.48, spread | `predict.ts` `harmonicNotchConfig`, `notchTracking`; `@apwt/filters` `designHarmonicNotch` | identical (oracle, 40 random configurations); `ENABLE` NaN counts as enabled (`!(x <= 0)`), as upstream |
| `get_filters` (notch 1, notch 2, gyro low-pass at `GyroSampleRate`)                                                                     | `predict.ts` `gyroFilters`                                                                 | identical                                                                                               |
| `unwrap` (45° negative threshold)                                                                                                       | `@apwt/filters` `unwrapPhase`                                                              | identical; not used for plotting, see "un-wrapped phase"                                                |
| `evaluate_transfer_functions` (`array_from_range(step, max, step)` grid, `exp_jw`)                                                      | `@apwt/filters` `frequencyGrid`, `chainResponse`                                           | identical                                                                                               |
| `get_PID_param_names`, `get_FILT_param_names`, `get_HNotch_param_names`, prefix helpers                                                 | `params.ts` `controllerParams`, `targetPrefixes`, `filterParam`, `notchParam`              | code-improved (typed names)                                                                             |

### Log loading (`load_log` 1030-1242)

| Upstream item                                                                                                                     | Port location                                                        | Status                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| No `PARM`: `alert("No params in log")`, stop                                                                                      | `load.ts` `loadTuneLog`                                              | reverted-in-this-audit (the port had its own wording); in-page message with upstream's text                                            |
| `SIDS` axis and chirp length; `SIDD` runs split at gaps > 0.5 s, clamped to `TR + 1`                                              | `sid.ts` `findSidRuns`                                               | identical                                                                                                                              |
| More `SIDS` records than `SIDD` runs: `add_sid_sets` throws (`toFixed` of undefined), parameters not copied                       | `findSidRuns` lists the records with data                            | proven upstream bug fixed (see "Proven upstream bugs fixed")                                                                           |
| `SIDD` without `SIDS`: throws reading `tlen`                                                                                      | `loadTuneLog`                                                        | error shown instead of the crash                                                                                                       |
| No `SIDD`: no runs, parameters still copied, analysis window unchanged                                                            | `loadTuneLog`, `App.tsx`                                             | reverted-in-this-audit (the port rejected the log and copied nothing)                                                                  |
| First run's axis selects the controller axis (`set_sid_axis`; unknown axes keep the previous axis)                                | `App.tsx`, `sid.ts` `tuneAxisForSid`                                 | identical except axes 22 and 23 (proven upstream bug fixed, see "Proven upstream bugs fixed")                                          |
| `ANG` if present, else `ATT`                                                                                                      | `loadTuneLog` `attitudeMessage`                                      | identical                                                                                                                              |
| Harmonic notch parameters copied, then the vehicle from the first `ArduPlane`/`ArduCopter` banner (`SIDS` axis > 19 → fixed wing) | `loadTuneLog`, `sid.ts` `detectTuneVehicle`                          | identical                                                                                                                              |
| Plane banner without `SIDS`: throws after copying the notch parameters                                                            | `PartialTuneLogError` (keeps the notch parameters), `App.tsx`        | reverted-in-this-audit (the port rejected the log); error shown instead of the crash                                                   |
| No banner: `vehicle_type` keeps the previous log's value (copter on a fresh page)                                                 | `detectTuneVehicle(…, previous)`, `App.tsx` `vehicleRef`             | reverted-in-this-audit (the port reset to copter per log); upstream bug, see below                                                     |
| Rate controller (for the vehicle), `FILT1-8`, other parameters copied when logged (last value)                                    | `load.ts` `inputsFromLog`                                            | identical (oracle: every input after loading)                                                                                          |
| Values written into the page: an enumerated parameter's drop-down keeps only its option values                                    | `form-values.ts` `inputValueFromNumber`                              | reverted-in-this-audit (the port kept any value)                                                                                       |
| `GyroSampleRate = (1 << INS_GYRO_RATE) * 1000` when `INS_GYRO_RATE != 0` (missing → 1 kHz)                                        | `inputsFromLog`                                                      | identical                                                                                                                              |
| `SCHED_LOOP_RATE` = logged, or gyro rate / `FSTRATE_DIV` with fast rate                                                           | `inputsFromLog`                                                      | identical                                                                                                                              |
| `set_bitmask_size(HMNCS, INS_RAW_LOG_OPT ? 32 : 8)`                                                                               | `ParamField` bitmask chips                                           | presentation (only changes which check boxes show; the maths uses 8 harmonics either way)                                              |
| Flight data plot (Targ, Gx, Gy, Gz on four axes), zoom to the first run                                                           | `ui/traces.ts` `flightDataTraces`, `flightDataLayout`                | presentation                                                                                                                           |
| Page title `SysID: <file>`                                                                                                        | `App.tsx`                                                            | presentation                                                                                                                           |
| `YAW_RATE_*` and `YAW2SRV_TCONST` copied (only `YAW_RATE_NTF`/`NEF` have inputs)                                                  | `load.ts` `logParamNames` (`YAW_RATE_NTF`/`NEF` for fixed-wing logs) | identical: the two inputs are read, shown and saved (row 112 fix); the other `YAW_RATE_*` and `YAW2SRV_TCONST` have no inputs upstream |

### Calculation (`calculate_freq_resp` 1406-1584, loaders 1586-1826, `calculate_freq_resp_from_FFT`, `calculate_predicted_TF` 808-953)

| Upstream item                                                                                                                                                                                                                                                                       | Port location                                              | Status                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Window size `parseInt` of the input, `alert('Window size must be a power of two')` unless log2 is an integer; `new FFTJS(1)` throws                                                                                                                                                 | `freq-resp.ts` `windowSizeFromText`                        | reverted-in-this-audit (the port held a number and could not reach upstream's acceptance); message shown         |
| Order of failure: window size, FFT, parameter form (fixed-wing yaw throws), time histories                                                                                                                                                                                          | `App.tsx` `calculate`                                      | identical order                                                                                                  |
| 50% overlap, Hann window, `run_fft` on `PilotInput`'s length                                                                                                                                                                                                                        | `identifyResponses`, `@apwt/signal` `runFft`               | identical; data shorter than a window throws upstream (negative array length or reading window 0): message shown |
| `nearestIndex`, `slice(ind1, ind2)` per message, degrees × 0.01745, multirotor `RATE`/`ATT`/`ANG`/`SIDD` fields                                                                                                                                                                     | `time-history.ts`                                          | identical (oracle, including attitude logged slower than `RATE`)                                                 |
| Sample rate = samples / elapsed time of the sliced `RATE` (fixed wing: `SIDD`) timestamps                                                                                                                                                                                           | `time-history.ts` `averageRate`                            | identical (upstream bug, see below)                                                                              |
| Fixed-wing loader (`SIDP` fields, mean `aspd`, `eastas` into globals)                                                                                                                                                                                                               | `fixedWingHistory`, `airspeedScalingFor`                   | proven upstream bug fixed: the scaling no longer outlives its log (see "Proven upstream bugs fixed")             |
| Fixed-wing yaw: `update_PID_filters` throws (no `FWYawPIDS` element)                                                                                                                                                                                                                | `tuneTarget` → null, message in `App.tsx`                  | error shown instead of the crash                                                                                 |
| `calculate_freq_resp_from_FFT` (sums, `0.612`, `Twin`, H, coherence)                                                                                                                                                                                                                | `freq-resp.ts` `frequencyResponseFromFft`                  | identical                                                                                                        |
| DC bin dropped (`_tf` copies)                                                                                                                                                                                                                                                       | `dropDc`                                                   | identical                                                                                                        |
| "Use attitude": derivative `PID(loop_rate, 0, 0, 1, 0, 0)` on the model grid times the attitude responses                                                                                                                                                                           | `measuredResponses`                                        | identical                                                                                                        |
| Predicted responses: PID with aspeed², error notch, FF/D_FF · aspeed / eas2tas, target LPF and notch, gyro filters, rate loop, angle P (1/TCONST on fixed wing), attitude loops, input shaping LPF (none on fixed wing; yaw uses pilot yaw TC), disturbance rejection, broken loops | `predict.ts` `predictResponses`                            | identical (oracle)                                                                                               |
| Notch selection `> 0` naming no `FILTn` group: `update_PID_filters` / `get_form("FILT9_…")` throw                                                                                                                                                                                   | `predict.ts` `checkNotchSelections`, `NotchSelectionError` | reverted-in-this-audit (the port selected no notch); error shown                                                 |
| Loops run to `length + 1`, trailing NaN on attitude-ff and system broken loop                                                                                                                                                                                                       | `predict.ts`                                               | identical plotted data (Plotly draws min(x, y) points); see below                                                |
| `performance.now()` timing logs                                                                                                                                                                                                                                                     | none                                                       | presentation                                                                                                     |

### Plotting (`redraw_freq_resp` 2075-2266, `setup_plots`, scales)

| Upstream item                                                                                               | Port location                                        | Status                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Nine control loops, calculated/predicted pairs, predicted coherence = bare aircraft's                       | `display.ts` `loopComparison`                        | identical                                                                                |
| `show_set_calc` rules by `sid_axis`, predicted hidden for bare aircraft                                     | `calculatedVisible`                                  | identical                                                                                |
| Attitude-with-FF and input-shaping radios disabled on fixed wing, but a checked one stays checked and drawn | `ComparisonControls.tsx`, `App.tsx`                  | reverted-in-this-audit (the port fell back to the rate loop)                             |
| Gain dB (20 log10) / linear; frequency Hz / rad/s, log / linear axis; labels and hover templates            | `gainOf`, `frequencyIn`, `ui/traces.ts`              | identical values; presentation                                                           |
| Phase option "un-wrapped" read then forced off (`unwrap_ph = false`)                                        | `display.ts` `phaseOf` (always wrapped), option kept | reverted-in-this-audit (the port's option un-wrapped the phase); upstream bug, see below |
| Linked frequency axes and reset                                                                             | `App.tsx` via `@apwt/plot`                           | identical behaviour                                                                      |
| Legend clicks disabled, margins                                                                             | `ui/traces.ts`                                       | presentation                                                                             |

### Inputs, files, URL (`index.html`, `load`, `save_parameters`, `load_parameters`, `window_size_inc`)

| Upstream item                                                                                                                                                                                                                                                 | Port location                                                                | Status                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Every input's default and step (gyro 2000, `INS_GYRO_FILTER` 20, notch 1 enabled throttle 150/75/40/0.29/3, loop 400, TC 0.15, PIDs 0.288/0.288/0.0117, FLTT 1.77, FLTD 20, angle P 4.5, TCONST 0.25/0.5, FILT Q 2 ATT 40, throttle 0.3, motors 1, RPMs 2500) | `params.ts` `DEFAULT_INPUTS`, `INPUT_STEPS`                                  | identical (test against `index.html`)                                                                                               |
| Window size 1024, `min=1`, start/end 0                                                                                                                                                                                                                        | `ui/Rail.tsx`, `App.tsx`                                                     | identical (`min` restored in this audit)                                                                                            |
| `window_size_inc` on the native change event: ±1 from the last committed size steps a power of two, anything else is kept as typed; last size starts at the default 1024                                                                                      | `ui/Rail.tsx` `WindowSizeInput`, `@apwt/signal` `fftWindowSizeInc`           | reverted-in-this-audit (the port snapped every keystroke to a power of two, stepping from the new value)                            |
| Inputs read with `parseFloat` on every calculation; an emptied input is NaN                                                                                                                                                                                   | `ui/Fields.tsx` `NumberInput` (NaN on leaving an empty input)                | reverted-in-this-audit (the port ignored empty input)                                                                               |
| Start/end time `value.trim() * 1e6` (empty = 0); zooming the flight plot sets floor/ceil seconds                                                                                                                                                              | `ui/Rail.tsx`, `App.tsx` `onFlightRelayout`                                  | identical                                                                                                                           |
| Run table: Num, Use, SID axis with `axisTypes` names, start/end `toFixed(2)`, colours when more than one run                                                                                                                                                  | `ui/SidRunTable.tsx`, `sid.ts` `SID_AXIS_NAMES`                              | presentation                                                                                                                        |
| Parameter visibility (`update_PID_filters`, `update_hidden`, `update_hidden_mode`)                                                                                                                                                                            | `form.ts`, `ui/ParamPanel.tsx`                                               | presentation                                                                                                                        |
| `load_param_inputs` metadata: labels, descriptions, units, drop-downs for `Values`, bitmask check boxes                                                                                                                                                       | `metadata.ts`, `ui/Fields.tsx`                                               | presentation; drop-downs hold only their options (an unmatched value shows empty and is NaN)                                        |
| `save_parameters`: matching number inputs in form order then drop-downs, duplicates where several prefixes match, `param_to_string`, `filter.param`                                                                                                           | `param-file.ts` `savedParamNames`, `saveParamText`                           | identical (oracle for every target and notch selection)                                                                             |
| An empty input saved as `0` (`Math.fround("")`)                                                                                                                                                                                                               | `saveParamText`                                                              | reverted-in-this-audit (the port could not hold an empty input)                                                                     |
| Fixed-wing yaw save: the empty pilot prefix matches every element including the bitmask check boxes, `param_to_string("on")` throws, nothing saved                                                                                                            | `param-file.ts` `saveParamText(inputs, null)`, `savedFixedWingYawParamNames` | proven upstream bug fixed: the file upstream builds without the empty pilot-prefix rule is saved (see "Proven upstream bugs fixed") |
| `load_parameters`: `split('\n')`, `split(/[\s,=\t]+/)`, two fields or more, set element by id, no trimming                                                                                                                                                    | `param-file.ts` `loadParamText`                                              | reverted-in-this-audit (the port used the shared parser, which trims, skips comments and takes only numeric known values)           |
| … number inputs keep only valid floating-point text (else NaN), drop-downs only their options (MAVProxy `0.000000` empties `INS_HNTCH_ENABLE`)                                                                                                                | `form-values.ts` `inputValueFromText`                                        | reverted-in-this-audit                                                                                                              |
| … also sets `FFTWindow_size`, `starttime`, `endtime`, the "Use attitude" check box (any element of its fieldset, value & 1), and throws at a file input given a value                                                                                         | `loadParamText`, `App.tsx` `onLoadParams`                                    | reverted-in-this-audit                                                                                                              |
| URL query: inputs of both forms by name ignoring case, `parseFloat`, radios by value, check box `=== 'true'`                                                                                                                                                  | `param-file.ts` `urlSettings`                                                | identical; drop-downs keep only option values (see remaining differences)                                                           |
| Recalculate on any parameter input or "Use attitude" change; operating-point inputs (throttle, motors, RPMs) and window/time inputs do not                                                                                                                    | `App.tsx` `recalculateIfStale`, live `useMemo`s                              | convenience, see below                                                                                                              |
| "Calculate" button                                                                                                                                                                                                                                            | `ui/Rail.tsx`                                                                | identical (enabled when the window, FFT size or log changed since the last calculation)                                             |
| `window.onerror` alert                                                                                                                                                                                                                                        | error banner                                                                 | crash handling                                                                                                                      |
| `OpenIn.js` and `LoadingOverlay.js` loaded but unused                                                                                                                                                                                                         | `OpenInButton`, `useLoading`                                                 | convenience (an "Open in" menu and a loading overlay; no result changes)                                                            |

## Remaining intentional differences

- **When results are recalculated.** Upstream calculates only when Calculate is pressed or a
  parameter input or the "Use attitude" box changes (each reading the window, FFT size and every
  input afresh); loading a log, picking a run, loading a `.param` file and changing the throttle,
  motor count or RPM inputs leave the plots as they were. The port calculates on loading a log
  and on picking a run, follows every input live, and, when the analysis window or FFT size has
  been edited since the last calculation, recalculates on a parameter change or file load as
  upstream's change handlers do. Every result shown is the one upstream shows after pressing
  Calculate with the same inputs.
- **Failures.** Where upstream throws (and its `window.onerror` alerts "Sorry, something went
  wrong"), the port shows a message saying why: fixed-wing yaw, notch selections naming no
  `FILTn` group, window shorter than one FFT window, logs it cannot read. After a failed load
  upstream has already replaced its log and may have changed the axis and plots, leaving an
  inconsistent page; the port keeps the previous log (and, as upstream, any parameters copied
  before the failure).
- **Input text forms.** Upstream compares and concatenates the notch selection inputs as text:
  `ATC_RAT_RLL_NTF` holding `1.0` or `1e0` (possible from a `.param` file) builds the id `FILT1.0`
  and throws, and an `NTF` of `1` with an `NEF` of `1.0` saves `FILT1` twice. The port holds
  numbers, so those spellings behave as `1`.
- **URL and drop-downs.** Upstream reads the URL on page load while its metadata loader may still
  be replacing the enumerated inputs with drop-downs (a race): before, the value is copied into the
  drop-down (only if it is an option); after, the drop-down is not an `input` and the query is
  ignored. The port follows the first order.
- **Fixed-wing yaw.** Upstream has no fixed-wing yaw rate controller inputs except the notch
  selections `YAW_RATE_NTF`/`NEF`; its calculation throws. The port has no fixed-wing yaw target
  and says so; it shows the two notch selections (and the `FILTn` groups they select) in the rail,
  and saves the fixed-wing yaw file (row 112 fix). No prediction uses them, as upstream never
  computes one.
- **Layout and wording**: the parameter rail, chips for the graph settings, labels and help
  texts, a note when the run does not excite the selected loop.

## Upstream bugs reproduced

| Bug                                                       | Where (upstream)                                                                             | Reproduction                                                    | Effect                                                                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicle outlives its log                                  | global `vehicle_type`, only set from a firmware banner                                       | `load-upstream.test.ts`: plane log, then a log without a banner | A log without a banner is analysed (and its parameters read) as the previous log's vehicle                                                                                                        |
| Drop-down parameters lose values that are not option text | `parameter_set_value` on the `<select>` built by `load_param_inputs`                         | `load-upstream.test.ts` (logged `MODE` 7)                       | The value becomes empty, read as NaN: an `ENABLE` of NaN enables the notch (`enable <= 0` is false), a `MODE` of NaN is a fixed notch. Numbers equal to an option are a proven bug, fixed (below) |
| Signals at different log rates analysed as one rate       | loaders slice each message by its own nearest indices; `run_fft` windows follow `PilotInput` | `pipeline.test.ts` "copter with slow ATT"                       | Attitude logged slower than `RATE` is treated as if at the `RATE` rate; windows past its end make the attitude-based responses NaN                                                                |
| Fixed-wing yaw throws                                     | `update_PID_filters`: no `FWYawPIDS` element                                                 | `load-upstream.test.ts`                                         | No fixed-wing yaw analysis; the run selection also stops before zooming                                                                                                                           |
| Notch selection outside 1-8 throws                        | `update_PID_filters`, `calculate_predicted_TF` build `FILT<n>` ids                           | `load-upstream.test.ts` (1.5)                                   | The calculation stops for a non-integer selection; integers 9 and above are a proven bug, fixed (below)                                                                                           |
| A plane log without `SIDS` stops the load                 | `load_log`: `sid_sets.axis[0]`                                                               | `load-upstream.test.ts`                                         | Only the harmonic notch parameters are copied                                                                                                                                                     |
| `.param` lines are not trimmed                            | `load_parameters`                                                                            | `param-file.test.ts`                                            | Indented lines are ignored                                                                                                                                                                        |

## Proven upstream bugs fixed

Fixed only because each is proven to the standard in [`../bug-proofs/README.md`](../bug-proofs/README.md); verdicts,
evidence and test names are in [`../bug-proofs/analytic-tune.md`](../bug-proofs/analytic-tune.md).

- **Un-wrapped phase option has no effect** (`redraw_freq_resp`, `unwrap_ph = false`). The port plots upstream's
  `unwrap` of the phase when "un-wrapped" is selected (`display.ts` `phaseOf`); the wrapped phase is unchanged.
- **Airspeed scaling outlives its log** (globals `aspeed`, `eas2tas`). A multirotor prediction uses (1, 1)
  (`time-history.ts` `airspeedScalingFor`); fixed-wing predictions are unchanged.
- **Drop-down parameters lose numbers equal to an option** (`parameter_set_value` on a `<select>`). `INS_HNTCH_ENABLE
0.000000` reads 0 and `MODE 1.000000` reads 1 (`form-values.ts` `inputValueFromText`); other non-option text is still
  NaN.
- **Sample rate counts samples, not intervals** (`length / trecord`). The rate is `(n - 1) / record` (`time-history.ts`
  `averageRate`); the oracle tests compare with the page patched the same way.
- **Loops run one past the end** (`calculate_predicted_TF`). The port never reproduced the extra NaN element; no change.
- **Notch selection of 9 or more throws** (`FILT<n>` ids). The firmware applies no notch for such an index; the port
  predicts as for 0 (`predict.ts`). A non-integer selection still stops.
- **A `SIDS` record without data stops the load** (`add_sid_sets`). The run table lists the records with data and the
  load continues (`sid.ts` `findSidRuns`).
- **A file input named in a `.param` file stops the load** (`load_parameters`). The line is skipped and the rest applied
  (`param-file.ts` `loadParamText`).
- **SID axes 22 and 23** (`add_sid_sets`, `set_sid_axis`). The firmware defines 22 as FW mixer roll and 23 as FW mixer
  pitch; the port names and maps them so (`sid.ts`). 24 to 26 keep upstream's names and axes.
- **Shared filter models:** the chained harmonic-notch spread fix in `@apwt/filters` (see [`filters.md`](filters.md));
  `filters.test.ts` compares with upstream patched the same way.
- **Fixed-wing yaw save throws** (`save_parameters`, empty pilot prefix matches the bitmask check boxes). The rule is
  skipped for an empty prefix and the file upstream otherwise builds is saved: `YAW_RATE_NTF`/`NEF`, the `FILTn` groups they
  select, every `INS_` and `SCHED_` parameter (`param-file.ts`). `YAW_RATE_NTF`/`NEF` are now inputs, read from fixed-wing
  logs, `.param` files and links as upstream does, and shown in the rail for fixed-wing yaw.
- **Fixed-wing yaw throws** and **a plane log without `SIDS` stops the load** are proven failures with no defined result;
  the port already reports them (error banner), no change.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in dark and light: empty, a
synthetic copter SID log with two runs (`apps/analytic-tune/test-fixtures/copter-sid.bin`, made
with `buildSidLog` from `src/analysis/test-utils/synthetic.ts`: roll angle and rate roll runs,
one harmonic notch and one FILT notch) and the second run selected. The run table, rail fields,
groups, chips and Calculate work from the keyboard. No console errors, overflow or clipped text.
Compared against `upstream/AnalyticTune/index.html`: every input, graph setting, control loop,
the run table, Load/Save parameters and the coherence plot are present.

Changed (presentation only):

- Parameter rail groups (INS settings, both notches, notch tracking, loop rate, controller,
  controller notches) collapse, with the notch state in the heading; a notch that is off starts
  folded. The two rail cards (analysis, parameters) are now spaced apart.
- Fields use the same two-column grid and 128 px control width as Filter Tool, including the
  analysis window and FFT size inputs. Parameter names no longer break mid-word.
- An unfocused number field shows at most 7 significant digits, so logged float values such as
  0.20000000298023224 read 0.2 and fit; the full value is shown while editing and is the one used
  and saved.
- The control loop chips have a "Control loop" label; plot options wrap as label plus chips;
  "±180°" and "rad/s" spelt as units; run table units no longer uppercase ("(s)", not "(S)").
- The flight data card shows an empty state that says what to open instead of empty axes.
- Rail note now points to the System ID runs card (it said "below the plots").

Remaining: the flight data plot has four y axes, which leaves a narrow plot area on phones; the
analysis window inputs show the run times unrounded (as upstream fills them, and as calculated).
