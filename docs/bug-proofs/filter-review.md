# Filter Review: bug proofs

Verdicts for the Filter Review rows of [`../upstream-bugs.md`](../upstream-bugs.md), against the
standard in [`README.md`](README.md). Reproductions are in `proofs/filter-review/`. They run the
original page (`upstream/FilterReview` and the Libraries its `index.html` loads) in `node:vm` with a
DOM stub that follows the HTML specification where upstream relies on it (radio groups, a `<select>`
only holding one of its option values, number input sanitization, file inputs refusing a value).
Logs are passed in as plain objects with the parser interface FilterReview reads
(`proofs/filter-review/_harness.ts`). File references are to `upstream/FilterReview/FilterReview.js`
unless stated otherwise.

| #   | Row                                                                 | Verdict                      | Reason                                                                                                                        |
| --- | ------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Batch data can never be used when the log also has raw data         | PROVEN                       | `load()` says "Have both, use selected", but its own `reset()` call has just replaced the selection with Raw                  |
| 2   | Raw batches lose their last `i` samples on instance `i`             | PROVEN                       | The IMU instance number is subtracted from a sample index; identical data on two instances gives different batches            |
| 3   | Raw-log rate looked up by log instance, not sensor                  | PROVEN                       | `gyro_rate` is indexed by sensor; `load_from_batch` indexes it by `sensor_num`, `load_from_raw_log` by log instance           |
| 4   | FFT sample rate is the first batch's rate                           | PROVEN                       | The loop commented "Average sample time" sums `data_set[0]` once per batch                                                    |
| 5   | Throttle at index 0 ignored for auto-zoom                           | PROVEN                       | `findIndex` returns 0 for a match at the first sample; `if (first_index)` treats it as not found ("If found use zoom ...")    |
| 6   | No FFT frequencies without FTN2, even for the FTN1 peak             | PROVEN                       | Same class, same config: the spectrogram target uses FTN1 alone, the estimate returns null because FTN2 peaks are missing     |
| 7   | FTN2 without FTN1 stops the calculation                             | PROVEN                       | It fails: `interpolate` throws a TypeError                                                                                    |
| 8   | Inputs a later log does not set keep the previous log's values      | NOT PROVEN                   | Nothing in the page says a value missing from a log must be reset; keeping it is a reasonable reading                         |
| 9   | Drop-down values it does not offer read as NaN                      | PROVEN                       | `INS_HNTCH_ENABLE` 2 is enabled in ArduPilot (`enabled()` returns `_enable`); `1.0` is 1 to ArduPilot's parser                |
| 10  | Parameter files can set non-parameter inputs and can abort part way | PROVEN (abort only)          | Abort: it fails (throws part way). Setting non-parameter inputs: NOT PROVEN, no stated intent                                 |
| 11  | Batch window size written into the raw window-size input            | NOT PROVEN                   | The write is deliberate and visible; nothing says a later log must start from the user's earlier window size                  |
| 12  | Single-window range shifts the wrapped phase band twice             | PROVEN                       | "Wrap all arrays based on first" is applied twice to one array; with one window max = min = mean, yet the band is 360 deg off |
| 13  | Empty, zero or negative loop rate crashes the redraw with aliasing  | PROVEN (crash; no new maths) | It fails: `new Array(NaN)` / negative length throws `RangeError`                                                              |
| 14  | Open in Filter Tool sends the gyro rate as `GYRO_SAMPLE_RATE`       | PROVEN                       | It fails: the rate the link carries ("Add sample rate ...") is read by no input; the Filter Tool stays at 2000 Hz             |

PROVEN 12 (two of them partial or crash-only, see 10 and 13), NOT PROVEN 2.

## 1. Batch data can never be used when the log also has raw data

