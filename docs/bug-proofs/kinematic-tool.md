# Kinematic Tool: bug proofs

Reproductions: `proofs/kinematic-tool/kinematic-tool.test.ts`. The harness
`proofs/kinematic-tool/_harness.ts` runs the original `KinematicTool/KinematicTool.js` with
`Libraries/Array_Math.js`, the original `KinematicTool/ardupilot/control.wasm` and the original
Ruckig build (`KinematicTool/Ruckig/ruckig.js`, `ruckig.wasm`) in `node:vm`, with a stub DOM and
Plotly. Paths below are relative to `upstream/`; firmware paths are relative to
`upstream/modules/ardupilot/` (f3836cf).

| #   | Row                                                              | Verdict                        |
| --- | ---------------------------------------------------------------- | ------------------------------ |
| 1   | Ruckig result not registered by embind is dereferenced           | PROVEN, FIXED (no code change) |
| 2   | Jerk plot reads a missing Ruckig jerk array after a Ruckig error | PROVEN, FIXED (no code change) |
| 3   | Empty inputs are simulated as NaN                                | NOT PROVEN                     |
| 4   | Plane page shows the copter Parameters tooltip                   | PROVEN, FIXED                  |
| 5   | Mode tooltip repeats the Axis tooltip                            | NOT PROVEN                     |
| 6   | Copter Parameters tooltip names `ATC_SLEW_YAW` (new row)         | PROVEN, FIXED                  |
| A1  | `ATC_RATE_P_MAX`/`ATC_RATE_Y_MAX` named `ATC_RATE_R_MAX` (audit) | NOT PROVEN (no effect)         |

## 1. Ruckig result not registered by embind is dereferenced

Row: `KinematicTool/KinematicTool.js` `update_ruckig` (`result.value`): copter with
`ATC_ACC_R_MAX` = 0, `result` is `undefined`, the page throws and no plot updates.

**Verdict: PROVEN** (it fails, for a value the firmware documents as valid).

Test: `Kinematic Tool (copter page)` › `row 8: ATC_ACC_R_MAX = 0 makes update_ruckig dereference
an undefined result and throw`. Page defaults with `ATC_ACC_R_MAX` = `0`: `run_attitude()` rejects
with `TypeError: Cannot read properties of undefined (reading 'value')` and `Plotly.redraw` is never
called (`[]`). The control run with the defaults redraws all four plots.

Evidence:

- `KinematicTool/KinematicTool.js:427`: `input.max_acceleration = toWASM([config.accel_limit])`
- `KinematicTool/KinematicTool.js:433-435`: `const result = ruckig.calculate(input, trajectory);` /
  (blank) / `if (result.value !== 0) {`
- `KinematicTool/KinematicTool.js:557-567`: the first `Plotly.redraw("ang_pos")` comes after
  `update_ruckig`, so nothing is redrawn.
- Firmware `libraries/AC_AttitudeControl/AC_AttitudeControl.cpp:189` and `:191`:
  `// @Range: 0 1800` / `// @Values: 0:Disabled, 300:VerySlow, 720:Slow, 1080:Medium, 1620:Fast`
  (`ACC_R_MAX`, line 193).
- The page's own models treat 0 as "no limit": `KinematicTool/KinematicTool.js:291-296`
  (`if (is_positive(accel_max)) { ... } else { return desired_ang_vel }`) and `:324-327`
  (`// protect against divide by zero` / `if (!is_positive(accel_max)) {` /
  `// no acceleration set so default to 1800 degrees/s²`).

0 is a documented value ("Disabled") that the page accepts, the original handles it in two of its
three models, and the run throws before any plot is drawn.

Minimal correct behaviour: with an acceleration limit of 0 the page does not throw; the Sqrt and
SCurve traces are computed and drawn as the original computes them; the minimum-time trace, which
Ruckig cannot plan, is left out and the failure is reported.

Smallest port change: none. `apps/kinematic-tool/src/wasm/ruckig-planner.ts` already turns an
unregistered result into `{ ok: false }`, the copter model keeps the other two methods, and the
page shows a banner. Only the classification changes: this is a proven fix, not just the crash
clause.

Status: FIXED. Port: `apps/kinematic-tool/src/wasm/ruckig-planner.ts` (unregistered
result becomes `{ ok: false }`), `apps/kinematic-tool/src/analysis/copter.ts` (`minimumTime`). Tests:
`copter simulation matches upstream` › `R angle {} { ATC_ACC_R_MAX: 0 }` (upstream throws, port
`minimumTime.ok` false) and `reports a Ruckig failure but still simulates the ArduPilot shapers`
(`apps/kinematic-tool/src/analysis/simulate.test.ts`). No code change was needed.

