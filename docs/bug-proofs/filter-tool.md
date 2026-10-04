# Filter Tool: bug proofs

Verdicts for the Filter Tool rows of [`../upstream-bugs.md`](../upstream-bugs.md), against the
[standard](README.md). Reproductions are in [`proofs/filter-tool/`](../../proofs/filter-tool/); they run
the upstream page functions (`FilterTool/filters.js`, `Libraries/Array_Math.js`,
`Libraries/ParameterMetadata.js` and, where stated, `Libraries/Param_Helpers.js`) in `node:vm` over
a stub DOM built from `FilterTool/index.html` and `FilterTool/params.json` (`_harness.ts`). The stub
applies the HTML value rules the page depends on: a number input keeps only a valid floating-point
number, and a `<select>` keeps only one of its option values (otherwise `""`). Line numbers are in
`upstream/FilterTool/filters.js` unless stated.

| Row                                                                               | Verdict    | Reason                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sample-rate check compares `filters[0]` with itself, calls undefined `error()` | NOT PROVEN | The check written as intended (`filters[j]`) fires for the same input (NaN != NaN) and never otherwise; the observable result (calculation stops) is the same |
| 2. `_ENABLE`/`_MODE` drop-downs read NaN for non-option text                      | PROVEN     | `INS_HNTCH_ENABLE 0.000000` applies the notch and `INS_HNTCH_MODE 1.000000` gives a fixed notch; in ArduPilot these values are 0 (disabled) and 1 (Throttle)  |
| 3. UI enable test `> 0` differs from the filter's `!(<= 0)`                       | NOT PROVEN | They differ only for NaN, which ArduPilot's integer `_ENABLE` cannot hold; nothing says which reading is intended                                             |
| 4. Input visibility floors `_MODE`, the maths does not                            | NOT PROVEN | Mode 1.5 is not a value the parameter can hold; it reaches the page only before `params.json` loads                                                           |
| 5. Saved order number inputs then drop-downs; empty field saved as 0              | NOT PROVEN | A .param file's line order carries no meaning; nothing states what an empty field should save                                                                 |
| 6. Page never loads `Param_Helpers.js`                                            | PROVEN     | Save Parameters throws `param_to_string is not defined` and saves nothing (already a recorded deliberate fix)                                                 |
| 7. `load_parameters` does not trim and sets any element by id                     | NOT PROVEN | No reference defines the file format the page must accept or forbids loading the operating-point inputs                                                       |
| 8. Whole share URL lowercased, values included                                    | NOT PROVEN | Only `Infinity` is affected, which the tool's own links cannot contain (a number input cannot hold it)                                                        |

## 1. Sample-rate mismatch check compares `filters[0].sample_rate` with itself and calls an undefined `error()`

Row: _Filter Tool | Sample-rate mismatch check compares `filters[0].sample_rate` with itself and calls
an undefined `error()` | `FilterTool/filters.js` `evaluate_transfer_functions` | Empty gyro rate with
Post filtering: ReferenceError, no PID plot. Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `sample-rate-check.test.ts`. With Gyro Sample Rate emptied and Post filtering,
`calculate_pid()` throws `ReferenceError: error is not defined`; with Pre filtering it plots.
`get_filters(2000)` builds all three gyro filters at 2000 Hz. A check written with the loop index
finds no mismatch at 2000 Hz and finds one at NaN.

**Evidence:**

```js
// filters.js:403-410
        // Allow for batches at different sample rates
        const filters = filter_groups[i]

        const sample_rate = filters[0].sample_rate
        for (let j = 1; j < filters.length; j++) {
            if (filters[0].sample_rate != sample_rate) {
                error("Sample rate miss match")
```

The code contradicts itself: the loop over `j` never reads `j`, and `error` is defined nowhere in the
scripts the page loads (`index.html:7-13`). But no output differs from the stated intent. Every
group the page builds has one rate (`get_filters(sample_rate)`, `filters.js:342-367`; the PID group
has one filter, so its loop does not run). With a finite rate, `filters[j].sample_rate != sample_rate`
is never true. With an empty rate (NaN) it is true (`NaN != NaN`), so the intended check also calls
`error("Sample rate miss match")` and stops. Nothing in upstream defines `error()` as anything that
continues. It stays reproduced.

