# Analytic Tune: bug proofs

Verdicts for the Analytic Tune rows of [`../upstream-bugs.md`](../upstream-bugs.md), under the standard in
[`README.md`](README.md). The reproductions are in `proofs/analytic-tune/`. `_harness.ts` loads the original page into
`node:vm`: `upstream/AnalyticTune/AnalyticTune.js` and the Libraries scripts in `index.html` order (`Array_Math.js`,
`ParameterMetadata.js`, `Param_Helpers.js`, `Plotly_helpers.js`, `fft.js`), then the page's inline script (which runs
`load_param_inputs` on `params.json`), then the body `onload` handlers. All of it runs unmodified. The DOM is a small
stub built from `index.html`. Element values follow the HTML rules for the element kinds the page uses:

- a number input keeps only a valid floating-point number, otherwise `""`;
- a check box without a `value` attribute reads `"on"`;
- a file input throws `InvalidStateError` when set to anything but `""`;
- a drop-down set to text that matches no option has no selection and reads `""`.

The log parser is a fake that hands the page the arrays a test supplies. Line numbers are in `upstream/AnalyticTune/`
unless stated otherwise.

| Row | Bug                                                      | Verdict    | Reason                                                                                     |
| --- | -------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 104 | Un-wrapped phase option has no effect                    | PROVEN     | The page offers "un-wrapped" but never plots it                                            |
| 105 | Airspeed scaling outlives its log                        | PROVEN     | Copter gains get scaled by a plane's airspeed; the copter rate loop has no airspeed term   |
| 106 | Vehicle outlives its log                                 | NOT PROVEN | Nothing says what vehicle a log without a banner is                                        |
| 107 | Drop-down params lose non-option text                    | PROVEN     | `ENABLE 0.000000` (that is, 0, Disabled) enables the notch. Only the numeric-match case    |
| 108 | Sample rate counts samples, not intervals                | PROVEN     | n samples span n-1 intervals; 100 Hz data reads as 101.01 Hz                               |
| 109 | Signals at different log rates analysed as one rate      | NOT PROVEN | The firmware logs all SID signals at one rate; logs that break this are outside the design |
| 110 | Loops run one past the end                               | PROVEN     | Arrays allocated with length L, loops write L+1; the extra element is NaN                  |
| 111 | Fixed-wing yaw throws                                    | PROVEN     | TypeError on Calculate. No reference defines a fixed-wing yaw result: fix is an error only |
| 112 | Fixed-wing yaw save throws                               | PROVEN     | The empty pilot prefix matches every element; `param_to_string("on")` throws               |
| 113 | Notch selection outside 1-8 throws                       | PROVEN     | Index 9 throws; the firmware applies no notch. Non-integer indices NOT PROVEN              |
| 114 | SIDS record without data stops the load                  | PROVEN     | TypeError in `add_sid_sets`; parameters are not copied                                     |
| 115 | Plane log without SIDS stops the load                    | PROVEN     | TypeError. No reference picks FW or VTOL without SIDS: fix is an error only                |
| 116 | .param lines not trimmed                                 | NOT PROVEN | No parameter file format defines indented lines                                            |
| 117 | File input named in a .param stops the load              | PROVEN     | Throws mid-file, but the loop is written to skip lines it cannot apply                     |
| new | SID axes 22 and 23 mapped as FW yaw input and roll mixer | PROVEN     | The firmware defines 22 as FW mixer roll and 23 as FW mixer pitch                          |

PROVEN 11, NOT PROVEN 3. Two of the PROVEN rows (111, 115) are crashes where no reference defines the correct result.
For those, the port's existing error message (the crash clause in `docs/porting-policy.md`) is the whole fix, and no
maths changes. A related finding that is not a row (SID axis numbers 22 to 25) is at the end.

## 104. Un-wrapped phase option has no effect

**Row:** `redraw_freq_resp` sets `unwrap_ph = false` after reading the radio. Phase is always plotted wrapped to
±180 deg.

