# Signal audit

Port: `packages/signal`. Upstream: `upstream/Libraries/Array_Math.js` and `upstream/Libraries/fft.js`
(the helpers around [fft.js](https://github.com/indutny/fft.js), which the port uses through its npm
package, the same library and version line upstream loads).

Users: PID Review, Filter Review, Analytic Tune and Filter Tool (through `@apwt/filters`), and outside
this audit's scope Airspeed Fit, Thrust Expo and MAGFit.

Oracle: `src/test-utils/upstream.ts` loads both upstream files into a `node:vm` context with the real
fft.js and exposes every function. The tests compare the port with it bit for bit (`toEqual` on
plain numbers, NaN equal to NaN): random inputs for every array and complex helper, `hanning`,
`window_correction_factors`, `rfft_freq`, `run_fft` with and without `take_max`, `to_double_sided`,
`to_fft_format`, the amplitude and frequency scales, and `fft_window_size_inc` driven through a stub
`<input>`; edge cases added in this audit cover NaN queries and NaN or empty indexes in
`linear_interp`, invalid lengths in `array_from_range`, short data in `run_fft` and the predicates on
NaN, `-0` and infinities.

Statuses: **identical** (same result, restructured or typed code), **code-improved**,
**presentation**, **convenience**, **browser-forced**, **reverted-in-this-audit**.

## Inventory

### `Array_Math.js`

| Upstream item                                                                                       | Port location                                                | Status                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Complex vectors as `[re[], im[]]`                                                                   | `complex.ts` `ComplexArray` (`{ re, im }` of `Float64Array`) | code-improved (same doubles; typed arrays instead of `Array`)                                                                    |
| `complex_mul`, `complex_div`, `complex_abs`, `complex_inverse`, `complex_square`, `complex_phase`   | `complex.ts` `complexMul` ... `complexPhase`                 | identical (same operations in the same order: `ac - bd`, `1 / (c² + d²)`, `** 0.5`, `atan2`; oracle)                             |
| `complex_conj` (`[re.slice(), array_scale(im, -1)]`)                                                | `complexConj`                                                | identical (`im * -1`)                                                                                                            |
| `exp_jw(freq, rate)`                                                                                | `expJw`                                                      | identical (`scale = 2π / rate`, `cos`, `sin`)                                                                                    |
| `array_max`, `array_min`, `array_scale`, `array_inverse`, `array_mul`, `array_div`, `array_offset`  | `array.ts`                                                   | identical (length of the first operand, as upstream)                                                                             |
| `array_add`, `array_sub`, `array_log10`, `array_abs`, `array_sqrt`                                  | `array.ts`                                                   | identical                                                                                                                        |
| `array_sum`, `array_mean`                                                                           | `arraySum`, `arrayMean`                                      | identical (left-to-right accumulation; empty mean is NaN)                                                                        |
| `array_all_equal` (`!=`)                                                                            | `arrayAllEqual` (`!==`)                                      | identical for numbers (loose and strict inequality agree on numbers; inputs are typed numeric)                                   |
| `array_all_NaN` (`isNaN`)                                                                           | `arrayAllNaN` (`Number.isNaN`)                               | identical for numbers (the coercing `isNaN` differs only on non-numbers, which the typed inputs exclude)                         |
| `array_from_range(start, end, step)`: `floor((end - start) / step) + 1` values by repeated addition | `arrayFromRange`                                             | identical, including the accumulated rounding; a NaN length now throws as upstream `new Array(NaN)` does: reverted-in-this-audit |
| `linear_interp(values, index, query)`                                                               | `linearInterp`                                               | identical; elements upstream leaves unassigned are NaN instead of 0: reverted-in-this-audit (see below)                          |

### `fft.js`

| Upstream item                                                                                                                                      | Port location                                                             | Status                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `hanning(len)` (symmetric, `2π / (len - 1)`)                                                                                                       | `window.ts` `hanning`                                                     | identical                                                                                                                     |
| `window_correction_factors(w)` (`linear: 1 / mean(w)`, `energy: 1 / sqrt(mean(w²))`)                                                               | `windowCorrectionFactors`                                                 | identical                                                                                                                     |
| `real_length`, `rfft_freq(len, d)` (`i / (len * d)`)                                                                                               | `fft.ts` `realLength`, `rfftFreq`                                         | identical                                                                                                                     |
| fft.js instance passed around (`new FFTJS(size)`, `createComplexArray`, `realTransform`, ...)                                                      | `RealFft` (wraps the same library)                                        | code-improved (same engine; non-power-of-two sizes throw in the library constructor as upstream)                              |
| `run_fft(data, keys, window_size, window_spacing, windowing_function, fft, take_max)`                                                              | `runFft(data, keys, { windowSize, windowSpacing, window, fft, takeMax })` | identical (window count, centres, 1/N and 2/N scaling, interleaved read-out; oracle); result shape `{ center, spectra, max }` |
| `run_fft` window count `floor((n - window_size) / window_spacing) + 1`: zero, or negative and `new Array` throws                                   | `runFft`                                                                  | proven upstream bug fixed: a negative count is clamped to zero windows (see "Proven upstream bugs fixed")                     |
| `run_fft` `take_max`: `Math.max(...array_abs(windowed))`                                                                                           | `maxOf(arrayAbs(windowed))`                                               | identical (NaN propagates, as `Math.max`); see "Remaining differences" for very large windows                                 |
| `run_fft` skips a key missing from `data` (`continue`)                                                                                             | `runFft` throws `TypeError`                                               | code-improved (keys are typed `keyof data`; no caller can pass a missing key, see below)                                      |
| `run_fft` with an engine of another size                                                                                                           | `runFft` throws `RangeError`                                              | code-improved (no upstream caller does this; every page builds `new FFTJS(window_size)`)                                      |
| `to_double_sided(X)`                                                                                                                               | `toDoubleSided`                                                           | identical                                                                                                                     |
| `to_fft_format(target, source)`                                                                                                                    | `toInterleaved`; `fromInterleaved` is its inverse                         | identical                                                                                                                     |
| `fft_window_size_inc(event)` (stash `data-last`; a change of exactly ±1 steps to the next power of two from the last value; anything else is kept) | `fftWindowSizeInc(last, entered)` built on `stepWindowSize`               | added in this audit (oracle-tested); the apps' window-size inputs now use it on commit (see the app audits)                   |
| `fft_amplitude_scale(use_DB, use_PSD)` (`fun`, `scale`, `label`, `hover`, `window_correction`, `quantization_correction`)                          | `scale.ts` `fftAmplitudeScale({ dB, psd })` (`transform`, `scale`, ...)   | identical (PSD wins over dB as upstream; dB's unused `correction_scale` dropped)                                              |
| `fft_frequency_scale(use_RPM, log_scale)`                                                                                                          | `fftFrequencyScale({ rpm, log })`                                         | identical                                                                                                                     |

## Resolved in this audit

- **`run_fft` on data shorter than one window.** Upstream allocates `new Array(num_windows)`, which
  throws `RangeError: Invalid array length` when the count is negative (data shorter than
  `window_size - window_spacing`). The port clamped the count to zero and returned empty spectra, so
  a caller without a length check (Analytic Tune's `run_fft` on a short time range) carried on where
  upstream stops. The clamp is removed; a negative count throws as upstream, and the apps show the
  error instead of crashing (policy crash clause). PID Review and Filter Review check the length
  first, as upstream does, so they are unaffected.
- **`array_from_range` with a NaN length.** Upstream's `new Array(NaN)` throws; a `Float64Array(NaN)`
  is silently empty. `arrayFromRange` now throws a `RangeError` for a NaN length (negative and
  infinite lengths already threw in both). This matters where an empty input reaches a frequency
  grid (Filter Tool, Analytic Tune): upstream stops with an exception rather than plotting nothing.
- **`linear_interp` elements left unassigned.** Upstream leaves a hole (`undefined`) for a NaN query,
  for every query when `index` is empty, and for every query after its search has run off the end
  (a NaN in `index`, or one NaN query, which exhausts the search for all later queries). The port's
  `Float64Array` stored 0 there, a value; it now stores NaN, which is what `undefined` becomes in any
  later arithmetic and what Plotly draws as a gap, like `undefined`.
- **FFT window-size stepping.** `stepWindowSize` reproduced only the exponent arithmetic; the apps
  called it on every keystroke with the new value, so typed sizes were snapped and stepping started
  from the wrong value (1023 → 1024 jumped to 2048). `fftWindowSizeInc(last, entered)` reproduces
  `fft_window_size_inc` whole (oracle-tested over a sequence of spinner steps, typed values and an
  empty field), and the apps call it on the input's commit.

## Remaining intentional differences

| Difference                                                               | Reason                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Results are `Float64Array`, not `Array`                                  | Code: the same IEEE doubles. Unassigned elements are NaN instead of holes (see above); every consumer treats both the same.                                                                                                                                              |
| `runFft` throws for a key that is not in `data`, where upstream skips it | Unreachable through the types (`keys: readonly K[]` with `data: Record<K, ...>`). Upstream PID Review filters its keys to those present before calling, which the port does too.                                                                                         |
| `take_max` peak computed with a loop instead of `Math.max(...spread)`    | Same value. Spreading a very large window onto the stack can throw in a browser (the limit is engine- and stack-dependent, around 10⁵ arguments in Chrome); the port has no such limit. A result where upstream may crash in some browsers is a crash-clause difference. |
| `stepWindowSize(current, direction)` kept as a building block            | `fftWindowSizeInc` is the upstream behaviour; `stepWindowSize` alone is its exponent step.                                                                                                                                                                               |

## Upstream bugs reproduced

| Location                                     | Reproduction                                                                               | Effect                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Libraries/Array_Math.js` `linear_interp`    | `linear_interp([0, 10, 20], [0, 1, 2], [0.5, NaN, 1.5])` gives `[5, undefined, undefined]` | One NaN query (or a NaN in `index`) runs the shared search index off the end, so every later in-range query is left unassigned too, not just the NaN one. Reproduced (as NaN). Test: `array.test.ts` "linearInterp with NaN queries". |
| `Libraries/Array_Math.js` `array_from_range` | `array_from_range(0, NaN, 0.1)` throws `Invalid array length`                              | An empty input reaching a frequency grid stops the calculation. Reproduced. Test: `array.test.ts` "arrayFromRange throws ...".                                                                                                        |

## Proven upstream bugs fixed

Fixed only because each is proven to the standard in [`../bug-proofs/README.md`](../bug-proofs/README.md);
the verdicts are in [`../bug-proofs/signal.md`](../bug-proofs/signal.md).

- **`run_fft` on data shorter than one window minus one spacing** (`Libraries/fft.js:43`). Upstream's
  count goes negative and `new Array(num_windows)` throws `RangeError: Invalid array length`; the same
  formula gives zero windows for slightly longer data. `runFft` clamps the count to zero, so 3 samples
  with window 64 and spacing 32 give zero windows instead of throwing. This supersedes the earlier
  revert under "Resolved in this audit". No app result changes: Filter Review and PID Review skip
  batches shorter than a window first, and Analytic Tune reports the same "too short" error for zero
  windows. Tests: `fft.test.ts` "proven upstream bug fixed: shorter data gives zero windows where
  upstream throws"; proof `proofs/signal/signal.test.ts`.
