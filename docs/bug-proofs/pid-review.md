# PID Review: bug proofs

Verdicts for the PID Review rows of [`../upstream-bugs.md`](../upstream-bugs.md), against the
[standard](README.md). Reproductions are in [`proofs/pid-review/`](../../proofs/pid-review/); they load
upstream `PIDReview/PIDReview.js` with `Libraries/Array_Math.js` and `Libraries/fft.js` in `node:vm`
(`_harness.ts`). Line numbers are in `upstream/PIDReview/PIDReview.js` unless stated.

| Row                                                                        | Verdict    | Reason                                                                                                                  |
| -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Batch sample rate divides j-1-start intervals' span by the sample count | PROVEN     | Samples at exactly 400 Hz give a `sample_rate` of 402.02 Hz; the mean rate of uniform samples is 1/interval             |
| 2. Batch data stop one sample short                                        | PROVEN     | The same function counts sample j-1 and measures the batch to `time[j-1]`, but `load` slices it out (partly; see below) |
| 3. Noise-estimate array grows past `real_len`                              | PROVEN     | "Reflect for full spectrum" yields an 83-entry, non-symmetric array for a 64-point window                               |
| 4. Mean step trace not cleared                                             | PROVEN     | After a redraw for a new Analysis time the mean trace is from the old range while its individual trace is empty         |
| 5. Spectrogram forced to Output                                            | PROVEN     | The comment and variable say "if disabled option is set"; an enabled P selection is moved                               |
| 6. `find_end_index` always includes a window; reversed range               | NOT PROVEN | Boundary windows match the functions' own comments; a reversed range gives zero (−0), not a stated wrong result         |

## 1. Batch sample rate divides the span of j-1-start intervals by the sample count

Row: _PID Review | Batch sample rate divides the span of j-1-start intervals by the sample count |
`PIDReview/PIDReview.js` `split_into_batches` | Logging rate, bins, window times and step time axis
scaled by count/intervals (about +0.5 % at 200-sample batches)._

**Verdict: PROVEN** (contradicts mathematics).

**Status: FIXED.** Port: `apps/pid-review/src/analysis/batches.ts` `splitIntoBatches` (`sampleRate = (j - 1 - batchStart) / (time[j - 1] - time[batchStart])`). Tests: `apps/pid-review/src/analysis/batches.test.ts` "returns one batch for steady data" (400 Hz; upstream 402.02 Hz) and "skips samples before a set starts without counting them or moving the batch start". The oracle tests in `apps/pid-review/src/analysis/pipeline.test.ts` compare the port with upstream patched as the port behaves (`apps/pid-review/src/test-utils/proven-fixes.ts`, `createUpstreamPidReview({ fixed: true })`).

**Reproduction:** `proofs/pid-review/batches.test.ts`, "reports 402.02 Hz for 200 samples at exactly
400 Hz" and "reports 323.23 Hz when the parameter set starts at 0.1 s". Input: 200 timestamps
`i / 400`, one parameter set from 0 s. Output: one batch, `sample_rate` = 199 × 400 / 198 =
402.0202 Hz. With the set starting at 0.1 s: 160 × 400 / 198 = 323.23 Hz.

**Evidence:**

```js
// PIDReview.js:1404-1412
        // Take running average of sample time, split into batches for gaps
        ...
        count++
        ...
                const sample_rate = 1 / ((time[j-1] - time[batch_start]) / count)
```

`count` is incremented once per sample `j` after `batch_start` (and not at all for samples before
the set start, `PIDReview.js:1401-1403`), so at a split it is `j - batch_start` (fewer when samples
were skipped), while `time[j-1] - time[batch_start]` spans `j - 1 - batch_start` intervals. The mean
sample period of a series is its span divided by its number of intervals; for samples exactly
1/400 s apart the rate is 400 Hz, not 402.02 Hz (or 323.23 Hz). The value is used as the batch
`sample_rate` (`PIDReview.js:1417`), averaged into `sample_time` in `run_batch_fft`
(`PIDReview.js:43-54`) and from there into the FFT bins, window times and step time axis.

**Minimal correct behaviour:** for the reproduction input the batch rate is exactly 400 Hz (both
cases). Smallest port change: in `apps/pid-review/src/analysis/batches.ts` `splitIntoBatches`,
compute `sampleRate = (j - 1 - batchStart) / (time[j - 1] - time[batchStart])`, leaving `count` in
the gap test and the 64-sample threshold as they are.

## 2. Batch data stop one sample short (`batch_end = j-1` used as an exclusive slice end)