## 2. Jerk plot reads a missing Ruckig jerk array after a Ruckig error

Row: `run_attitude` (`array_scale(ruckigState.jerk, ...)`): copter with `ATC_ACC_R_MAX` = -100 or
an empty input, angle, rate and acceleration redraw with a one-point minimum-time trace, then the
page throws and the jerk plot is not redrawn.

**Verdict: PROVEN** (it fails, and contradicts the error handling it was written with).

Tests: `row 9: ATC_ACC_R_MAX = -100 is reported by Ruckig as invalid input, then
array_scale(undefined) throws` and `row 9: an empty desired angle reaches the same throw`. Both log
`Invalid input parameters.`, redraw `['ang_pos', 'ang_vel', 'ang_accel']`, then reject with
`TypeError: Cannot read properties of undefined (reading 'length')`; the minimum-time position
trace is `x = [0]`.

Evidence:

- `KinematicTool/KinematicTool.js:435-446`: each Ruckig error code is recognised and logged
  (`if (result.value === -100) { console.log('Invalid input parameters.') ... }`) and the function
  `return`s, i.e. the error is meant to be handled.
- `KinematicTool/KinematicTool.js:507-512`: `ruckigState` starts without a `jerk` member; only the
  success path sets `state.jerk = []` (`:454`).
- `KinematicTool/KinematicTool.js:599`: `ang_jerk.data[2].y = array_scale(ruckigState.jerk, 180.0 / Math.PI)`
- `Libraries/Array_Math.js:107-108`: `function array_scale(A, scale) {` / `const len = A.length`

Minimal correct behaviour: after a Ruckig error the run completes: all four plots are redrawn with
the Sqrt and SCurve traces, and the minimum-time trace is left out (the error is reported).

Smallest port change: none; the port already omits the minimum-time trace when Ruckig fails
(`apps/kinematic-tool/src/analysis/copter.ts`, `minimumTime: { ok: false }`) and draws the rest.

Status: FIXED. Port: as row 1. Tests: `copter simulation matches upstream` ›
`R angle {} { ATC_ACC_R_MAX: -100 }` and the empty-input cases in
`apps/kinematic-tool/src/analysis/simulate.test.ts`, which assert the Sqrt and SCurve traces equal
upstream's (drawn before it throws) and `minimumTime.ok` false. No code change was needed.

## 3. Empty inputs are simulated as NaN

Row: both pages, `run_attitude` (`parseFloat(...value)`): an empty end time always runs to 20 s; an
empty desired angle never settles; NaN propagates into the plots and often into a Ruckig failure.

**Verdict: NOT PROVEN.**

Tests: `row 10: an empty end time runs to the 20 s cap` (defaults end before 2 s; with `end_time`
empty the last time is `20`) and `row 10: an empty desired angle never settles` (last time `20`,
every Sqrt angle after the first sample `NaN`).

Evidence: `KinematicTool/KinematicTool.js:475-479` and `:486-489` parse every box with
`parseFloat`; `:541` `if (time[i] > Math.max(done_time + 0.5, end_time))` is never true for a NaN
end time, so `:548` `if (time[i] >= max_time)` ends the run. The help says only "End time set the
minimum runtime of the simulation" (`KinematicTool/index.html:100`); 20 s does not contradict a
minimum, and nothing in the original says what an empty box means. The Ruckig failure an empty box
can cause is proven separately as row 2.

## 4. Plane page shows the copter Parameters tooltip

Row: `KinematicTool/plane/index.html`: mentions `ATC_SLEW_YAW` and acro on the plane page.

**Verdict: PROVEN** (help text names a parameter that does not exist on the vehicle).

Test: `Kinematic Tool help text` › `row 11: the plane page carries the copter Parameters tooltip,
naming ATC_SLEW_YAW`. Both pages carry the identical tooltip; the plane page has no `ATC_` input and
no yaw axis.

Evidence:

- `KinematicTool/plane/index.html:135`: `data-tippy-content='The ArduPilot parameters that define the input shaping vehicle model. Note that in some flight modes ATC_SLEW_YAW provides secondary yaw rate limit. Rate time constant also changes for acro mode.'`
- `KinematicTool/plane/index.html:140-166`: the plane parameters are `RLL2SRV_*`, `RLL_ANGLE_P`,
  `PTCH2SRV_*`, `PTCH_ANGLE_P`.
