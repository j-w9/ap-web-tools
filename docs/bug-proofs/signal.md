# Libraries (signal): bug proofs

Verdicts for the Libraries (signal) rows of [`../upstream-bugs.md`](../upstream-bugs.md), against the
[standard](README.md). Reproductions are in [`proofs/signal/signal.test.ts`](../../proofs/signal/signal.test.ts);
they load upstream `Libraries/Array_Math.js` and `Libraries/fft.js` in `node:vm` (`_harness.ts`).

| Row                                                                | Verdict    | Reason                                                                                                                            |
| ------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. `linear_interp` leaves later queries unassigned after one NaN   | NOT PROVEN | The shared forward-only search index requires ascending queries; a NaN query is outside that ordering and no reference defines it |
| 2. `run_fft` throws for data shorter than one window minus spacing | PROVEN     | A count of windows cannot be negative; the same formula gives 0 windows (no throw) for 32-63 samples and throws for 31 or fewer   |
| 3. `array_from_range` throws for a NaN length                      | NOT PROVEN | A range ending at NaN has no defined content; nothing states the calculation should go on with an empty input                     |

## 1. `linear_interp` leaves later queries unassigned after one NaN

Row: _Libraries (signal) | `linear_interp` leaves later queries unassigned after one NaN |
`Libraries/Array_Math.js` `linear_interp` | A NaN query or NaN index runs the shared search index off
the end; every later in-range query is `undefined`. Reproduced as NaN (`docs/audit/signal.md`)._

**Verdict: NOT PROVEN.**

**Reproduction:** `signal.test.ts`, "linear_interp leaves later queries unassigned after one NaN".
`linear_interp([0, 10, 20], [0, 1, 2], [0.5, NaN, 1.5])` returns `[5, <hole>, <hole>]` (elements 1
and 2 are never assigned). A NaN in `index` (`[0, NaN, 2]`, queries `[0.5, 1.5]`) gives `[NaN, NaN]`,
not holes; the row's "or NaN index" only holds for the NaN part.

**Evidence:**

```js
// Array_Math.js:249-269
    let interpolate_index = 0
    for (let i = 0; i < len; i++) {
        ...
        // increment index until there is a point after the target
        for (interpolate_index; interpolate_index < last_value_index; interpolate_index++) {
            if (query_index[i] < index[interpolate_index+1]) {
```

The search index is never reset between queries, so the function is only correct for ascending
queries. The test shows this with plain numbers: `linear_interp([0, 10, 30], [0, 1, 2], [1.5, 0.5])`
gives `[20, 0]`, although interpolating 0.5 alone gives 5. A NaN query cannot be placed in an
ascending sequence, so `[0.5, NaN, 1.5]` breaks the function's precondition. The original states no
result for that input (no check, comment or caller contract), and ArduPilot and mathematics do not
define how a NaN query affects later ones. The output is clearly poor, but no allowed reference shows
that a different output was intended. It stays reproduced.

## 2. `run_fft` throws for data shorter than one window minus one spacing

Row: _Libraries (signal) | `run_fft` throws for data shorter than one window minus one spacing |
`Libraries/fft.js` `run_fft` (`new Array(num_windows)`, negative count) | `RangeError: Invalid array
length`. Reproduced; apps show the error._

**Verdict: PROVEN** (it fails; contradicts mathematics).

**Status: FIXED.** Port: `packages/signal/src/fft.ts` `runFft` (`numWindows = Math.max(0, ...)`). Tests: `packages/signal/src/fft.test.ts` "proven upstream bug fixed: shorter data gives zero windows where upstream throws" (upstream's throw and the port's zero windows) and "returns zero windows for data within one spacing of a full window, as upstream". No app result changes: Filter Review and PID Review skip batches shorter than one window before calling `runFft`, and Analytic Tune reports the same "too short" error for zero windows as it did for the throw.

**Reproduction:** `signal.test.ts`, "run_fft throws for data shorter than one window minus one
spacing". Window 64, spacing 32, Hann window: 32 and 63 samples return `{ center: [], x: [] }`; 31
samples and 3 samples throw `RangeError: Invalid array length`.

**Evidence:**

```js
// fft.js:43-48
    const num_windows = Math.floor((num_points-window_size)/window_spacing) + 1

    // Allocate for each window
    var ret = { center: new Array(num_windows) }
    for (const key of keys) {
        ret[key] = new Array(num_windows)
```

`num_windows` is the number of `window_size`-sample windows, `window_spacing` apart and starting at
sample 0, that fit in `num_points` samples. That number is `max(0, floor((n - w) / s) + 1)`. The
expression without `max` is right for `n >= w - s` (it is 0 for every `w - s <= n < w`, which the
function returns without error). For `n < w - s` it is negative, a count no data length can have,
and the allocation throws. The function's own result for 32-63 samples shows what "no full window"
returns: zero windows.

**Minimal correct behaviour:** for 3 (or 31) samples, window 64, spacing 32, `run_fft` returns zero
windows, `{ center: [], x: [] }`, exactly as it does for 32 samples. Smallest port change: in
`packages/signal/src/fft.ts` `runFft`, compute
`numWindows = Math.max(0, Math.floor((numPoints - windowSize) / windowSpacing) + 1)`. Every input
that does not throw today gives the same result.

## 3. `array_from_range` throws for a NaN length

Row: _Libraries (signal) | `array_from_range` throws for a NaN length | `Libraries/Array_Math.js`
`array_from_range` (`new Array(NaN)`) | An empty input reaching a frequency grid stops the calculation.
Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `signal.test.ts`, "array_from_range throws for a NaN length".
`array_from_range(0, NaN, 0.1)` throws `RangeError: Invalid array length`.

**Evidence:**

```js
// Array_Math.js:231-234
function array_from_range(start, end, step) {
    const len = Math.floor((end - start) / step) + 1
    let val = start
    let ret = new Array(len)
```

A range from 0 to NaN has no defined elements, so there is no correct output to compare with. The
row's effect (an empty input field stops the calculation) depends on what the calling tool should do
with an empty field, and none of the callers states that. It stays reproduced.

Not part of this row, and not evaluated: a finite `end` more than one `step` below `start` (e.g.
`array_from_range(0, -2, 1)`) gives a negative `len` and throws in the same way, while
`array_from_range(0, -1, 1)` returns `[]`. That is the same pattern as row 2 and could be proposed as
a separate row.