## 2. `_ENABLE`/`_MODE` drop-downs read NaN for any text that is not an option (e.g. MAVProxy `1.000000`)

Row: _Filter Tool | `_ENABLE`/`_MODE` drop-downs read NaN for any text that is not an option (e.g.
MAVProxy `1.000000`) | `Libraries/ParameterMetadata.js` `load_param_inputs` + `filters.js` `get_form`
| Mode NaN is a fixed notch; enable NaN still enables the filter. Reproduced._

**Verdict: PROVEN** (contradicts ArduPilot) for values that equal an option number, such as
`0.000000` and `1.000000`.

**Status: FIXED.** Port: `apps/filter-tool/src/analysis/fields.ts` `assignFieldText` (a select given valid number text whose value, written as `String(parseFloat(text))`, is an option takes that option). Tests: `apps/filter-tool/src/analysis/param-file.test.ts` "proven upstream bug fixed: a number equal to an option selects it (upstream reads NaN)"; `page.test.ts` "loaded file matches upstream load_parameters" runs upstream's `load_parameters` and expects upstream's values except for exactly those drop-downs (`withProvenSelectFix`). Share links and cookies are unaffected (they assign `String(number)`, which already matches an option).

**Reproduction:** `select-non-option.test.ts`. After `params.json` has turned `_ENABLE` and `_MODE`
into drop-downs (options `0`, `1` and `0`-`5`), load a file with notch settings `INS_HNTCH_FREQ 80`,
`INS_HNTCH_BW 40`, `INS_HNTCH_ATT 40`, `INS_HNTCH_REF 0.1`, `INS_HNTCH_FM_RAT 1`, `INS_HNTCH_HMNCS 1`
and:

- `INS_HNTCH_ENABLE 0.000000`: the drop-down reads `""`, `get_form` gives NaN, the filter is
  `enabled: true` with a notch at 80 Hz. The same file with `INS_HNTCH_ENABLE 0` disables it.
- `INS_HNTCH_ENABLE 1`, `INS_HNTCH_MODE 1.000000`: mode reads NaN and the notch stays at 80 Hz (fixed).
  With `INS_HNTCH_MODE 1` it tracks throttle: `80 * sqrt(0.3 / 0.1)` = 138.56 Hz.
- A number input given `INS_HNTCH_FREQ 80.000000` reads 80, so the page does take MAVProxy-format
  values.

**Evidence:**

```js
// filters.js:942-946
        v = line.split(/[\s,=\t]+/);
        if (v.length >= 2) {
            var vname = v[0];
            var value = v[1];
            if (parameter_set_value(vname, value)) {
// ParameterMetadata.js:10
    param.value = value
// filters.js:243, 257
    if (enable <= 0) {
    if (mode == 1) {
```

The loader explicitly accepts whitespace-separated (MAVProxy) lines, and `0.000000` and `1.000000`
are the numbers 0 and 1. For a `<select>`, assigning text that matches no option's value leaves no
option selected, and `value` is `""` (HTML `select.value` setter), so `get_form` returns NaN. Then
`NaN <= 0` is false, so the notch is enabled, and `NaN == 1` is false, so the notch is fixed. In
ArduPilot the same values mean:

- `libraries/Filter/HarmonicNotchFilter.cpp:64-66`: `@Values: 0:Disabled,1:Enabled`, `_enable`; and
  `libraries/Filter/NotchFilter.h:70` `enabled()` returns `_enable`, tested as a boolean in
  `libraries/AP_InertialSensor/AP_InertialSensor_Backend.cpp:228` (`if (!notch.params.enabled())`).
  So 0 is disabled.
- `libraries/Filter/HarmonicNotchFilter.cpp:127`:
  `@Values: 0:Fixed,1:Throttle,2:RPM Sensor,3:ESC Telemetry,4:Dynamic FFT,5:Second RPM Sensor`, and
  `libraries/Filter/HarmonicNotchFilter.h:98` `UpdateThrottle = 1`. So 1 is throttle tracking.

The original simulates a notch the parameter file disables, and a fixed notch where the file selects
throttle tracking.