**Verdict:** PROVEN (the original never produces the output its own UI offers).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/display.ts` `phaseOf` (applies upstream's `unwrap` when "un-wrapped" is selected), used by `apps/analytic-tune/src/ui/traces.ts` `comparisonTraces`. Test: `apps/analytic-tune/src/analysis/pipeline.test.ts`, the trace comparison for the `linear`/`rad/s` scale with un-wrapped phase (expects upstream's own `unwrap` of its wrapped phase); the wrapped phase is unchanged.

**Test:** `unwrap-phase.test.ts`, "Analytic Tune: un-wrapped phase option > plots the wrapped phase whichever option is
selected". The input is a response with phase -100, -130, ..., -430 deg (30 deg steps), used as both the calculated and
the predicted rate-controller response. With "un-wrapped" checked and with "±180" checked, both phase traces are exactly
`[-100, -130, -160, 170, 140, 110, 80, 50, 20, -10, -40, -70]`. The page's own `unwrap()` turns that into
`[-100, -130, ..., -430]`.

**Evidence:**

- `index.html:730-731`: `<input type="radio" id="PID_ScaleUnWrap" name="PID_PhaseScale" value="unwrap" onchange="redraw_freq_resp();">`
  `<label for="PID_ScaleUnWrap">un-wrapped</label>`.
- `AnalyticTune.js:2104`: `var unwrap_ph = document.getElementById("PID_ScaleUnWrap").checked;`
- `AnalyticTune.js:2107`: `unwrap_ph = false`.
- `AnalyticTune.js:2202-2203` and `2235-2236`: `if (unwrap_ph) { calc_plotted_phase = unwrap(array_scale(complex_phase(calc_data), 180 / Math.PI))`.
  This branch can never run.

**Minimal correct behaviour:** with "un-wrapped" selected, both phase traces are the page's `unwrap()` of the wrapped
phase: `[-100, -130, ..., -430]` for the reproduction input. With "±180" selected, nothing changes. Port: `phaseOf` in
`apps/analytic-tune/src/analysis/display.ts` takes the option and returns `unwrap(phaseDegrees(h))` (upstream's 45 deg
negative-jump threshold) when un-wrapped is selected. Nothing else changes.

## 105. Airspeed scaling outlives its log

**Row:** the globals `aspeed`/`eas2tas` are set only in `load_fw_time_history_data`. Multirotor predictions after any
fixed-wing calculation scale P/I/D by aspeed² and FF/D_FF by aspeed/eas2tas.

**Verdict:** PROVEN (contradicts ArduPilot).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/time-history.ts` `airspeedScalingFor` (the window's airspeed on fixed wing, otherwise `INITIAL_AIRSPEED_SCALING` (1, 1)); `apps/analytic-tune/src/App.tsx` no longer carries the scaling between analyses. Test: `apps/analytic-tune/src/analysis/load-upstream.test.ts` "a multirotor analysed after a fixed-wing one: upstream uses the fixed-wing airspeed scaling, the port 1 (proven bug)".

**Test:** `logs.test.ts`, "Analytic Tune: state carried between logs > scales a copter prediction by the airspeed of an
earlier fixed-wing window".

- On a fresh page, a copter log gives `[vehicle_type, aspeed, eas2tas] = ['ArduCopter', 1, 1]`.
- On a page that first ran `load_fw_time_history_data` (what Calculate runs for a fixed-wing log) on a window with SIDP
  `aspd` 20 and `eastas` 1.25, the same copter log gives `['ArduCopter', 20, 1.25]`.
- `calculate_predicted_TF` then differs, because the copter rate P is used as `ATC_RAT_RLL_P * 400`.

**Evidence:**

- `AnalyticTune.js:1028-1029`: `var aspeed = 1.0` / `var eas2tas = 1.0`. They are assigned only at
  `AnalyticTune.js:1783-1784` (`aspeed = array_mean(aspeedData)`), under the comment `// determine average aspeed and
eas2tas` of the fixed-wing window. `load_log` never resets them.
- `AnalyticTune.js:821-824`: `new PID(PID_rate, get_form(param_prefix + "P")*aspeed*aspeed, ...I...*aspeed*aspeed, ...D...*aspeed*aspeed, ...)`,
  and `AnalyticTune.js:845`: `get_form(param_prefix + "FF") * aspeed / eas2tas`. This runs for every vehicle type.
- `upstream/modules/ardupilot/libraries/AC_AttitudeControl/AC_AttitudeControl_Multi.cpp:473`, `:476` and `:479`: the
  multicopter rate loop is
  `_motors.set_roll(get_rate_roll_pid().update_all(ang_vel_body.x, gyro_rads.x, dt, _motors.limit.roll, _pd_scale.x, _i_scale.x) + _actuator_sysid.x)`
  (likewise for pitch and yaw). It has no airspeed term. A copter has no airspeed (`aspd` is a SIDP field, which only the
  plane system ID writes).

**Minimal correct behaviour:** a prediction for a non-fixed-wing log uses `aspeed = eas2tas = 1` (the page's initial
values). For the reproduction, the copter prediction after the plane window equals the fresh-page prediction. Port: the
airspeed scaling passed to the prediction is `INITIAL_AIRSPEED_SCALING`
(`apps/analytic-tune/src/analysis/time-history.ts:34`) whenever the vehicle is not fixed-wing, instead of the value kept
from the last fixed-wing calculation (`App.tsx`). Fixed-wing predictions are unchanged.

## 106. Vehicle outlives its log

**Row:** the global `vehicle_type` is set only from a firmware banner. A log without a banner is analysed as the
previous log's vehicle.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `logs.test.ts`, "Analytic Tune: state carried between logs > analyses a log without a firmware banner as the
previous log vehicle". On a fresh page, a log with PARM and no MSG gives `vehicle_type` `'ArduCopter'`. After a plane log
(banner `ArduPlane`, SID axis 20), the same log gives `'ArduPlane_FW'`.

**Evidence:** `AnalyticTune.js:1027`: `var vehicle_type = "ArduCopter"`. `AnalyticTune.js:1145-1160` assigns it only
when an MSG starts with `ArduPlane` or `ArduCopter`. Nothing in the page, its help text or the firmware says which
vehicle a log without a banner is. Keeping the last identified vehicle (for example across several logs of one
aircraft) is a reasonable reading, so the row stays reproduced.

## 107. Drop-down params lose non-option text

**Row:** `parameter_set_value` on the `<select>` that `load_param_inputs` builds. `ENABLE` NaN enables the notch, `MODE`
NaN is a fixed notch (for example MAVProxy `0.000000`).

**Verdict:** PROVEN for text that is numerically equal to an option (contradicts ArduPilot). Values equal to no option
(such as a `MODE` the metadata does not list) are NOT PROVEN and stay reproduced.

**Status: FIXED** for the proven case only. Port: `apps/analytic-tune/src/analysis/form-values.ts` `inputValueFromText` (valid number text equal to an option's number selects it; other non-option text stays NaN). Test: `apps/analytic-tune/src/analysis/param-file.test.ts` "MAVProxy-style drop-down values equal to an option: upstream reads NaN, the port the option (proven bug)".

**Test:** `param-file.test.ts`, "Analytic Tune: .param files > enables the harmonic notch for INS_HNTCH_ENABLE 0.000000".

- After metadata loading, `INS_HNTCH_ENABLE` is a `SELECT` with options `['0', '1']`.
- Loading `INS_HNTCH_ENABLE 0.000000` leaves its value `''`. `get_form` gives `NaN`, and
  `get_filters(2000)[0].enabled` is `true`.
- Loading `INS_HNTCH_ENABLE 0` gives `'0'` and `enabled` `false`.

**Evidence:**

- `AnalyticTune.js:1997-2001`: `v = line.split(/[\s,=\t]+/)` ... `parameter_set_value(vname, value)`. The value is
  passed on as text.
- `Libraries/ParameterMetadata.js:10`: `param.value = value`. `Libraries/ParameterMetadata.js:231-240` replaced the
  input with a `select` whose options are the metadata keys (`"0"`, `"1"`). By the HTML rules, setting a select to text
  that matches no option leaves nothing selected, so its value is `""`.
- `AnalyticTune.js:547`: `parseFloat(document.getElementById(vname).value)` gives NaN. `AnalyticTune.js:453`:
  `if (enable <= 0) {` is false for NaN, so the notch is built.
- `upstream/modules/ardupilot/libraries/Filter/HarmonicNotchFilter.cpp:61-66`: `@Param: ENABLE` ...
  `@Values: 0:Disabled,1:Enabled`. The file's value is 0 (`0.000000` is 0), which the firmware treats as disabled.
  The page's own number input, before metadata replaces it, accepts `0.000000` and disables the notch, so the same file
  gives a different result depending on load timing.

**Minimal correct behaviour:** when a drop-down is set from text that parses to the same number as one of its options,
that option is selected. For the reproduction, `INS_HNTCH_ENABLE` reads `0` and the notch is disabled, exactly as for
`INS_HNTCH_ENABLE 0`. Port: the drop-down branch of the form-value rule
(`apps/analytic-tune/src/analysis/form-values.ts:29`, `optionTexts(name).includes(text) ? Number(text) : NaN`) matches
by numeric value (`Number(text)` equal to `Number(option)`) instead of exact text. Text that matches no option still
reads as NaN.

## 108. Sample rate counts samples, not intervals

**Row:** `load_vtol/fw_time_history_data` use `length / trecord`. Sample rate and all bin frequencies are high by
n/(n-1).

**Verdict:** PROVEN (contradicts mathematics).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/time-history.ts` `averageRate` (`(n - 1) / record`). Tests: `apps/analytic-tune/src/analysis/pipeline.test.ts` and `apps/analytic-tune/src/analysis/load-upstream.test.ts` compare every calculation with the page patched to `(n - 1) / span` (`loadAnalyticTuneUpstream(..., { fixSampleRate: true })`; `fixSampleRate: false` is the original).

**Test:** `time-history.test.ts`, "Analytic Tune: time history loading > gives 101.01 Hz for RATE logged at exactly
100 Hz". RATE time stamps are exactly 10 ms apart, 0 to 1 s, with window 0 to 1 s. The 100 kept samples span 0.99 s, and
the returned rate is exactly `100 / 0.99` = 101.0101... Hz.

**Evidence:** `AnalyticTune.js:1600-1602`: `// Determine average sample rate` /
`const trecord = (timeRATE[timeRATE.length - 1] - timeRATE[0]) / 1000000` /
`const samplerate = (timeRATE.length)/ trecord`. `AnalyticTune.js:1728-1730` does the same for SIDD. n samples at
t_i = t_0 + i/fs span t\_{n-1} - t_0 = (n-1)/fs, so the average sample rate is (n-1)/span. n/span is high by n/(n-1).

**Minimal correct behaviour:** sample rate = (n - 1) / span. That is exactly 100 Hz for the reproduction, and every
quantity derived from it (bins, `freq_max`, `freq_step`) follows. Port: `averageRate` in
`apps/analytic-tune/src/analysis/time-history.ts:97-100` returns `(timeUs.length - 1) / record`.

## 109. Signals at different log rates analysed as one rate

**Row:** the loaders slice each message by its own nearest indices, and the `run_fft` windows follow `PilotInput`. Slow
attitude is treated as if logged at the RATE rate. Windows past its end make the attitude-based responses NaN.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `time-history.test.ts`, "Analytic Tune: time history loading > treats 50 Hz ATT as if logged at the 100 Hz
RATE rate".

- RATE and SIDD are at 100 Hz and ATT at 50 Hz, over 0 to 2 s. The sample rate is `200 / 1.99` (RATE's), `PilotInput`
  has 200 samples and `Att` has 100.
- `run_fft` (window 64, spacing 32) gives 5 windows. The `Att` spectra of windows 3 to 5 contain NaN; `PilotInput` has
  none.

**Evidence:** the tool assumes one sample rate for every signal (`AnalyticTune.js:1602`, one `samplerate` for all
data). The firmware at the pinned commit logs the system ID signals together:

- `upstream/modules/ardupilot/ArduCopter/mode_systemid.cpp:420-422`: `// Full rate logging of attitude, rate and pid loops`,
  then `copter.Log_Write_Attitude(); copter.Log_Write_Rate();`, next to SIDD in `log_data`.
- `ArduCopter/Log.cpp:77-80`: `Log_Write_Attitude` writes ANG, which the page prefers when present
  (`use_ANG_message`).
- `ArduCopter/mode.h:1784`: `ModeSystemId::logs_attitude()` returns true, so the other loops do not add samples.
- `upstream/modules/ardupilot/ArduPlane/systemid.cpp:286-288`: `log_data(); // log attitude controller at the same rate`
  `plane.quadplane.Log_Write_AttRate();`.

A log whose system ID signals have different rates is outside what the firmware writes and what the tool is evidently
designed for. No reference states what the tool should do with one, so the row stays reproduced.

## 110. Loops run one past the end

**Row:** `calculate_predicted_TF` loops `k < H_acft[0].length + 1`. There is a trailing NaN on `attctrl_ff_H` and
`sysbl_H`, never plotted.

**Verdict:** PROVEN (contradicts itself). It has no visible effect.

**Status: no port change needed.** The port never reproduced the extra element: `apps/analytic-tune/src/analysis/predict.ts` loops stop at the end. Test: `apps/analytic-tune/src/analysis/pipeline.test.ts` checks upstream's two results are one longer and every port result has the aircraft response's length; the plotted data is the same.

**Test:** `time-history.test.ts`, "Analytic Tune: calculate_predicted_TF loop bounds > returns one extra trailing NaN
element on two of the predictions". For a 32-bin `H_acft` (window 64, 400 Hz):

- the eight results have lengths `[32, 33, 32, 32, 32, 32, 32, 33]`;
- element 32 of `Ret_att_ff` and `Ret_sys_bl` is NaN (real and imaginary);
- elements 0 to 31 of every result are finite.

**Evidence:** `AnalyticTune.js:847-848`: `var FFPID_H = [new Array(H_acft[0].length).fill(0), new Array(H_acft[0].length).fill(0)]`
followed by `for (let k=0;k<H_acft[0].length+1;k++) {`. The same pattern is at `AnalyticTune.js:886`, `905-907` and
`941-944`. Each array is allocated and zero-filled with length L, then the loop writes index L from operands of length
L. `H_acft[0][L]` is `undefined`, so the element is NaN.

**Minimal correct behaviour:** every result has length L (32 for the reproduction) and elements 0 to L-1 are unchanged.
Port: the four loop bounds in `apps/analytic-tune/src/analysis/predict.ts` that copy upstream's `length + 1` become
`length`. No plotted value changes.

## 111. Fixed-wing yaw throws

**Row:** `update_PID_filters` (there is no `FWYawPIDS` element). No fixed-wing yaw analysis.

**Verdict:** PROVEN (it fails). No reference defines a correct fixed-wing yaw result, so the only fix is an error
message, which the port already shows (crash clause). No maths change.

**Status: no port change needed.** The port already reports it: `apps/analytic-tune/src/App.tsx` shows "Fixed-wing yaw has no rate controller model. Pick a roll or pitch run." (`tuneTarget` returns null for fixed-wing yaw). With the SID axis fix below, a firmware run no longer reaches fixed-wing yaw (only the undefined axis 25 does).

**Test:** `logs.test.ts`, "Analytic Tune: fixed-wing yaw > throws on Calculate after a plane log whose run is on axis
22". After a plane log whose SIDS `Ax` is 22, `[vehicle_type, page_axis]` is `['ArduPlane_FW', 'Yaw']` and there is no
`FWYawPIDS` element. `calculate_freq_resp()` throws `TypeError: Cannot read properties of null (reading 'style')`. The
page has none of `YAW_RATE_P`, `YAW_RATE_I`, `YAW_RATE_D`, `YAW_RATE_FF`.

**Evidence:**

- `AnalyticTune.js:1351`: `var ele_prefix = "FW";`. `AnalyticTune.js:1389`:
  `document.getElementById(ele_prefix + 'YawPIDS').style.display = 'block';`. `index.html` defines `FWYawNOTCH` (line 523) but no `FWYawPIDS`.
- Even without that line, the prediction reads `get_form("YAW_RATE_P")` and the other gains (`AnalyticTune.js:821-845`),
  and none of those inputs exist. So the page cannot produce a fixed-wing yaw result.
- `upstream/modules/ardupilot/ArduPlane/systemid.h:64-67` and `ArduPlane/systemid.cpp:18`: the firmware has no
  fixed-wing yaw system ID axis (20 FW input roll, 21 FW input pitch, 22 FW mixer roll, 23 FW mixer pitch).

**Minimal correct behaviour:** Calculate does not throw. It reports that fixed-wing yaw cannot be analysed, which is
what the port's error banner does now. In practice the page reaches this state from axis 22, which the firmware defines
as FW mixer roll; see the related finding below.

## 112. Fixed-wing yaw save throws

**Row:** `save_parameters`: the empty prefix matches the bitmask check boxes, and `param_to_string("on")` throws. No
.param is saved for fixed-wing yaw.

**Verdict:** PROVEN (it fails, and contradicts itself).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/param-file.ts` `saveParamText(inputs, null)` / `savedFixedWingYawParamNames` (upstream's save with the pilot-prefix rule skipped for an empty prefix), called by `apps/analytic-tune/src/App.tsx` for fixed-wing yaw. `YAW_RATE_NTF`/`NEF` are now inputs (`apps/analytic-tune/src/analysis/params.ts` `FIXED_WING_YAW_NOTCH`, `INPUT_NAMES` in upstream form order, defaults 0, step 1), read from fixed-wing logs (`apps/analytic-tune/src/analysis/load.ts`), `.param` files and links, and shown in the rail with the `FILTn` groups they select (`apps/analytic-tune/src/ui/ParamPanel.tsx`). No prediction uses them: upstream throws before computing a fixed-wing yaw response (row 111). Tests: `apps/analytic-tune/src/analysis/param-file.test.ts` "proven upstream bug fixed: fixed-wing yaw, NTF $ntf, NEF $nef, saves the file upstream throws on" (against the page patched with `fixFixedWingYawSave`), "saves the file of proofs/analytic-tune/logs.test.ts for the page defaults (row 112)", "reads YAW_RATE_NTF/NEF from a .param file and a link, as upstream"; `apps/analytic-tune/src/analysis/load-upstream.test.ts` "are read from a plane log as upstream reads them, and not from a copter log"; `apps/analytic-tune/src/analysis/params.test.ts` "lists every upstream input, in form order". The original's throw is pinned in `proofs/analytic-tune/logs.test.ts`.

**Tests:** `logs.test.ts`, "Analytic Tune: fixed-wing yaw":

- "throws on Save Parameters for fixed-wing yaw: the empty pilot prefix matches the bitmask check boxes". After a plane
  log on axis 22, `get_vehicle_plt_prefix()` is `''`, the metadata-created check box `bit_0_INS_HNTCH_HMNCS` reads
  `'on'`, and `save_parameters()` throws `Error: Could not convert on to float string` without saving. Fixed-wing roll
  (axis 20) saves `filter.param`.
- "saves when the pilot-prefix branch is skipped for an empty prefix (the fix)". The same page with the condition
  changed to `get_vehicle_plt_prefix() != "" && ...` saves exactly 22 lines: `INS_GYRO_FILTER,20`, the first and second
  notch number inputs, `SCHED_LOOP_RATE,400`, `YAW_RATE_NTF,0`, `YAW_RATE_NEF,0`, then the four drop-downs
  `INS_HNTCH_ENABLE,1`, `INS_HNTCH_MODE,1`, `INS_HNTC2_ENABLE,0`, `INS_HNTC2_MODE,0`.

**Evidence:**

- `AnalyticTune.js:1946-1948`: `if (name.startsWith(get_vehicle_plt_prefix()) && page_axis == "Yaw") { ... params += name + "," + param_to_string(value)`.
  `AnalyticTune.js:2451-2457`: `get_vehicle_plt_prefix` returns `"PILOT_"`, `"Q_PLT_"`, or `""` for fixed wing.
  `"".startsWith` is true for every element.
- The branch exists to save the pilot yaw time constant (`PILOT_Y_RATE_TC` / `Q_PLT_Y_RATE_TC`). The page uses that
  value only when the vehicle is not fixed wing (`AnalyticTune.js:921`: `if (vehicle_type != "ArduPlane_FW") {`).
  For fixed wing there is no such parameter, so matching every element (including `GyroSampleRate` and check boxes) is
  not the intent.
- `Libraries/Param_Helpers.js:67-91`: `Math.fround("on")` is NaN, and every precision fails the round-trip, so it
  reaches `throw new Error("Could not convert " + value.toString() + " to float string")`.

**Minimal correct behaviour:** for fixed-wing yaw the pilot-prefix branch saves nothing, and the file is the 22 lines
above. Port: the save routine skips the pilot-prefix rule when the prefix is empty. Other vehicles and axes are
unchanged.

## 113. Notch selection outside 1-8 throws

**Row:** `update_PID_filters` and `calculate_predicted_TF` build `FILT<n>` ids. The calculation stops.

**Verdict:** PROVEN for integer indices of 9 and above (it fails, and the firmware defines the result). Non-integer
indices (such as 1.5) are NOT PROVEN: the firmware parameter is an integer, so nothing defines what the page should do
with one.

**Status: FIXED** for integer selections of 9 and above. Port: `apps/analytic-tune/src/analysis/predict.ts` `checkNotchSelections` and `selectedNotch` (`isNoFilterIndex`: no notch); 1.5 still stops. Tests: `apps/analytic-tune/src/analysis/load-upstream.test.ts` "proven upstream bug fixed: a notch selection of %s is no notch where upstream stops" (9, 12: the prediction equals the one for 0) and "a notch selection of 1.5 names no FILTn group: both stop".

**Tests:** `logs.test.ts`, "Analytic Tune: notch filter index":

- "throws for ATC_RAT_RLL_NTF = 9 (and 1.5), in update_PID_filters and calculate_predicted_TF". On a copter Roll page,
  `update_PID_filters()` throws `TypeError: Cannot read properties of null (reading 'style')` and
  `calculate_predicted_TF` throws `TypeError: Cannot read properties of null (reading 'value')`.
- "NTF = 0 (no notch) predicts without throwing: the firmware result for index 9".

**Evidence:**

- `AnalyticTune.js:1362-1364`: `if (NTF_num > 0) { document.getElementById('FILT' + NTF_num).style.display = 'block'; }`.
  `AnalyticTune.js:862`: `if (ntf_num > 0) { ntf_freq = get_form("FILT" + ntf_num + "_NOTCH_FREQ") }`. NEF works the
  same way at lines 833 and 1366-1368. `index.html` has `FILT1` to `FILT8` only.
- `upstream/modules/ardupilot/libraries/AC_PID/AC_PID.cpp:170-171`:
  `AP_Filter* filter = AP::filters().get_filter(_notch_T_filter); if (filter != nullptr && !filter->setup_notch_filter(...))`.
  `libraries/Filter/AP_Filter.cpp:136-140`: `if (index >= AP_FILTER_NUM_FILTERS) { return nullptr; }`. So the notch
  object is never set up, and `libraries/Filter/NotchFilter.cpp:110-118` returns the input unchanged when it is not
  initialised. Index 9 or above means no notch.

**Minimal correct behaviour:** an integer `NTF`/`NEF` of 9 or above is treated as no notch: no `FILT` section is shown,
and the prediction equals the one for 0. Port: the notch-index lookup (display and prediction) treats an index with no
`FILT<n>` group as 0. Note: at this commit the firmware's `index >= AP_FILTER_NUM_FILTERS` check also gives no notch for
index 8, while the page applies `FILT8`. That is a firmware edge case, not this row, and is left alone.

## 114. SIDS record without data stops the load

**Row:** `add_sid_sets` (`tstart[i].toFixed`). The log cannot be opened and no params are copied.

**Verdict:** PROVEN (it fails).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/sid.ts` `findSidRuns` (lists the records that have data instead of throwing). Tests: `apps/analytic-tune/src/analysis/load-upstream.test.ts` "proven upstream bug fixed: more SIDS records than SIDD runs loads, where upstream throws before copying parameters" (the load equals that of the same log without the extra record, which upstream loads); `apps/analytic-tune/src/analysis/sid.test.ts`.

**Test:** `logs.test.ts`, "Analytic Tune: logs that stop the load > throws when there are more SIDS records than SIDD
runs; parameters not copied". The log has two SIDS records and one SIDD run, with `PARM` `INS_HNTCH_FREQ` 80 and
`ATC_RAT_RLL_P` 0.2. `load_log` throws `TypeError: Cannot read properties of undefined (reading 'toFixed')`.
`ATC_RAT_RLL_P` stays `0.288` and `INS_HNTCH_FREQ` stays `150` (the page defaults).

**Evidence:** `AnalyticTune.js:2352`: `const num_sets = sid_sets.axis.length` (SIDS records), while `sid_sets.tstart`
has one entry per SIDD run (`AnalyticTune.js:1077-1094`). `AnalyticTune.js:2405`:
`sid_sets.tstart[i].toFixed(2)` throws for the record without a run. `add_sid_sets` runs at line 1098, before every
parameter copy in `load_log` (lines 1130-1236). `load_log` copies parameters for any log with PARM, SID data or not.

**Minimal correct behaviour:** the load completes. Parameters are copied (`ATC_RAT_RLL_P` 0.2, `INS_HNTCH_FREQ` 80 for
the reproduction), the vehicle is detected and the time range is filled, as for a log whose SIDS and SIDD runs match.
The original has no times for the record without data, so how its row is shown is presentation. Port: building the run
table does not abort the load when `tstart[i]` is missing.

## 115. Plane log without SIDS stops the load

**Row:** `load_log` (`sid_sets.axis[0]`). Only the harmonic notch params are copied.

**Verdict:** PROVEN (it fails). No reference decides whether such a log is fixed-wing or VTOL, so the only fix is an
error message, which the port already shows (crash clause). No maths change.

**Status: no port change needed.** The port already reports it: `apps/analytic-tune/src/analysis/load.ts` throws `PartialTuneLogError` ("The log is from a plane but has no SIDS records, which upstream cannot read.") after copying what upstream copies; test `apps/analytic-tune/src/analysis/load-upstream.test.ts` "a plane without SIDS: upstream throws after copying the harmonic notch parameters".

**Test:** `logs.test.ts`, "Analytic Tune: logs that stop the load > throws for a plane log without SIDS; only harmonic
notch params copied". A fresh page loads a log with banner `ArduPlane` and PARM `INS_HNTCH_FREQ` 80, `RLL_RATE_P` 0.5,
`Q_A_RAT_RLL_P` 0.3. It throws `TypeError: Cannot read properties of undefined (reading '0')`. `INS_HNTCH_FREQ` becomes
`80`, while `RLL_RATE_P` and `Q_A_RAT_RLL_P` stay `0.288`.

**Evidence:** `AnalyticTune.js:1149-1150`: `if (parts[0] == "ArduPlane") { if (sid_sets.axis[0] > 19) {`. `sid_sets`
starts as `{}` (line 1025) and gets `axis` only from SIDS (line 1066). The vehicle choice that decides which PID
parameters are copied (`get_PID_param_names(vehicle_type)`, line 1171) needs the SID axis, and nothing defines it when
there is no SIDS.

**Minimal correct behaviour:** the load does not end in an unhandled TypeError. It reports the problem, as the port does.
No defined output beyond that.

## 116. .param lines not trimmed

**Row:** `load_parameters`. Indented lines are ignored.

**Verdict:** NOT PROVEN (behaviour reproduced exactly).

**Test:** `param-file.test.ts`, "Analytic Tune: .param files > ignores an indented line". With
`  ATC_RAT_RLL_P,0.5` then `ATC_RAT_RLL_I,0.4`, P stays `0.288` and I becomes `0.4`.

**Evidence:** `AnalyticTune.js:1997`: `v = line.split(/[\s,=\t]+/)` gives `["", "ATC_RAT_RLL_P", "0.5"]`, and
`parameter_set_value("")` finds no element. Parameter files from MAVProxy and Mission Planner are not indented, and no
format specification in the repository or the firmware says leading white space is allowed. Ignoring such a line is a
reasonable reading.

## 117. File input named in a .param stops the load

**Row:** `load_parameters` calls `parameter_set_value("fileItem", …)`. Later lines are not applied.

**Verdict:** PROVEN (it fails, and contradicts itself).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/param-file.ts` `loadParamText` (a file-input line is counted as ignored and the load continues); `App.tsx` recalculates as for any file. Test: `apps/analytic-tune/src/analysis/param-file.test.ts` "a line naming the log file input: upstream stops there, the port skips it (proven bug)".

**Test:** `param-file.test.ts`, "Analytic Tune: .param files > rejects at a line naming the log file input; later lines
not applied". The file is `ATC_RAT_RLL_I,0.4` / `fileItem,1` / `ATC_RAT_RLL_P,0.5`. `load_parameters` rejects with the
file input's `InvalidStateError`. I is `0.4`, but P stays `0.288`, and `update_all_hidden()` never runs.

**Evidence:**

- `AnalyticTune.js:1991-2007`: the loop calls `parameter_set_value(vname, value)` for each line, and that call returns
  `false` for a name it cannot set (`Libraries/ParameterMetadata.js:4-7`). So the loop is written to skip lines it
  cannot apply and carry on. `update_all_hidden()` follows the loop.
- `Libraries/ParameterMetadata.js:10`: `param.value = value` on `<input id="fileItem" type="file">` (`index.html:74`).
  The HTML standard's value setter for a file input throws an `InvalidStateError` DOMException for any non-empty value.
  The rejection escapes into the page's `unhandledrejection` handler (`index.html:775-777`).

**Minimal correct behaviour:** the `fileItem` line is skipped like any line that cannot be applied. Later lines are
applied (`ATC_RAT_RLL_P` = 0.5 for the reproduction) and `update_all_hidden()` runs. Port: the `.param` loader treats an
element that cannot take the value (a file input) as not settable and continues.

## SID axes 22 and 23 mapped as fixed-wing yaw input and roll mixer

**Row:** `add_sid_sets` names and `set_sid_axis` maps SID axis 22 as "FW Input Yaw Angle" (Yaw) and 23 as "FW Mixer Roll"
(Roll). The firmware defines 22 as FW mixer roll and 23 as FW mixer pitch. (Added to `upstream-bugs.md` with this
verdict.)

**Verdict:** PROVEN (contradicts ArduPilot).

**Status: FIXED.** Port: `apps/analytic-tune/src/analysis/sid.ts` `SID_AXIS_NAMES` and `tuneAxisForSid`
(22 "FW Mixer Roll" tunes Roll, 23 "FW Mixer Pitch" tunes Pitch; 24 to 26, which the firmware does not define, keep
upstream's names and axes). Tests: `apps/analytic-tune/src/analysis/load-upstream.test.ts` "proven upstream bug fixed: SID
axes 22 and 23 tune roll and pitch, where upstream tunes yaw and roll"; `sid.test.ts` "proven upstream bug fixed: 22 is FW
mixer roll and 23 FW mixer pitch, as the firmware defines them". The fixed-wing yaw test now uses axis 25.

**Tests (proof):** `sid-axes.test.ts`. Plane logs with one run on axis 20, 21, 22, 23, 24 give `page_axis` Roll, Pitch,
Yaw, Roll, Pitch; the run table source names 22 "FW Input Yaw Angle", 23 "FW Mixer Roll", 24 "FW Mixer Pitch".
`logs.test.ts` shows the axis-22 run then throwing on Calculate (row 111).

**Evidence:**

- `AnalyticTune.js:2343-2346`: `20: "FW Input Roll Angle"`, `21: "FW Input Pitch Angle"`, `22: "FW Input Yaw Angle"`,
  `23: "FW Mixer Roll"`, `24: "FW Mixer Pitch"`.
- `AnalyticTune.js:2431-2436`: 23 maps to Roll, 24 to Pitch, 22 and 25 to Yaw.
- `upstream/modules/ardupilot/ArduPlane/systemid.h:64-67`: `FW_INPUT_ROLL = 20`, `FW_INPUT_PITCH = 21`,
  `FW_MIX_ROLL = 22`, `FW_MIX_PITCH = 23`, and no value above 23; `ArduPlane/systemid.cpp:18`:
  `@Values: ... 20:FW Input Roll Angle, 21:FW Input Pitch Angle, 22:FW Mixer Roll, 23:FW Mixer Pitch`.

The page's own convention analyses a mixer run on its axis (VTOL mixer roll 10 and pitch 11 map to Roll and Pitch, and
its "FW Mixer Roll" maps to Roll), so with the firmware's numbering a run on 22 is a roll run and 23 a pitch run. Upstream
analyses a mixer roll run as yaw (and stops, row 111) and a mixer pitch run as roll.

**Minimal correct behaviour:** a fixed-wing run on axis 22 tunes Roll and is labelled "FW Mixer Roll"; 23 tunes Pitch
and is labelled "FW Mixer Pitch". Every other axis is unchanged.