- Firmware `ArduPlane/Parameters.cpp:817-819`: the only attitude-controller group in ArduPlane is
  `// @Group: Q_A_` / `{ "Q_A_", (const void *)&plane.quadplane.attitude_control,`; there is no
  `ATC_` group in ArduPlane (`ATC_` is ArduCopter's, `ArduCopter/Parameters.cpp:383`).
- Firmware `libraries/AC_AttitudeControl/AC_AttitudeControl.cpp:36`:
  `// 2 was SLEW_YAW (in cdeg/s) - moved to RATE_WPY_MAX in deg/s` (so not even `Q_A_SLEW_YAW`
  exists).

Only the `ATC_SLEW_YAW` sentence is shown to be wrong. "Rate time constant also changes for acro
mode" is not disproved for Plane by any reference here.

Minimal correct behaviour: the plane page's Parameters help does not mention `ATC_SLEW_YAW`.

Smallest port change: drop the sentence "Note that in some flight modes ATC_SLEW_YAW provides
secondary yaw rate limit." from the plane page's Parameters help; keep the rest.

Status: FIXED. Port: `apps/kinematic-tool/src/ui/Rail.tsx` plane Parameters help.
Test: `Parameters help: ATC_SLEW_YAW` › `plane help keeps the rest of the tooltip but drops the
ATC_SLEW_YAW sentence` (`apps/kinematic-tool/src/ui/Rail.test.tsx`).

## 5. Mode tooltip repeats the Axis tooltip

Row: `KinematicTool/index.html`, `plane/index.html`: text only, no effect on results.

**Verdict: NOT PROVEN.**

Test: `row 12: the Mode tooltip is the Axis tooltip, on both pages` (the text occurs exactly twice
per page, once in each legend).

Evidence: `KinematicTool/index.html:52` and `:76` (plane `:52` and `:72`):
`data-tippy-content='Change the parameters used to the selected axis'`. The duplication is clear,
but the text is not demonstrably false for Mode: `update_mode` (`KinematicTool/KinematicTool.js:171-199`)
does change which of the selected axis's parameters are used (it disables `params.rate_tc` or
`ATC_INPUT_TC`). A reasonable reading makes the text accurate, so it stays reproduced.

## A1. Pitch and yaw rate inputs named `ATC_RATE_R_MAX` (audit only)

Audit row: `index.html` `ATC_RATE_P_MAX`, `ATC_RATE_Y_MAX` inputs have `name="ATC_RATE_R_MAX"`.

**Verdict: NOT PROVEN** (no observable behaviour). No test: `run_attitude` reads inputs by `id`
(`KinematicTool/KinematicTool.js:486`), and the audit records that the name has no effect. With no
output to be wrong there is nothing to fix.

## 6. Copter Parameters tooltip names `ATC_SLEW_YAW` (new row)

Row: `KinematicTool/index.html` Parameters tooltip names `ATC_SLEW_YAW`, which the pinned firmware
moved to `ATC_RATE_WPY_MAX`.

**Verdict: PROVEN** (help text names a parameter that does not exist at the pinned firmware).

Test: `Kinematic Tool help text` › `new row: the copter page Parameters tooltip names ATC_SLEW_YAW`.

Evidence:

- `KinematicTool/index.html:143`: `... Note that in some flight modes ATC_SLEW_YAW provides secondary yaw rate limit. ...`
- Firmware `libraries/AC_AttitudeControl/AC_AttitudeControl.cpp:36`:
  `// 2 was SLEW_YAW (in cdeg/s) - moved to RATE_WPY_MAX in deg/s`
- Firmware `libraries/AC_AttitudeControl/AC_AttitudeControl.cpp:166-173`: `// @Param: RATE_WPY_MAX` /
  `// @DisplayName: Yaw target slew rate` / `// @Description: Maximum rate the yaw target can be updated in Auto, Guided, Circle, Follow, RTL, SmartRTL, Throw and ZigZag flight modes`
  (the "some flight modes" secondary yaw limit the tooltip describes); copter's group prefix is `ATC_`
  (`ArduCopter/Parameters.cpp:383`).

Minimal correct behaviour: the copter help names the parameter that exists, `ATC_RATE_WPY_MAX`.

Smallest port change: name `ATC_RATE_WPY_MAX` in the copter Parameters help (keeping "formerly
`ATC_SLEW_YAW`" for users of older firmware).

Status: FIXED. Port: `apps/kinematic-tool/src/ui/Rail.tsx` copter Parameters help.
Test: `Parameters help: ATC_SLEW_YAW` › `copter help names ATC_RATE_WPY_MAX as the current parameter`
(`apps/kinematic-tool/src/ui/Rail.test.tsx`).