**Minimal correct behaviour:** for the reproduction files, `INS_HNTCH_ENABLE 0.000000` gives the same
result as `INS_HNTCH_ENABLE 0` (notch off), and `INS_HNTCH_MODE 1.000000` the same as
`INS_HNTCH_MODE 1` (throttle tracking, 138.56 Hz). Text that is not a number equal to an option (e.g.
`2` for `_ENABLE`, `1.5` for `_MODE`) is unchanged (NaN). Smallest port change: in
`apps/filter-tool/src/analysis/fields.ts` `assignFieldText`, for a select field, when `text` is not
an option, use `String(parseFloat(text))` if that string is an option (else NaN as now). Number fields
and option text are unaffected.

## 3. UI enable test `> 0` differs from the filter's `!(<= 0)`

Row: _Filter Tool | UI enable test `> 0` differs from the filter's `!(<= 0)` | `FilterTool/filters.js`
`update_hidden` / `HarmonicNotchFilter` | Empty `_ENABLE`: settings greyed out but the notch is
applied. Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `enable-test.test.ts`. With `_ENABLE` empty, `update_hidden("INS_HNTCH_ENABLE")`
disables `INS_HNTCH_FREQ` and `INS_HNTCH_MODE`, while `get_filters(2000)[0]` is enabled with a notch at
80 Hz. The two tests agree for every number; they differ only for NaN.

**Evidence:** `filters.js:967` `var enabled = parseFloat(document.getElementById(enable_param).value) > 0;`
and `filters.js:243` `if (enable <= 0) {` (disabled), otherwise `this.enabled = true` (`filters.js:252`).
The page does disagree with itself for NaN. But `_ENABLE` is an integer parameter
(`HarmonicNotchFilter.cpp:66`, `AP_Int8` in `NotchFilter.h:74`) and cannot be NaN, so ArduPilot does
not settle which side is right, and no text in the page says what an empty enable should do. A fix
cannot be specified with certainty. The reachable case of this row, a file value that matches no
option, is covered by row 2. It stays reproduced.

## 4. Input visibility floors `_MODE`, the maths does not

Row: _Filter Tool | Input visibility floors `_MODE`, the maths does not | `FilterTool/filters.js`
`update_hidden_mode` | Mode 1.5 shows the throttle input while the notch is fixed. Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `mode-floor.test.ts`. Before `params.json` has arrived (`_MODE` is still a number
input), a file with `INS_HNTCH_ENABLE 1`, `INS_HNTCH_MODE 1.5` and the notch settings of row 2 shows
`Throttle_input` (ESC and RPM inputs hidden), while the notch stays at 80 Hz (fixed).

**Evidence:** `filters.js:1006` `var mode = Math.floor(get_form(mode_params[j]))` against
`filters.js:257` `if (mode == 1) {`. `_MODE` is an integer parameter
(`HarmonicNotchFilter.cpp:129`, `AP_Int8 _tracking_mode` in `HarmonicNotchFilter.h:173`), so 1.5 is
not a value the vehicle can hold. When a GCS sets 1.5, `AP_Param::set_float` stores 1
(`libraries/AP_Param/AP_Param.cpp:2240-2262`, +0.01 then conversion to `int8`). That points towards
the floored reading, but the input exists only in the moment before the page replaces the input with
a drop-down, and the page states no intent for fractional modes. It is not certain that the maths,
rather than the input, is what should change. It stays reproduced.

## 5. Saved order is number inputs then drop-downs; empty field saved as 0

Row: _Filter Tool | Saved order is number inputs then drop-downs; empty field saved as 0 |
`FilterTool/filters.js` `save_parameters` | `_ENABLE`/`_MODE` last; `Math.fround("")` is 0.
Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `save-order.test.ts` (Param_Helpers.js loaded, see row 6). With `INS_HNTCH_FREQ`
emptied, `filter.param` starts with `INS_GYRO_FILTER`, ends with `INS_HNTCH_ENABLE`, `INS_HNTCH_MODE`,
`INS_HNTC2_ENABLE`, `INS_HNTC2_MODE`, and contains `INS_HNTCH_FREQ,0`. `param_to_string("")` is
`"0"`.

**Evidence:** `filters.js:929-930` saves the `input` elements, then the `select` elements;
`Param_Helpers.js:70` `const float_val = Math.fround(value)`. The order of lines in a parameter file
has no meaning: ArduPilot's own reader handles one line at a time
(`libraries/AP_Param/AP_Param.cpp:2270-2300` `parse_param_line`). Nothing in the page says what an
empty field should be saved as. Neither part contradicts a reference. It stays reproduced.

