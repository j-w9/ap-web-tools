# Filters: bug proofs

Verdicts for the Filters rows of [`../upstream-bugs.md`](../upstream-bugs.md), against the
[standard](README.md). Reproductions are in [`proofs/filters/filters.test.ts`](../../proofs/filters/filters.test.ts);
they load `Libraries/Array_Math.js` with upstream `FilterTool/filters.js` or
`AnalyticTune/AnalyticTune.js` in `node:vm`, with a stub `document` for `get_form` (`_harness.ts`).
ArduPilot references are at `upstream/modules/ardupilot` (`f3836cf`).

| Row                                                            | Verdict    | Reason                                                                                                                                       |
| -------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. FilterTool `LPF_1P` never sets `sample_rate`                | NOT PROVEN | No FilterTool output reads it: `LPF_1P` is only built inside `PID`, whose transfer uses the PID's own rate                                   |
| 2. Harmonic notch spread computed before the centre is clamped | PROVEN     | Two motors with the same ESC frequency get different notches; ArduPilot uses one spread for every centre (`HarmonicNotchFilter.cpp:384-385`) |

## 1. FilterTool `LPF_1P` never sets `sample_rate`

Row: _Filters | FilterTool `LPF_1P` never sets `sample_rate` | `FilterTool/filters.js` `LPF_1P` |
Would give all-NaN responses at the head of a group; FilterTool only uses it inside `PID`, so it has
no effect there. Pinned by a test._

**Verdict: NOT PROVEN.**

**Reproduction:** `filters.test.ts`, "FilterTool LPF_1P never sets sample_rate".
`new LPF_1P(400, 0).sample_rate` and `new LPF_1P(400, 20).sample_rate` are `undefined`
(AnalyticTune's copy gives 400). A PID group (`new PID(400, 0.1, 0.1, 0.002, 10, 20)`) evaluates to
finite responses.

**Evidence:** `FilterTool/filters.js:78-107` never assigns `this.sample_rate`, while
`AnalyticTune/AnalyticTune.js:168-169` (`this.sample_rate = sample_rate`) does. In FilterTool the only
`new LPF_1P` calls are `filters.js:8-9`, inside `PID`, and `evaluate_transfer_functions` reads only
`filters[0].sample_rate` of each group (`filters.js:406`), which is the `PID` (`filters.js:2`). No
FilterTool output is wrong, so there is nothing a reference could contradict. The "all-NaN at the
head of a group" effect cannot happen in the original.

## 2. Harmonic notch spread computed before the centre is clamped

Row: _Filters | Harmonic notch spread computed before the centre is clamped | `FilterTool/filters.js`,
`AnalyticTune/AnalyticTune.js` `HarmonicNotchFilter` | Chained (multi-source ESC) copies of a clamped
harmonic use the clamped centre for their spread. Reproduced._

**Verdict: PROVEN** (contradicts ArduPilot) that the chained copies differ from the first.

**Status: FIXED.** Port: `packages/filters/src/harmonic-notch.ts` `designHarmonicNotch` (the spread is computed once per harmonic, before the copy loop). Tests: `packages/filters/src/harmonic-notch.test.ts` "proven upstream bug fixed: chained copies of a clamped harmonic equal the first copy" (original `[18.2, 23.4, 19.55, 22.05]`, port `[18.2, 23.4, 18.2, 23.4]`) and "differs from the original only in the proven chained-spread case". The oracle tests (`harmonic-notch.test.ts`, `apps/analytic-tune/src/analysis/filters.test.ts`, `apps/filter-tool/src/analysis/bode.test.ts`, `page.test.ts`) compare the port with upstream patched to compute the spread before the copy loop (`patchChainedSpread`), and check that the unpatched original differs only for chained copies of a clamped harmonic.

**Reproduction:** `filters.test.ts`, "Harmonic notch spread computed before the centre is clamped",
for both tools. Input: `new HarmonicNotchFilter(2000, 1, 3, 10, 40, 40, 1, 1, 1, 3)` (sample rate
2000 Hz, enabled, ESC mode, FREQ 10, BW 40, ATT 40, REF 1, FM_RAT 1, first harmonic, OPTS 3 = double
notch + multi-source), `NUM_MOTORS` 2, `ESC_RPM` 0. The tracked centre is `max(0 / 60, 10) * 1 = 10`
Hz for both motors, below the bandwidth limit `0.52 * 40 = 20.8` Hz. Output notch centres:
`[18.2, 23.400000000000002, 19.55, 22.049999999999997]`. Motor 1 uses spread `40 / (32 * 10) = 0.125`,
motor 2 uses `40 / (32 * 20.8)`. Without multi-source (OPTS 1) only `[18.2, 23.400000000000002]`
exist.

**Evidence:**

```js
// FilterTool/filters.js:282-290 (AnalyticTune/AnalyticTune.js:492-500 is the same)
            for (var c=0; c<chained; c++) {
                ...
                var notch_spread = bandwidth_hz / (32.0 * notch_center);

                // adjust the fundamental center frequency to be in the allowable range
                notch_center = Math.min(Math.max(notch_center, bandwidth_limit), nyquist_limit)
```

Each pass of the `c` loop models one motor, and every motor is given the same frequency (`freq` is
set once, `filters.js:270-276`). The clamp overwrites `notch_center`, so the second pass computes its
spread from a different value than the first.

In ArduPilot, multi-source ESC tracking passes one frequency per motor
(`libraries/AP_Vehicle/AP_Vehicle.cpp:880-884`, `notch.update_frequencies_hz(num_notches, notches)`),
and `HarmonicNotchFilter<T>::update(uint8_t num_centers, const float center_freq_hz[])` places the
double notch of every centre with the same member `_notch_spread`:

```cpp
// libraries/Filter/HarmonicNotchFilter.cpp:383-386
        if (_composite_notches > 1) {
            set_center_frequency(_num_enabled_filters++, notch_center, 1.0 - _notch_spread, harmonic_mul);
            set_center_frequency(_num_enabled_filters++, notch_center, 1.0 + _notch_spread, harmonic_mul);
        }
```

`set_center_frequency` (`HarmonicNotchFilter.cpp:265-339`) depends only on its arguments and the
filter's fixed state, so two motors with the same frequency get identical notches in the firmware.
In the original they do not.

**Minimal correct behaviour:** every chained copy of a harmonic is identical to the first. For the
reproduction input the centres are `[18.2, 23.400000000000002, 18.2, 23.400000000000002]`. Smallest
port change: in `packages/filters/src/harmonic-notch.ts` `designHarmonicNotch`, compute `notchSpread`
once per harmonic, before the `c` loop, from the unclamped `notchCenter` (as the first copy does
now). This changes only copies after the first of a clamped harmonic. The first copy, and every
configuration without multi-source chaining, stays as it is.

Note (not a verdict): ArduPilot computes `_notch_spread` after clamping
(`HarmonicNotchFilter.cpp:190-193`, from the clamped `INS_HNTCH_FREQ`). That suggests the first
copy's spread, from the unclamped centre, also differs from the firmware. But the tools' notch model
differs from the firmware in other ways: the spread is per harmonic and per tracked centre, and the
clamped centre is used for placement, where ArduPilot clamps only for A and Q. So the firmware gives
no exact expected value for that part. It is left as reproduced.