**Row:** `FilterReview/FilterReview.js` `load()` calls `reset()` (ticks raw) before reading the log
type. The batch option is dead for such logs.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/load.ts` `loadFilterReviewLog(..., preferBatch)` and `apps/filter-review/src/analysis/session.ts` `loadIntoPage`; `apps/filter-review/src/App.tsx` passes the log type chosen before loading (then shows the type used). Test: `apps/filter-review/src/analysis/page.test.ts` "proven upstream bug fixed: a log with both raw and batch data uses batch when \"Batch\" is ticked". The oracle tests compare the port with upstream patched as the port behaves (`apps/filter-review/src/analysis/test-utils/proven-fixes.ts`, loaded with `{ fixed: true }`), and check the original's result where the input reaches the bug.

**Reproduction:** `proofs/filter-review/batch-option-dead.test.ts`. After start-up both radios are
enabled; the user ticks Batch; `load()` on a log with ISBH, ISBD and GYR calls `load_from_raw_log`,
never `load_from_batch`, and afterwards Raw is ticked.

**Evidence (contradicts itself, and never produces the output its UI offers):**

- `reset()`, called first thing in `load()` (`FilterReview.js:2333`):
  `FilterReview.js:366` `document.getElementById("log_type_raw").checked = true` (same radio group
  `log_type` as Batch, `index.html:81-83`, so Batch is unticked) and `FilterReview.js:367-368`
  enable both radios so the user can choose.
- `FilterReview.js:2392-2394`:
  ```js
  } else {
      // Have both, use selected
      use_batch = document.getElementById("log_type_batch").checked
  ```
  Nothing between `reset()` and this line can tick Batch, so "use selected" always reads false.

**Minimal correct behaviour:** for the reproduction, `load_from_batch` is called and Batch stays
ticked. The fix reads the user's log type choice before `reset()` replaces it (in the port: the
batch/raw choice made before loading is the one used when a log has both), nothing else.

## 2. Raw batches lose their last `i` samples on instance `i`

**Row:** `load_from_raw_log` (`slice(batch_start, j-i)`). Shorter batches on higher instances.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/load-raw.ts` `splitRawBatches` (slices to `j`). Test: `apps/filter-review/src/analysis/load.test.ts` "splits pre/post instances with INS_RAW_LOG_OPT bit 3" (original: instance 3 three samples shorter; port: equal) and "matches upstream load_from_raw_log". The oracle tests compare the port with upstream patched as the port behaves (`apps/filter-review/src/analysis/test-utils/proven-fixes.ts`, loaded with `{ fixed: true }`), and check the original's result where the input reaches the bug.

**Reproduction:** `proofs/filter-review/raw-batch-short.test.ts`. Two GYR instances with the same
100 samples at 1 ms: both get sample rate `1e6 / (98000 / 99)`, but instance 0 keeps 99 samples
per axis and instance 1 keeps 98.

**Evidence (contradicts itself: a variable named for one quantity used as another):**

- `i` is the GYR log instance: `FilterReview.js:2227` `const i = parseFloat(inst)`, used as
  `Gyro_batch[i]` and `Gyro_batch[i].sensor_num = i` (`:2235`).
- `FilterReview.js:2269-2271` `x: GyrX.slice(batch_start, j-i)` (same for y, z): an instance number
  subtracted from a sample index of that instance's own arrays.
- The same batch's rate is computed over `count = j - batch_start` samples (`:2263`
  `const sample_rate = 1000000 / ((time[j-1] - time[batch_start]) / count)`), and the time span is
  later taken as `x.length / sample_rate` (`:2309`), so the slice is meant to hold the `count`
  samples of the batch. Only for `i = 0` does it.

**Minimal correct behaviour:** every instance keeps the same samples as instance 0: for the
reproduction, 99 samples per axis on both instances. Change `j-i` to `j` in the three slices,
nothing else.

## 3. Raw-log rate looked up by log instance, not sensor