Row: _PID Review | Batch data stop one sample short (`batch_end = j-1` used as an exclusive slice end)
| `PIDReview/PIDReview.js` `split_into_batches` / `load` | The last sample before each split, and the
log's last sample, are never analysed or plotted._

**Verdict: PROVEN** for the sample before each split point (`j - 1`). The "log's last sample" part
is **NOT PROVEN** (see below); the row should read "the last sample before each split (at the end of
the log, the second-to-last sample)".

**Status: FIXED** for the sample before each split; the log's last sample stays reproduced. Port: `apps/pid-review/src/analysis/batches.ts` `splitIntoBatches` (`end: j`). Tests: `apps/pid-review/src/analysis/batches.test.ts` "splits at a gap in the data" ([0, 200) and [200, 399); upstream [0, 199) and [200, 398)) and "returns one batch for steady data". The oracle tests in `apps/pid-review/src/analysis/pipeline.test.ts` compare the port with upstream patched as the port behaves (`apps/pid-review/src/test-utils/proven-fixes.ts`, `createUpstreamPidReview({ fixed: true })`).

**Reproduction:** `proofs/pid-review/batches.test.ts`, "leaves the last sample before a gap, and the
last two of the log, out of every batch". Input: samples 0-99 at 400 Hz, a 1 s gap, samples 100-199
at 400 Hz. Output: batches `[0, 99]` and `[100, 198]` (`batch_start`, `batch_end`); read back with
`slice(batch_start, batch_end)` as `load` does, samples 99, 198 and 199 are in no batch. The first
batch's `sample_rate` equals `1 / (time[99] / 100)`.

**Evidence:**

```js
// PIDReview.js:1374-1377
// Split use the given time array to return split points in log data
// Split at any change in parameters
// Split at any dropped data
// PIDReview.js:1412, 1417, 1426-1427
                const sample_rate = 1 / ((time[j-1] - time[batch_start]) / count)
                ret.push({param_set: param_set, sample_rate: sample_rate, batch_start: batch_start, batch_end: j-1})
            // Start the next batch from this point
            batch_start = j
// PIDReview.js:1597 (and every field to 1614)
time: time.slice(batch.batch_start, batch.batch_end),
```

The same function defines the batch as samples `batch_start` to `j - 1`: its rate is measured from
`time[batch_start]` to `time[j-1]`, and `count` (`j - batch_start`) is the number of samples in
`[batch_start, j-1]`. The next batch starts at `j`. But `load` uses `batch_end = j - 1` as an
exclusive end, so sample `j - 1` belongs to neither batch: the split, described as splitting at
parameter changes and dropped data, also drops a sample that is neither.

Not proven: sample `len - 1` at the end of the log. The batch is closed when `j == len - 1`
(`PIDReview.js:1409`) and, as at every split, sample `j` is outside it; the rate span also ends at
`time[j-1]`. Nothing in the code states that sample `j` belongs to the closing batch, so its
exclusion is consistent with the function's own definition.

**Minimal correct behaviour:** for the reproduction input the batches cover samples 0-99 and
100-198 (only sample 199 is unused). Smallest port change: in
`apps/pid-review/src/analysis/batches.ts` `splitIntoBatches`, push `end: j` (exclusive) instead of
`end: j - 1`; the sample rate is unchanged by this fix.

## 3. Noise-estimate array grows past `real_len` when the 25 Hz cut-off is above half Nyquist

Row: _PID Review | Noise-estimate array grows past `real_len` when the 25 Hz cut-off is above half
Nyquist | `PIDReview/PIDReview.js` `redraw_step` | Malformed regularisation in step responses of
low-rate logs._

**Verdict: PROVEN** (contradicts itself, and the symmetry a double-sided spectrum of a real signal
must have).

**Status: FIXED.** Port: `apps/pid-review/src/analysis/step-response.ts` `noiseEstimate` (reflects the first `realLen` entries). Test: `apps/pid-review/src/analysis/pipeline.test.ts` "matches the fixed noise estimate at low logging rates" (40, 60, 90 Hz logs, every step trace against the fixed page).

**Reproduction:** `proofs/pid-review/step.test.ts`, "is 83 long and not symmetric at 60 Hz, 64
points". Input: one batch of 256 samples, average rate 60 Hz, window 64; the array `redraw_step`
passes to `array_add(Pxx[0], sn)` is captured. Output: length 83 (52 + 31), and `sn[k] !== sn[64-k]`
(e.g. `sn[1] !== sn[63]`). Control ("is a symmetric full spectrum at 400 Hz, 64 points"): length 64,
`sn[k] === sn[64-k]` for every k.

**Evidence:**