## 6. Page never loads `Param_Helpers.js`

Row: _Filter Tool | Page never loads `Param_Helpers.js` | `FilterTool/index.html` / `save_parameters` |
`param_to_string is not defined`: no file is saved. Deliberately fixed (2026-10-03, see
`docs/porting-policy.md`): the port saves the text upstream builds; `upstream-save-bug.test.ts` pins
the crash._

**Verdict: PROVEN** (it fails). This confirms the deliberate fix already recorded in
[`../porting-policy.md`](../porting-policy.md).

**Status: no port change needed.** The port already saves the file (the deliberate fix of 2026-10-03: `apps/filter-tool/src/analysis/param-file.ts` `formatParamFile`; `apps/filter-tool/src/analysis/upstream-save-bug.test.ts` pins upstream's crash, `page.test.ts` "saved file matches upstream save_parameters" checks the text).

**Reproduction:** `param-helpers.test.ts`. The `<script src>` list of `index.html` is `filters.js`,
`FileSaver.js`, `Array_Math.js`, `ParameterMetadata.js`, `Plotly_helpers.js`, `plotly.min.js`. With
those scripts, `save_parameters()` throws `ReferenceError: param_to_string is not defined` and nothing
is saved. With `Param_Helpers.js` added, the same call saves `filter.param` (first line
`INS_GYRO_FILTER,20`).

**Evidence:** `index.html:7-13` (no `Param_Helpers.js`); `filters.js:923`
`params += name + "," + param_to_string(value) + "\n";`. The page offers a Save Parameters button that
can never produce its file.

**Minimal correct behaviour:** Save Parameters saves `filter.param` with the text `save_parameters`
builds, using upstream's `param_to_string` (for the defaults the first line is `INS_GYRO_FILTER,20`).
This is the recorded deliberate fix; no further change.

## 7. `load_parameters` does not trim lines and sets any element by id

Row: _Filter Tool | `load_parameters` does not trim lines and sets any element by id |
`FilterTool/filters.js` `load_parameters` | Indented lines ignored; `NAME,` empties a field;
operating-point inputs settable from a file. Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `load-parameters.test.ts`. `  INS_GYRO_FILTER 45` and a tab-indented
`INS_HNTCH_FREQ,80` change nothing (the first field of the split is `""`). `INS_GYRO_FILTER,` empties
the field. `GyroSampleRate 1000`, `Throttle 0.5` and `RPM1 3000` set those inputs.

**Evidence:** `filters.js:942` `v = line.split(/[\s,=\t]+/);` and `ParameterMetadata.js:4`
`let param = document.getElementById(name)`. ArduPilot's defaults-file reader skips leading
separators and rejects a line without a value (`AP_Param.cpp:2280-2300`, `strtok_r(line, ", =\t\r\n", ...)`).
But that reader handles firmware defaults files, not the files a user loads into this page, which
come from a GCS. No reference defines the format the page must accept, and none forbids loading the
operating-point inputs (the page's own `get_link`/`load` round-trips them too). It stays reproduced.

## 8. Whole share URL lowercased, values included

Row: _Filter Tool | Whole share URL lowercased, values included | `FilterTool/filters.js` `load` |
`Infinity` is skipped as not a number. Reproduced._

**Verdict: NOT PROVEN.**

**Reproduction:** `share-url.test.ts`. `?Throttle=Infinity&INS_GYRO_FILTER=4.5E1` leaves Throttle at
its default 0.3 and sets the gyro filter to 45. A number input given `Infinity` holds `""`, and
`get_link` writes the input's value, so the tool's own links never contain `Infinity`.

**Evidence:** `filters.js:785` `var url_string = (window.location.href).toLowerCase();` and
`filters.js:812` `var value = parseFloat(params.get(name));`. Lowercasing changes the meaning of no
value the page can write: numbers keep their value (`E` becomes `e`), and radio values and checkbox
`true`/`false` are compared in lower case on both sides (`filters.js:796-811`). Only hand-written
`Infinity` is lost, and nothing states that hand-written links must accept it. It stays reproduced.