**Row:** `load_from_raw_log` (`gyro_rate[i]`). Post-filter instances not raised to their IMU's
rate.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/load-raw.ts` `loadFromRaw` (`ctx.gyroRate[sensorNum]`). Test: `apps/filter-review/src/analysis/load.test.ts` "splits pre/post instances with INS_RAW_LOG_OPT bit 3" (post-filter instance at its sensor's rate). The oracle tests compare the port with upstream patched as the port behaves (`apps/filter-review/src/analysis/test-utils/proven-fixes.ts`, loaded with `{ fixed: true }`), and check the original's result where the input reaches the bug.

**Reproduction:** `proofs/filter-review/raw-rate-by-instance.test.ts`. One gyro, IMU rate 2000 Hz,
`INS_RAW_LOG_OPT` 8 (pre and post): instance 0 (sensor 0, pre) gets `gyro_rate` 2000, instance 1
(sensor 0, post) keeps its measured `1e6 / (98000 / 99)` Hz.

**Evidence (contradicts itself, and contradicts ArduPilot):**

- `gyro_rate` is indexed by sensor: `FilterReview.js:2360`
  `gyro_rate[i] = array_mean(log.get_instance("IMU", i, "GHz"))` inside the loop over
  `INS_GYR_ID`, `INS_GYR2_ID`, `INS_GYR3_ID`.
- The post-filter instance belongs to sensor `i - num_gyro`: `FilterReview.js:2231-2233` (`sensor_num = i - num_gyro`, `post_filter = true`).
- `FilterReview.js:2290-2292`:
  ```js
  if (gyro_rate[i] != null) {
      // Make sure rate is at least the reported sampling rate
      Gyro_batch[i].gyro_rate = Math.max(gyro_rate[i], Gyro_batch[i].gyro_rate)
  ```
- The batch loader does the same step with the same comment by sensor number,
  `FilterReview.js:2176-2179`:
  `if (gyro_rate[Gyro_batch[i].sensor_num] != null) { // Make sure rate is at least the reported sampling rate`.
- ArduPilot writes the post-filter instance from the same sample of the same sensor:
  `upstream/modules/ardupilot/libraries/AP_InertialSensor/AP_InertialSensor_Backend.cpp:491-492`
  `Write_GYR(instance, sample_us, raw_gyro);` /
  `Write_GYR(instance + _imu._gyro_count, sample_us, filtered_gyro);`, so its reported rate is
  that sensor's `IMU.GHz`.

**Minimal correct behaviour:** for the reproduction both instances get `gyro_rate` 2000. Index
`gyro_rate` by `Gyro_batch[i].sensor_num` in those two lines, as `load_from_batch` does; nothing
else.

## 4. FFT sample rate is the first batch's rate

**Row:** `run_batch_fft` (`data_set[0].sample_rate`). Bins and times use the first batch's rate.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/fft/batch-fft.ts` `runGyroFft` (averages the rates of the batches long enough for a window, after the window size is known; with no such batch, the original's value). Tests: `apps/filter-review/src/analysis/fft/batch-fft.test.ts` "averages the rates of the batches it uses, where upstream uses the first batch rate" (original 1000 Hz, port 1500 Hz) and "is unchanged when every batch has the same rate, or when no batch is long enough"; `apps/filter-review/src/analysis/pipeline.test.ts`.

**Reproduction:** `proofs/filter-review/fft-rate-first-batch.test.ts`. Raw type, window 64, two
64-sample batches at 1000 Hz and 2000 Hz: `average_sample_rate` 1000, top bin 500 Hz, window
times `[0.032, 10.032]`.

**Evidence (contradicts itself):** `FilterReview.js:283-293`:

```js
for (let i = 0; i < num_batch; i++) {
  if (data_set[i].x.length < window_size) {
    // Log section is too short, skip
    continue
  }
  sample_rate_count++
  sample_rate_sum += data_set[0].sample_rate
}

// Average sample time
const sample_time = sample_rate_count / sample_rate_sum
```

The loop runs over the batches and skips by `data_set[i]`, the result is called an average
(`:292`, and `average_sample_rate: 1/sample_time` at `:351`), but every term is `data_set[0]`.

**Minimal correct behaviour:** for the reproduction `average_sample_rate` is 1500 (top bin 750 Hz,
times `[32/1500, 10 + 32/1500]`). Change `data_set[0]` to `data_set[i]` at `:289`.

Note for the fix: in the same loop `window_size` is still `undefined` (it is a hoisted `var`,
assigned at `:299-310`), so `x.length < window_size` is never true and the stated skip ("Log
section is too short, skip", `:285`) never happens. With `data_set[0]` this has no effect on the
result; once each batch's own rate is summed it would let too-short batches into the average. A
fix that sums `data_set[i]` must therefore run this loop after `window_size` is set (it does not
depend on the rate), so it skips exactly the batches the FFT loop at `:334-338` skips.

## 5. Throttle at index 0 ignored for auto-zoom

**Row:** `load()` (`if (first_index)`). Analysis window not cropped.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/flight-data.ts` `throttleActiveRange` (`>= 0`). Test: `apps/filter-review/src/analysis/misc.test.ts` "crops to a throttle that is positive from the first sample (proven upstream bug fixed, row 5)".

**Reproduction:** `proofs/filter-review/throttle-index-zero.test.ts`. Gyro data 0 s to 10 s,
`RATE.AOut` every 0.1 s. Throttle rising at the second sample, falling at the last: window 2 s to
8 s. Throttle already positive at the first sample: window 0 s to 10 s (no crop).

**Evidence (contradicts itself and the specification of `findIndex`):** `FilterReview.js:2506-2516`:

```js
// Find first and last throttle for auto-zoom of plot
...
const first_index = throttle.findIndex(positive_throttle)
const last_index = throttle.findLastIndex(positive_throttle)
if (first_index) {
    first_throttle_time = RATE_time[first_index]
}
if (last_index) {
```

and `:2572` `// If found use zoom to none zero throttle`. `Array.prototype.findIndex` returns the
index of the first match, 0 when the first sample matches, and -1 when none does (ECMAScript
specification). `if (first_index)` is false for a throttle found at index 0 and true for -1, so a
found throttle is treated as not found.

**Minimal correct behaviour:** for the second case the window is 1 s to 8 s
(`ceil(0) + 1`, `floor(9.9) - 1`). Test `first_index >= 0` and `last_index >= 0` instead (for -1
`RATE_time[-1]` is `undefined`, so not-found behaves as today); nothing else.

## 6. No FFT frequencies without FTN2, even for the FTN1 peak

**Row:** `FilterReview/tracking/FFT.js` `get_interpolated_target_freq`. FFT notch not applied to
the estimate.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/tracking/fft.ts` `FftTarget.interpolate`. Tests: `apps/filter-review/src/analysis/tracking/tracking.test.ts` "FFT target with FTN1 but no FTN2 (proven upstream bug fixed, row 6)".

**Reproduction:** `proofs/filter-review/fft-ftn1-only.test.ts`. Centre-peak tracking (options 0,
REF 1, FREQ 80), `FTN1.PkAvg` 100 Hz. With FTN2 also logged the estimate target is `[100]`. With
only FTN1, `have_data()` is true and the spectrogram target is `[100, 100]`, but the estimate
target is `null`.

**Evidence (contradicts itself):**

- `tracking/FFT.js:54-55`
  `if (... || (this.data.interpolated[instance].length == 0)) { return null }`. The array's length
  is the number of FTN2 peaks (`:47-50`); FTN1 goes into its `.value` (`:51`).
- The centre-peak branch it guards reads only FTN1: `tracking/FFT.js:69`
  `return [this.get_target(config, this.data.interpolated[instance].value[index])]`.
- The same class, for the same config, gives the FTN1 target without FTN2 in `get_target_freq`
  (`tracking/FFT.js:107-113`, `// Just center peak`), and `have_data()`
  (`tracking/BaseClass.js:56-57`) reports data, so `HarmonicNotchFilter` counts the notch as
  enabled and raises no "No tracking data" message (`FilterReview.js:177`, `:189`), yet its
  `transfer` applies nothing when the target is `null` (`FilterReview.js:253-255`).

Context: ArduPilot at the pinned commit writes FTN2 (centre peak) every time it writes FTN1
(`upstream/modules/ardupilot/libraries/AP_GyroFFT/AP_GyroFFT.cpp:1001-1017`), so this only shows on
logs where FTN2 is missing for another reason.

**Minimal correct behaviour:** for the reproduction the FTN1-only estimate target is `[100]`. Drop
the `.length == 0` condition from the guard at `tracking/FFT.js:55`; with no FTN2, dynamic
tracking then returns `[]` (no notch, as today) and centre-peak tracking uses FTN1.

## 7. FTN2 without FTN1 stops the calculation

**Row:** `FilterReview/tracking/FFT.js` `interpolate` (`linear_interp` on undefined). Log cannot be
analysed.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/tracking/fft.ts` `FftTarget.interpolate` (no centre peak without FTN1; the FTN2 peaks still track). Tests: `apps/filter-review/src/analysis/tracking/tracking.test.ts` "FFT target with FTN2 but no FTN1 (proven upstream bug fixed, row 7)".

**Reproduction:** `proofs/filter-review/fft-ftn2-only.test.ts`. `have_data()` is true and
`interpolate(0, [0.5])` throws `Cannot read properties of undefined (reading 'length')`.
`calculate()` calls `interpolate` on every tracking source (`FilterReview.js:875-877`), whatever the
notch settings.

**Evidence (it fails):** `tracking/FFT.js:51`
`this.data.interpolated[instance].value = linear_interp(this.data.value, this.data.time, time)`;
without FTN1 the base constructor returns before setting `data.time`/`data.value`
(`tracking/BaseClass.js:13-16`), and `linear_interp` reads `index.length`
(`Libraries/Array_Math.js:248`). Same context as row 6: firmware at the pinned commit logs both
messages together.

**Minimal correct behaviour:** `calculate()` completes for such a log; the FTN2 peaks are
interpolated and no centre-peak (FTN1) value exists. Skip the `.value` interpolation when
`this.data.value` is missing. A centre-peak FFT notch on such a log must then treat the target as
unavailable (it reads `.value` at `tracking/FFT.js:69` and `:108`), i.e. return no frequency, as for
a missing source.

## 8. Inputs a later log does not set keep the previous log's values

**Row:** `reset()` rewrites only six defaults. A second log is simulated with the first log's
`_ENABLE`/`_REF`/`_OPTS`/`INS_GYRO_FILTER`/`SCHED_LOOP_RATE`.

**Verdict:** NOT PROVEN

**Reproduction:** `proofs/filter-review/reset-keeps-values.test.ts`. After values 0.5, 2, 1, 40, 800
for `INS_HNTCH_REF`, `_OPTS`, `_ENABLE`, `INS_GYRO_FILTER`, `SCHED_LOOP_RATE`, `reset()` sets
`INS_HNTCH_FREQ` back to 80 and leaves the others as they were.

**Why not proven:** `FilterReview.js:460` `// Set param defaults that are none 0` describes what the
loop does; nothing in the page states that a parameter absent from a log must return to its
default, and keeping the user's or previous value for inputs the log does not provide is a
reasonable reading. No ArduPilot reference applies to a parameter the log does not contain.
Reproduced.

## 9. Drop-down values it does not offer read as NaN

**Row:** `parameter_set_value` on `<select>`. Notch disabled; "Unsupported notch mode NaN".

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/page-values.ts` `assignedValue` (a value a drop-down does not offer is kept as its number); `apps/filter-review/src/ui/NotchEditor.tsx` shows such values. Tests: `apps/filter-review/src/analysis/page.test.ts` "proven upstream bug fixed: keeps a drop-down value it does not offer as its number" and "sets the same inputs and filters as upstream" (page stub with `fixed` applies the same rule); `apps/filter-review/src/analysis/param-file.test.ts`.

**Reproduction:** `proofs/filter-review/select-nan.test.ts`. `INS_HNTCH_ENABLE` 2 from a log: the
drop-down holds `""`, `parameter_get_value` gives NaN and `HarmonicNotchFilter.enabled()` is false.
`INS_HNTCH_MODE,1.0` from a parameter file: NaN, alert `Unsupported notch mode NaN`.
`INS_HNTCH_ENABLE,1.0`: NaN, not enabled.

**Evidence (contradicts ArduPilot):**

- The drop-downs offer only the `Values` of `FilterReview/params.json` (0, 1 for `_ENABLE`; 0-5 for
  `_MODE`), built by `Libraries/ParameterMetadata.js:229-245`; `parameter_set_value` assigns
  `param.value = value` (`ParameterMetadata.js:10`), which selects nothing for any other text (HTML
  `select.value` setter), and `parameter_get_value` returns `parseFloat("")`, NaN
  (`ParameterMetadata.js:43`).
- `FilterReview.js:189` enables only when `this.params.enable > 0`; NaN is not.
- ArduPilot applies the notch whenever `_enable` is non-zero:
  `upstream/modules/ardupilot/libraries/Filter/NotchFilter.h:70`
  `uint8_t enabled(void) const { return _enable; }` and
  `libraries/AP_InertialSensor/AP_InertialSensor_Backend.cpp:228`
  `if (!notch.params.enabled()) { continue; }`. So `INS_HNTCH_ENABLE` 2 runs the notch.
- ArduPilot reads parameter file values as floats:
  `libraries/AP_Param/AP_Param.cpp:2301` `value = strtof(value_s, NULL);`, so `1.0` is 1
  (Enabled; for `_MODE`, Throttle, `libraries/Filter/HarmonicNotchFilter.h:96-98`).

**Minimal correct behaviour:** for the reproduction, `INS_HNTCH_ENABLE` 2 is enabled (2 > 0),
`INS_HNTCH_MODE` `1.0` is mode 1 (Throttle, no alert) and `INS_HNTCH_ENABLE` `1.0` is enabled. In
the port, a value assigned to one of these four parameters is kept as its number (`parseFloat` of
the text) when it is not one of the offered options, instead of becoming `""`; nothing else. A
value no mode exists for (e.g. 7) still gives "Unsupported notch mode 7", which matches the
firmware enum.

## 10. Parameter files can set non-parameter inputs and can abort part way

**Row:** `load_parameters` (`getElementById`, no catch). Unexpected analysis window or window size;
partly applied file.

**Verdict:** PROVEN for the abort; NOT PROVEN for setting non-parameter inputs.

**Status: FIXED** for the abort only; setting non-parameter inputs stays reproduced. Port: `apps/filter-review/src/analysis/param-file.ts` `applyParamFile` (`skipped` lines); `App.tsx` reports them and applies the rest. Test: `apps/filter-review/src/analysis/page.test.ts` "proven upstream bug fixed: skips a line naming a file input, where upstream throws and stops".

**Reproduction:** `proofs/filter-review/param-file-inputs.test.ts`. `TimeStart,12` sets the analysis
start to 12. `INS_HNTCH_BW,30` / `fileItem,x` / `INS_HNTCH_FREQ,90`: the promise rejects at
`fileItem` (setting a file input's value to a non-empty string throws `InvalidStateError`, HTML
specification), BW is 30, FREQ stays 80, and `filter_param_read()` / `re_calc()` never run.

**Evidence:**

- Abort (it fails): `FilterReview.js:1987-2005` calls `parameter_set_value(vname, value)` for every
  line with no `try`, and `filter_param_read(); re_calc()` only after the loop; the throw from
  `ParameterMetadata.js:10` `param.value = value` on `fileItem` (`index.html:143`, `type="file"`)
  ends the function.
- Non-parameter inputs: `parameter_set_value` looks up any id (`ParameterMetadata.js:4`). Nothing
  in the page says only parameters may be set, and a parameter file is only expected to name
  parameters; no reference makes this wrong. Reproduced.

**Minimal correct behaviour (abort):** for the reproduction FREQ becomes 90 and the recalculation
runs once; a line naming an input whose value cannot be set is skipped and the rest of the file is
applied. Nothing else changes (other ids remain settable).

## 11. Batch window size written into the raw window-size input

**Row:** `calculate()` sets `FFTWindow_size`. A later raw log uses the batch-derived window.

**Verdict:** NOT PROVEN

**Reproduction:** `proofs/filter-review/batch-window-size-kept.test.ts`. A batch of 1024 samples with
3 windows per batch: `calculate()` writes 512 into `FFTWindow_size`, and `reset()` leaves 512 there
for the next log.

**Why not proven:** the write is deliberate (`FilterReview.js:809`, `:831-833`
`document.getElementById("FFTWindow_size").value = window_size`) and shows the user the size in
use; the value a later raw log runs with is on screen in an editable input. Nothing in the page
states that a new log must start from the window size the user typed before a batch log. Reproduced.

## 12. Single-window range shifts the wrapped phase band twice

**Row:** `redraw_post_estimate_and_bode` / `phase_scale` (in place on a shared array). Max/min band
360 deg off the mean.

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-review/src/analysis/plots/bode.ts` `bodeResponse` (max and min of a single window are distinct arrays). Test: `apps/filter-review/src/analysis/pipeline.test.ts` "agrees on FFTs, transfer functions and every plot trace" (one-window range with wrap, against the page with min copied). `wrapPhase` (`@apwt/filters`) is unchanged.

**Reproduction:** `proofs/filter-review/phase-band-double-shift.test.ts`. With ±180 wrapping, one
window with phase `[0, 200]`: mean `[0, -160]`, max and min `[0, -520]`. With three different arrays
the band moves with the mean (`[0, -150]`, `[0, -170]`).

**Evidence (contradicts itself and mathematics):**

- With one window (`start_index + 1 == end_index`, `FilterReview.js:1400-1401`) the loop takes the
  `else` branch once: `:1428-1429` `Phase_max = HR_phase` / `Phase_min = HR_phase`, the same array.
- `FilterReview.js:1079-1090`:
  ```js
  // Wrap all arrays based on first
  ...
  if (phase[0][i] > 180) {
      for (let j = 0; j < arrays; j++) {
          phase[j][i] -= 360
  ```
  is called with `[Phase_mean, Phase_max, Phase_min]` (`:1440`), so the shared array is shifted
  twice for each shift of the first.
- The max and min of a single value are that value, so the band must coincide with the mean.

**Minimal correct behaviour:** for the reproduction max and min are `[0, -160]`. Each array is
shifted once per shift of the first (in the port: wrap a copy for max/min, or shift each distinct
array once); nothing else.

## 13. Empty, zero or negative loop rate crashes the redraw with aliasing on

**Row:** `get_alias_obj` (`new Array(NaN)`). Plots not redrawn.

**Verdict:** PROVEN (crash); no change to any computed value is proven.

**Status: no port change needed.** The port already reports the error instead of crashing: `apps/filter-review/src/analysis/plots/alias.ts` throws `RangeError('Invalid array length')` as upstream, shown as an error; test `apps/filter-review/src/analysis/misc.test.ts` "throws like upstream new Array() for an empty, zero or negative loop rate".

**Reproduction:** `proofs/filter-review/alias-loop-rate.test.ts`. With "Show" aliasing,
`SCHED_LOOP_RATE` `""`, `0` and `-400` each throw `Invalid array length`; 400 works.

**Evidence (it fails):** `FilterReview.js:974` `const nyquist = parseFloat(...SCHED_LOOP_RATE...) * 0.5`;
`:979` `obj.len = Math.ceil(nyquist / ...) + 1` is NaN (empty) or negative (-400);
`:981` `obj.bins = new Array(obj.len)` throws. For 0, `obj.len` is 1, `re_sample_dt` is `0/0`, and
`:988` `new Array(total_bins)` throws with `total_bins` NaN.

**Minimal correct behaviour:** the redraw must not stop with an exception. The original defines no
aliasing result for a loop rate that is empty, zero or negative, so a fix must not invent one: the
port's error message instead of the crash (crash clause of `docs/porting-policy.md`) is the whole
fix, and no computed value changes.

## 14. Open in Filter Tool sends the gyro rate as `GYRO_SAMPLE_RATE`, which the Filter Tool never reads

**Row:** `open_in_filter_tool` / `FilterTool/filters.js` `load()`. The Filter Tool opens at its
2000 Hz default whatever the log's IMU rate. Found by the real-log oracle
(`apps/filter-tool/src/analysis/filter-tool.real-logs.test.ts`).

**Verdict:** PROVEN

**Status: FIXED.** Port: `apps/filter-tool/src/analysis/settings.ts` `stateFromQuery` (a link's
`GYRO_SAMPLE_RATE` sets `GyroSampleRate` when the link has no `GyroSampleRate`, read with the same
rules as every other link value). Filter Review's link is unchanged (`filter-tool-link.ts`, still
identical to upstream's). Tests: `apps/filter-tool/src/analysis/page.test.ts` "proven upstream bug
fixed: a Filter Review link sets the gyro rate it carries as GYRO_SAMPLE_RATE" (upstream 2000 Hz,
port 3200 Hz, every other input upstream's); `apps/filter-tool/src/analysis/filter-tool.real-logs.test.ts`.

**Reproduction:** `proofs/filter-review/filter-tool-gyro-rate.test.ts`. The original FilterReview
loads 10 s of raw gyro data sampled every 1000 us; `open_in_filter_tool()` opens
`.../FilterTool/?GYRO_SAMPLE_RATE=1000` (every 250 us: `4000`). The original Filter Tool page opened
at that link reads `GyroSampleRate` 2000 and its gyro Bode plot runs to about 1000 Hz. The same page
opened at `?GyroSampleRate=1000` reads 1000 and plots to about 500 Hz.

**Evidence (it fails):** `FilterReview.js:1917-1935`:

```js
// Add sample rate for sensor show in bode plot
...
url.searchParams.append("GYRO_SAMPLE_RATE", Math.round(Gyro_batch[i].gyro_rate))
```

`FilterTool/filters.js:792-820` (`load()`, "populate from query's") sets an input only when the
lowercased link has a key equal to that input's lowercased `name`; the gyro rate input is
`<input id="GyroSampleRate" name="GyroSampleRate">` (`FilterTool/index.html:100`) and is read as
`get_form("GyroSampleRate")` (`filters.js:447`, `:582`). No file in upstream reads `GYRO_SAMPLE_RATE`.
The value Filter Review adds for the Filter Tool's Bode plot therefore never reaches it: the
output the "Open in filter tool" button offers is never produced.

**Minimal correct behaviour:** for the reproduction the Filter Tool reads `GyroSampleRate` 1000
from the link. Smallest port change: the Filter Tool's link reader takes `GYRO_SAMPLE_RATE` as the
gyro sample rate when the link has no `GyroSampleRate` (Filter Review's links never do), applying
the same `parseFloat`/skip-`NaN` rule as for every other value.