```js
// PIDReview.js:1084-1100
    len_lpf += len_lpf - 2 // account for double sided spectrum, DC and Niquist are not copied
    ...
    var sn = (new Array(real_len)).fill(1.0)
    var last_sn = 0
    for (let j=0;j<len_lpf;j++) {
        sn[j] = last_sn + Math.exp((-0.5/sigma**2) * (j-radius)**2)
    ...
    // Reflect for full spectrum
    sn = [...sn, ...sn.slice(1,real_len-1).reverse()]
// PIDReview.js:1157
                Pxx[0] = array_add(Pxx[0], sn)
```

`sn` is allocated with `real_len` entries and reflected with `slice(1, real_len-1)`, which is a
reflection about the Nyquist bin only when `sn.length === real_len`. At 60 Hz, `len_lpf` = 52 > 33,
so the loop extends the array to 52 and the "reflected" half is appended at index 52; `array_add`
(`Libraries/Array_Math.js:152-158`) uses the first 64 entries, so bins 33-63 get unreflected values.
`Pxx = X·conj(X)` of a real signal is symmetric (`Pxx[k] = Pxx[N-k]`); the regulariser added to it
breaks that symmetry, so `H` is no longer Hermitian and its inverse FFT is not real (the code takes
only the real part, `PIDReview.js:1168-1173`).

**Minimal correct behaviour:** for the reproduction input `sn` has 64 entries, `sn[k] === sn[64-k]`,
and its first 33 entries are the values upstream computes now. Smallest port change: in
`apps/pid-review/src/analysis/step-response.ts` `noiseEstimate`, reflect the first `realLen`
entries (`const half = sn.slice(0, realLen)` and `[...half, ...half.slice(1, realLen - 1).reverse()]`).
Logs where `len_lpf <= real_len` are unchanged.

## 4. Mean step trace not cleared when a set has no window above 20 deg/s

Row: _PID Review | Mean step trace not cleared when a set has no window above 20 deg/s |
`PIDReview/PIDReview.js` `redraw_step` | A mean from an earlier range or window size stays on the
plot._

**Verdict: PROVEN** (contradicts itself).

**Status: FIXED.** Port: `apps/pid-review/src/App.tsx` (step responses no longer pass through `carryOverStaleMeans`, which is removed from `apps/pid-review/src/analysis/step-response.ts`). Test: `apps/pid-review/src/analysis/pipeline.test.ts` "proven upstream bug fixed: no step mean for a set with no well-excited window, where upstream keeps a stale one" (the original page's mean trace is non-empty; the port's set is null and matches the fixed page).

**Reproduction:** `proofs/pid-review/step.test.ts`, "keeps the previous range mean when the new range
has no window above 20 deg/s". Input: 1024 samples at 400 Hz, a 5 Hz sine of amplitude 100 for the
first 256 samples and 1 after, window 64. Analysis time 0-100 s, `redraw_step()`, then 2-2.5 s,
`redraw_step()`. Output after the second redraw: individual trace `x = []`, `y = []`; mean trace `y`
identical to the first redraw's mean, `visible: true`.

**Evidence:**

```js
// PIDReview.js:435
        // Each set gets mean step response and individual
// PIDReview.js:1046-1049
        // Clear plot
        const plot_index = i*2
        step_plot.data[plot_index].x = []
        step_plot.data[plot_index].y = []
// PIDReview.js:1129-1130
            const start_index = find_start_index(fft_time)
            const end_index = find_end_index(fft_time)+1
// PIDReview.js:1188-1196
            if (mean_count <= 0) {
                // No good steps, skip this set
                continue
            }
            // Plot mean
            step_plot.data[plot_index+1].x = time
            step_plot.data[plot_index+1].y = array_scale(Step_mean, 1 / mean_count)
```

```html
<!-- PIDReview/index.html:129 -->
data-tippy-content='Zoom into a section of the flight to change the Analysis time then click "Calculate".'
```

The mean trace is defined as the mean of the individual steps of the same redraw
(`Step_mean / mean_count`, summed from the steps pushed to `plot_index` at `PIDReview.js:1176-1181`),
taken over the windows of the current Analysis time. The redraw clears the individual trace and
finds no steps ("skip this set"), yet the plot still shows a mean, which is the mean of steps from a
different Analysis time that the current individual trace does not contain.

**Minimal correct behaviour:** after the second redraw of the reproduction the mean trace has no
points (`x = []`, `y = []`); the first redraw and every set with good steps are unchanged. Smallest
port change: drop the carry-over in `apps/pid-review/src/analysis/step-response.ts`
(`carryOverStaleMeans` returns `next` unchanged, or its call is removed), so a set without good steps
shows no mean.

