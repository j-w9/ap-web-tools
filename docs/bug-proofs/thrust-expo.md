# Thrust Expo: bug proofs

Reproductions: `proofs/thrust-expo/thrust-expo.test.ts` (original `ThrustExpo/ThrustExpo.js` with
`Libraries/Array_Math.js` and `Libraries/Param_Helpers.js` in `node:vm`, harness
`proofs/thrust-expo/_harness.ts`). Paths below are relative to `upstream/`; firmware paths are
relative to `upstream/modules/ardupilot/` (f3836cf).

| #   | Row                                                      | Verdict                                              |
| --- | -------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Manual expo of 0 is refitted                             | PROVEN, FIXED (for 0; the emptied box is NOT PROVEN) |
| 2   | Numeric 0 cell drops the row, typed "0" keeps it         | NOT PROVEN                                           |
| 3   | MOT_SPIN_MIN from a parameter file shown but not used    | PROVEN, FIXED                                        |
| 4   | MOT_SPIN_MIN >= MOT_SPIN_ARM compared as strings         | PROVEN, FIXED (string comparison; per keystroke NOT) |
| 5   | Stale MOT_THST_HOVER saved                               | NOT PROVEN                                           |
| 6   | Saving with an empty input throws                        | PROVEN, FIXED (message now names the input)          |
| A1  | `loadParamFile` on `paramFile` (audit only, no bugs row) | NOT PROVEN                                           |

## 1. Manual expo of 0 is refitted

Row: `ThrustExpo/ThrustExpo.js` `updateThrustExpoPlot` (`if (thrustExpo)`): entering 0 (linear) or
emptying the box runs the fit instead and overwrites the value.

**Verdict: PROVEN** for an entered 0. **NOT PROVEN** for an emptied box.

Test: `Thrust Expo: manual expo of 0 is refitted` › `entering 0 runs the fit and overwrites the
box; 0.5 is kept`. With the Example data the fit gives `0.38500000000000106`; entering `0.5` keeps
0.5 (box `0.500`), entering `0` sets the parameter back to `0.38500000000000106` and the box to
`0.385`.

Evidence (contradicts itself, and the firmware defines 0 as a valid value):