## 5. Spectrogram forced to Output when any optional signal is missing and an optional one is selected

Row: _PID Review | Spectrogram forced to Output when any optional signal is missing and an optional
one is selected | `PIDReview/PIDReview.js` `add_param_sets` | The spectrogram changes signal on a
controller change._

**Verdict: PROVEN** (contradicts itself).

**Status: FIXED.** Port: `apps/pid-review/src/analysis/selection.ts` `selectionsForAxis` (`keys.has(spectrogram) ? spectrogram : 'Out'`). Test: `apps/pid-review/src/analysis/pipeline.test.ts` "proven upstream bug fixed: keeps an enabled spectrogram signal on a log without D FF" (original: Output; fixed page and port: P) and "sets up selections and the Tests table as add_param_sets does".

**Reproduction:** `proofs/pid-review/spectrogram-signal.test.ts`, "moves the spectrogram from P
(enabled) to Output on a PID log without D FF". Input: a `PIDR` controller whose batch has
`DFF: null`, `Spec_P` checked, `add_param_sets()`. Output: `Spec_P.disabled === false`,
`Spec_DFF.disabled === true`, `Spec_P.checked === false`, `Spec_Out.checked === true`. Control: the
same with D FF logged keeps P.

**Evidence:**

```js
// PIDReview.js:715, 722, 729-731
    const have_all = PID.id[0] !== "RATE"
    ...
    document.getElementById("Spec_P").disabled = !have_all
    ...
    const have_DFF = have_all && PID.sets.some(set => set != null && set.some(batch => batch.DFF != null))
    document.getElementById("Spec_DFF").disabled = !have_DFF
// PIDReview.js:745-754
    // Change to Out on spectrogram if disabled option is set
    const disabled_checked = document.getElementById("Spec_Err").checked ||
                             document.getElementById("Spec_P").checked ||
                             ...
                             document.getElementById("Spec_DFF").checked
    if ((!have_all || !have_DFF) && disabled_checked) {
        document.getElementById("Spec_Out").checked = true
    }
```

The comment and the variable name state the condition: a disabled option is selected. Here P is
enabled (`disabled = !have_all = false`) and is still moved to Output, because the test combines
"some option is missing" with "some option is selected" without requiring them to be the same
option.

**Minimal correct behaviour:** for the reproduction input `Spec_P` stays checked and `Spec_Out` is
not. Smallest port change: in `apps/pid-review/src/analysis/selection.ts` `selectionsForAxis`, move
to `'Out'` only when the selected spectrogram key is not in `keys`
(`const nextSpectrogram = keys.has(spectrogram) ? spectrogram : 'Out'`); the RATE case (Error, P, I,
D, FF, D FF all disabled) and the no-D-FF case with D FF selected are unchanged.

## 6. `find_end_index` always includes at least one window; a reversed range gives a negative mean length

Row: _PID Review | `find_end_index` always includes at least one window; a reversed range gives a
negative mean length | `PIDReview/PIDReview.js` `find_start_index` / `find_end_index` | Spectra and
steps from outside the chosen range; a reversed range gives -0 amplitudes or -Infinity dB._

**Verdict: NOT PROVEN.**

**Reproduction:** `proofs/pid-review/time-range.test.ts`. Window centres 10-19 s: Analysis time
12.5-15.5 s gives `[start, end)` = `[2, 7)` (windows 12 to 16 s); 0-5 s gives `[0, 1)`; 18.5-10.5 s
gives `[8, 2)`, a mean length of −6; the empty sum scaled by `correction / -6` is `[-0, -0]`, and
`[-Infinity, -Infinity]` through the dB amplitude scale (with a length of 0 it would be NaN).

**Evidence:**

```js
// PIDReview.js:556, 570
// Look through time array and return first index before start time
// Look through time array and return first index after end time
// PIDReview.js:893-897, 911-912
const start_index = find_start_index(set.FFT.time)
const end_index = find_end_index(set.FFT.time) + 1
const mean_length = end_index - start_index
// Apply window correction and divide by length to take mean
const corrected = array_scale(mean, window_correction / mean_length)
```

Including one window on each side of the range is what the functions' comments say they return
("first index before start time", "first index after end time"); for a range wholly before the data
the first index after the end time is 0, so averaging window 0 is the stated behaviour. For a
reversed range no window is summed and the result is zero amplitude (`-0 === 0`), i.e. −Infinity dB,
which is the dB value of zero. The original states no intended result for a reversed range, and NaN
(the alternative from a length of 0) is not a result the code offers either. Stays reproduced.