- `ThrustExpo/ThrustExpo.js:101`: `// provide discrete expo value (prevents optimization from overwriting user input)`
- `ThrustExpo/ThrustExpo.js:340-342`: `if (thrustExpo) {` / `// don't optimize if user has provided a value` / `result = get_corrected_thrust(thrustExpo);`
- `ThrustExpo/ThrustExpo.js:271-273`: `if (is_zero(thrust_curve_expo)) {` / `// zero expo means linear, avoid floating point exception for small values` (the page's own model handles 0)
- `ThrustExpo/ThrustExpo.js:372-373`: `params.MOT_THST_EXPO.value = result.expo;` / `document.getElementById("MOT_THST_EXPO").value = result.expo.toFixed(3);`
- `ThrustExpo/index.html:62-63`: `adjust MOT_THST_EXPO to improve the linear fit.`
- Firmware `libraries/AP_Motors/AP_MotorsMulticopter.cpp:49-50`: `// @Description: Motor thrust curve exponent (0.0 for linear to 1.0 for second order curve)` / `// @Range: -1.0 1.0`

`parseFloat("0")` is `0`, which is falsy, so the user-provided value the comments promise not to
overwrite is overwritten. The emptied box gives `NaN` (test `an emptied box also refits`); nothing
in the original says an empty box is a "value provided", and fitting when there is no value is a
reasonable reading, so that half stays reproduced.

Minimal correct behaviour: an entered expo that is a number (including 0) is used as given and not
refitted; an empty box (NaN) still runs the fit as upstream does.

Smallest port change: test `thrustExpo !== null && !Number.isNaN(thrustExpo)` instead of
truthiness where the manual expo is chosen over the fit.

Status: FIXED. Port: `apps/thrust-expo/src/analysis/linearisation.ts` `keepsExpo`
(`setting.kind === 'fixed' && !Number.isNaN(setting.expo)`). Tests:
`apps/thrust-expo/src/analysis/linearisation.test.ts` › `keeps a manual expo of 0, which upstream
refits (proven upstream bug fixed)` and `session.test.ts` › `keeps a manual expo, refits an empty
input, and keeps an entered 0 (proven upstream bug fixed)`: upstream `0.38500000000000106` (box
`0.385`), port `0` (box `0.000`); the empty box still refits identically.

## 2. Numeric 0 cell drops the row, typed "0" keeps it

Row: row filter `row.pwm && row.thrust && !isNaN(row.pwm) && !isNaN(row.thrust)`.

**Verdict: NOT PROVEN.**

Test: `Thrust Expo: numeric 0 cell drops the row, typed "0" keeps it`. Rows
`{1000, 0}`, `{1100, "0"}`, `{"0x10", 0.5}`, `{1500, 1}`, `{2000, 2}` plot as
x `[1100, "0x10", 1500, 2000]`, y `["0", 0.5, 1, 2]`; `parseFloat("0x10")` is 0 while
`Number("0x10")` (what `isNaN` tests) is 16.

Evidence: `ThrustExpo/ThrustExpo.js:185-187` and `:467-469` (same filter), commented only
`// do a little error checking` (`:184`) and `// get thrust data and filter out invalid entries`
(`:466`). The original never states whether a 0 signal or 0 thrust is an "invalid entry", so which
of the two outcomes is wrong cannot be determined. That a typed cell is a string depends on
Tabulator's input editor, which the proof harness replaces; it is not shown from the original
code. No firmware or specification reference applies.

## 3. MOT_SPIN_MIN from a parameter file shown but not used

Row: `initParamInputs` (MOT_SPIN_MIN sets its value only on `input`): the loaded value appears in
the box but the plots and saved file keep the previous value.

**Verdict: PROVEN.**

Test: `Thrust Expo: MOT_SPIN_MIN from a parameter file shown but not used` › `the box shows 0.13,
the plots and saved file keep 0.15`. After the Example, loading `MOT_SPIN_MIN,0.13` and
`MOT_PWM_MAX,1900`: the MOT_SPIN_MIN box reads `0.13`, `params.MOT_SPIN_MIN.value` stays `0.15`,
MOT_PWM_MAX is applied (`1900`), the SPIN_MIN marker is at `1135` µs (1000 + 0.15 × 900) and the
saved file contains `MOT_SPIN_MIN,0.15`.

Evidence (fails to do what the page offers, and contradicts itself):

- `ThrustExpo/index.html:77`: `Load a parameter file or enter parameters manually to calculate thrust linearization.`
- `ThrustExpo/ThrustExpo.js:57-59`: `if (inputElement) {` / `inputElement.value = parseFloat(value);` / `inputElement.dispatchEvent(new Event("change"));`
- `ThrustExpo/ThrustExpo.js:89-94`: the `input` listener is the only place that does `params[paramName].value = parseFloat(this.value);` for MOT_SPIN_MIN.
- `ThrustExpo/ThrustExpo.js:96-98`: the `change` listener only calls `updatePlotData();`.
- `ThrustExpo/ThrustExpo.js:69`: the saved file writes `params` values (`${key},${param_to_string(value.value)}`), not the boxes.

A loaded parameter file is offered as the way to set the parameters used in the calculation; every
other parameter in the same file is applied, MOT_SPIN_MIN is displayed but not used or saved.

Minimal correct behaviour: after a file sets the MOT_SPIN_MIN box, the value used by the plots and
written by Save is the value the box shows.

Smallest port change: when a parameter file sets MOT_SPIN_MIN, assign the parameter from the
loaded value (as every other parameter's `change` path does). Whether a loaded value below
MOT_SPIN_ARM is raised is not part of this fix (upstream does not raise it on load).

Status: FIXED. Port: `apps/thrust-expo/src/analysis/session.ts` `loadParamFile`
(a `MOT_SPIN_MIN` line also sets the parameter from the loaded value). Test:
`apps/thrust-expo/src/analysis/session.test.ts` › `reads parameter files as upstream: commas only,
untrimmed names; a loaded MOT_SPIN_MIN is used (proven upstream bug fixed)`: upstream value
`0.15`, port `0.13` (saved as `MOT_SPIN_MIN,0.13`); every other field matches upstream.

## 4. MOT_SPIN_MIN >= MOT_SPIN_ARM compared as strings, per keystroke

Row: MOT_SPIN_MIN `input` handler (`this.value < spin_arm`): typing `0.15` with arm `0.1` jumps to
`0.1` at the first `0`; arm `10` lets min `2` stand.

**Verdict: PROVEN** for the string comparison. **NOT PROVEN** for the per-keystroke timing.

Tests: `Thrust Expo: MOT_SPIN_MIN >= MOT_SPIN_ARM compared as strings, per keystroke`:

- `arm 10 lets min 2 stand`: min `2`, then arm `10`: min box `2`, `params.MOT_SPIN_MIN.value` 2,
  `params.MOT_SPIN_ARM.value` 10.
- `within the firmware ranges, min ".2" is lowered to arm 0.1`: `".2" < "0.1"` is true as strings,
  so min 0.2 becomes `0.1`.
- `the rule runs per input event`: an intermediate `0` becomes `0.1`.

Evidence (contradicts itself and ArduPilot):

- `ThrustExpo/ThrustExpo.js:88`: `// constrain spin_min to be greater than spin_arm`
- `ThrustExpo/ThrustExpo.js:90-93`: `const spin_arm = document.getElementById("MOT_SPIN_ARM").value;` / `if (this.value < spin_arm) {` / `this.value = spin_arm;`; both operands are `<input>.value` strings, so `<` compares them lexicographically.
- Firmware `libraries/AP_Motors/AP_MotorsMulticopter.cpp:114`: `Should be higher than MOT_SPIN_ARM.`; `:122`: `Should be lower than MOT_SPIN_MIN.`; `:967-968`: `if (_spin_arm > thr_lin.get_spin_min()) {` / `"%sSPIN_ARM > %sSPIN_MIN"` (equality is allowed, so clamping to equal is consistent with the firmware).

Min 2 with arm 10 is not raised, and min 0.2 with arm 0.1 is lowered: both violate the stated
rule. Running the rule on every `input` event (so an intermediate keystroke is clamped) is an
editing quirk; no statement says when the rule should run, so that half stays reproduced.

Minimal correct behaviour: the constraint compares the two values as numbers (min raised to arm
only when numerically below it), still on each `input` event. Empty boxes keep upstream's result
(an empty min is raised to the arm text; an empty arm never raises min).

Smallest port change: compare `parseFloat` of both values in the MOT_SPIN_MIN rule, keeping the
upstream outcome when either box is empty.

Status: FIXED for the string comparison. Port:
`apps/thrust-expo/src/analysis/session.ts` `spinMinInput` (numbers when both boxes have text,
upstream's string comparison when either is empty; still run on every `input` event). Test:
`apps/thrust-expo/src/analysis/session.test.ts` › `applies the MOT_SPIN_MIN rule per keystroke,
comparing numbers (proven upstream bug fixed)`: arm `10`, min typed `2`: upstream keeps `2`, port
raises to `10`; all other steps (including the per-keystroke and empty-box steps) match upstream.

## 5. Stale MOT_THST_HOVER saved

Row: `updateThrustExpoPlot` (`params.MOT_THST_HOVER.save = true`, never cleared): once any hover
estimate is made, the file keeps writing the last value after the estimate is gone, until Reset.

**Verdict: NOT PROVEN.**

Test: `Thrust Expo: stale MOT_THST_HOVER saved` › `after the estimate is gone the file keeps the
last one`. After the Example (AUW 2.5) the estimate is shown; with AUW 100 the box is empty and
the saved file still contains the earlier `MOT_THST_HOVER` value; after Reset it is gone.

Evidence: `ThrustExpo/ThrustExpo.js:396` clears the box on every update, `:407-412` sets
`params.MOT_THST_HOVER.save = true;` only when an estimate is in range, and `:807` clears the flag
in `reset()` only: `params.MOT_THST_HOVER.save = false;`. The explicit clear in Reset alone admits
the reading "keep the last estimate in the file until Reset". No line states that the file must
hold only an estimate for the current inputs, and the box is disabled display-only (`index.html:194-199`).
No firmware reference decides it.

## 6. Saving with an empty input throws

Row: `Libraries/Param_Helpers.js` `param_to_string(NaN)`: no file is written; the page shows the
error alert.

**Verdict: PROVEN** (it fails). The port already has the minimal behaviour.

Test: `Thrust Expo: saving with an empty input throws` › `param_to_string(NaN) throws and no file
is written`. Emptying MOT_PWM_MAX makes `params.MOT_PWM_MAX.value` NaN; Save throws
`Could not convert NaN to float string` and nothing is saved.

Evidence (the original throws from a button the page offers):

- `Libraries/Param_Helpers.js:70`: `const float_val = Math.fround(value)`; `:80`: `if (float_val != Math.fround(number_val)) {` is always true for NaN; `:89`: `throw new Error("Could not convert " + value.toString() + " to float string")`.
- `ThrustExpo/ThrustExpo.js:66-72`: `saveParamFile` maps every saved param through `param_to_string` before `saveAs`.
- `ThrustExpo/index.html:235-237`: the uncaught error reaches `alert('Sorry, something went wrong.` … `If the error persists open an issue on the GitHub repo.`

Minimal correct behaviour: Save with an empty saved parameter writes no file and tells the user
which input is empty, instead of an unexpected exception. No computed value changes.

Smallest port change: none needed if the port's message names the empty input (the row says the
port shows the error); otherwise make that message name the field.

Status: FIXED. The port already wrote no file and showed the error; the message
now names the empty inputs. Port: `apps/thrust-expo/src/analysis/session.ts` `paramFileText`
(throws `<NAMES> is/are empty. Could not convert NaN to float string`, keeping upstream's text).
Tests: `apps/thrust-expo/src/analysis/session.test.ts` › `names a single empty input when saving
fails (proven upstream bug fixed)` (empty MOT_PWM_MAX: upstream `Could not convert NaN to float
string`, port `MOT_PWM_MAX is empty. Could not convert NaN to float string`) and `handles missing
and unreadable values in a parameter file, and fails to save NaN as upstream`.

## A1. `loadParamFile` on `paramFile` (audit only)

Audit row (`docs/audit/thrust-expo.md`, not in `upstream-bugs.md`): a file line `paramFile,1`
throws and later lines are not applied.

**Verdict: NOT PROVEN.** No test: the throw comes from the browser refusing a non-empty value on a
`type="file"` input (`ThrustExpo/ThrustExpo.js:56-58` looks up any element id, including
`index.html:82-86` `id="paramFile" type="file"`), which the vm harness cannot show from the
original code, and the HTML specification is not available locally to quote.
