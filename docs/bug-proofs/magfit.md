# MAGFit bug proofs

Verdicts for the MAGFit rows of [`../upstream-bugs.md`](../upstream-bugs.md), using the standard in
[`README.md`](README.md). The reproductions run the original `MAGFit/magfit.js`, `wmm.js`,
`quaternion.js`, the shared Libraries, the vendored ml-matrix build and the JsDataflashParser in
`node:vm` (`proofs/magfit/_harness.ts`), on synthetic logs from `proofs/magfit/_log.ts`. In those logs
each compass logs the earth field at the log's location rotated into the body frame by the logged
attitude (computed with upstream's own `expected_earth_field_lat_lon` and `get_body_frame_ef`), plus
the logged offsets. So upstream's fits are valid unless a test makes them otherwise.

| #   | Bug                                                                                             | Verdict                                                                   | Reproduction                              |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Battery current resampled on compass 1's time base for every compass; crashes without compass 1 | **PROVEN**                                                                | `proofs/magfit/battery-time-base.test.ts` |
| 2   | Invalid fits keep stale plot data and stay ticked (can be saved)                                | **PROVEN** (stale traces) / NOT PROVEN (ticked, saved)                    | `proofs/magfit/selection.test.ts`         |
| 3   | Recalculating resets the save priority to fit order                                             | **PROVEN**                                                                | `proofs/magfit/selection.test.ts`         |
| 4   | NaN location / missing iron parameter / missing orientation parameter crash                     | **PROVEN** (iron, orientation) / NOT PROVEN (NaN location: cannot happen) | `proofs/magfit/crashes.test.ts`           |
| 5   | Samples with no attitude bin get NaN weight but are counted                                     | NOT PROVEN                                                                | `proofs/magfit/unbinned-samples.test.ts`  |

## 1. Battery current resampled on compass 1's time base for every compass

**Row.** Bug: "Battery current resampled on compass 1's time base for every compass; crashes without
compass 1". Where: `MAGFit/magfit.js` `load`: `linear_interp(value, time, MAG_Data[i].time)` (`i` =
battery index). Effect: "Misaligned/NaN motor fits for compasses 2 and 3".

**Verdict.** PROVEN. All three parts are reproduced: misaligned current, NaN fits, and the crash.

**Reproduction.** `proofs/magfit/battery-time-base.test.ts`:

- › "resamples the current for compass 2 at compass 1 sample times". Compasses 1 and 2 with compass 2
  sampled 50 ms later (`MAG_Data[0].time[10]` = 2.1 s, `MAG_Data[1].time[10]` = 2.15 s). Upstream's
  `MAG_Data[1].fits[1].value` ("Battery 1 current" for compass 2) equals
  `linear_interp(current, batTime, MAG_Data[0].time)` and differs from the same resampling at
  `MAG_Data[1].time`.
- › "gives NaN motor fits for a compass with more samples than compass 1". Compass 1 logs 300
  samples, compass 2 logs 600. Compass 2's current array has 300 entries (`value[300]` is
  `undefined`). Every compass 2 current fit (offsets, scale, iron) has NaN parameters and `valid` 0.
  Compass 1's own current fits are valid (`[1, 1, 1]`).
- › "loads a log without compass 1 when there is no battery current" and › "throws on the same log
  with battery current". With only MAG instance 1 present, the log loads and fits. Adding BAT current
  makes `load` reject with `TypeError: Cannot read properties of undefined (reading 'time')`.

**Evidence.**

- It contradicts itself. The battery loop variable is `i`. The compass loop is `j`, and it pushes the
  result into compass `j`'s fits:
  - `upstream/MAGFit/magfit.js:2035` `for (let i = 0; i < 1; i++) {`
  - `upstream/MAGFit/magfit.js:2045` `for (let j = 0; j < 3; j++) {`
  - `upstream/MAGFit/magfit.js:2051` `value: linear_interp(value, time, MAG_Data[i].time),`

  `fit` then reads that array sample by sample on compass `i`'s (here, the compass's own) index,
  alongside that compass's own samples. So element `k` must be the current at that compass's sample
  `k`:
  - `upstream/MAGFit/magfit.js:1262` `const end_index = find_end_index(MAG_Data[i].time)+1`
  - `upstream/MAGFit/magfit.js:1529` `setup_scale(A, index, 3, rot.x[data_index] * sqrt_weight[j], …)`
  - `upstream/MAGFit/magfit.js:1532` `setup_motor(A, index, 4, fit.value[data_index] * sqrt_weight[j])`

- It fails. `load` explicitly supports a missing compass 1
  (`upstream/MAGFit/magfit.js:1783` `if (!(i in log.messageTypes.MAG.instances)) {` …
  `"Not found"`, and the test loads such a log). With battery current present, the same log throws
  at line 2051 and never reaches `calculate()`.

**Minimal correct behaviour.** Compass `j`'s current series is the battery current resampled at
compass `j`'s own sample times, `linear_interp(value, time, MAG_Data[j].time)`. It has exactly one
value per compass `j` sample. A log without compass 1 loads like one without battery current.

**Smallest port change.** In the port's MAGFit load step, resample the battery current once per
compass on that compass's time array, instead of on compass 1's. Then remove the "without compass 1"
error, which only exists to mirror the crash.

## 2. Invalid fits keep stale plot data and stay ticked

**Row.** Bug: "Invalid fits keep stale plot data and stay ticked (can be saved)". Where: `fit`:
`Object.assign(fit.offsets, …)`, `show.disabled` without unticking. Effect: "Stale traces drawn;
invalid parameters saved".

**Verdict.** The stale traces are PROVEN. "Stays ticked / can be saved" is NOT PROVEN.

**Reproduction.** `proofs/magfit/selection.test.ts` › "keeps the previous field, error and yaw and
draws them". The log's attitude is held constant over its second half. After load, the test ticks
"Offsets and iron, No motor comp" for compass 1 (valid). It then sets the window to 30–59 s and runs
`calculate()`. The upstream output:

- `fits[0].iron.valid` is 0, and `params.diagonals` is the new
  `[0.6764606312546931, 1.2247597302551407, 1.0987796384901658]`.
- `x`, `y`, `z`, `error`, `yaw` and `mean_error` are the very same objects as before the
  recalculation.
- `show.checked` is `true` and `show.disabled` is `true`.
- The redraw pushes the "Offsets and iron<br>No motor comp" "Mag 1" trace with `visible: true` and
  `y` equal to the old field `x`. The error-plot trace uses the old `error`.
- In the same redraw, `error_bars.data[0].x` leaves the invalid iron fit out: `['Existing
Calibration', 'Offsets<br>No motor comp', 'Offsets and scale<br>No motor comp', 'Offsets<br>Battery
1 current', 'Offsets and scale<br>Battery 1 current']`.
- After unticking "Offsets, No motor comp", `save_parameters` asks
  `MAG 1 params outside typical range:\nCOMPASS_DIA_X 0.6764606312546931 less than 0.8\n…` and then
  saves "Offsets and iron, No motor comp" (`COMPASS_DIA_X,0.6764606`).

**Evidence (stale traces).** It contradicts itself.

- `evaluate_fit` deliberately computes no field for an invalid result:
  `upstream/MAGFit/magfit.js:1473-1474` `if (!ret.valid) {` / `return ret`. A valid result's field is
  computed from its own `params` (`apply_params(ret, rot, params, fit.value)`, line 1477).
- The result is merged rather than assigned: `upstream/MAGFit/magfit.js:1592`
  `Object.assign(fit.iron, evaluate_fit({offsets, scale, diagonals, off_diagonals, motor, fit_type: fit.type}))`
  (and the same at lines 1517 and 1548). So the object pairs the new `params` with a field from other
  parameters and another window.
- `redraw` plots that field whenever the box is ticked: `upstream/MAGFit/magfit.js:426`
  `const show = data.show.checked`, line 442 `y: data[axi]`.
- The same `redraw` treats an invalid fit as having no result: `upstream/MAGFit/magfit.js:600`
  `if (MAG_Data[i].fits[j].iron.valid) {` guards its error bar.

**Evidence ("stays ticked / can be saved", NOT PROVEN).** No reference says an invalid fit must be
unticked or must not be saved.

- `upstream/MAGFit/magfit.js:1594` `// Disable selection of invalid fits` and line 1598
  `fit[key].show.disabled = !fit[key].valid` only block user interaction.
- The load tooltip (`upstream/MAGFit/magfit.js:2021`, "If a calibration cannot be selected the tool
  was unable to find a valid solution") says the same.
- Saving out-of-range parameters is explicitly guarded by a confirmation rather than forbidden
  (`check_params`, `upstream/MAGFit/magfit.js:264-306`, `"params outside typical range"` …
  `return confirm(warning);`). A reasonable reading is that saving after that confirmation is
  intended.

**Minimal correct behaviour (stale traces).** After a calculation, an invalid fit has no field,
error, yaw or mean error from an earlier calculation. Its traces are empty or absent, consistent with
its omitted error bar.

**Smallest port change.** Where the port keeps the previous field for an invalid fit (to mirror the
merge), replace the fit result outright. An invalid fit then carries only `params` and `valid`, and
the chart builders skip it. The ticked and saved behaviour stays as upstream.

## 3. Recalculating resets the save priority to fit order

**Row.** Bug: "Recalculating resets the save priority to fit order". Where: `redraw` rebuilds
`param_selection`. Effect: "Not the last-ticked fit is saved, contrary to the tooltip".

**Verdict.** PROVEN.

**Reproduction.** `proofs/magfit/selection.test.ts` › "saves the last ticked calibration until
Calculate, then the first ticked in fit order".

1. After load, `save_parameters` saves "Offsets, No motor comp" (ticked by load).
2. Ticking "Offsets and iron, Battery 1 current" through `update_hidden` makes the save
   "Offsets and iron, Battery 1 current".
3. Running `calculate()` on the same window and data leaves that box ticked
   (`fits[1].iron.show.checked` is `true`). But the save now writes "Offsets, No motor comp".

**Evidence.** It contradicts itself (help text in the same page).

- `upstream/MAGFit/magfit.js:2152`
  `add_tip(cal_legend, 'Select calibrations to be shown on plots, the last calibration selected will be saved when "Save Parameters" is clicked.')`
- `update_hidden` implements that order: line 704 `// Move to first priority`.
- `redraw` throws it away: line 423 `MAG_Data[i].param_selection = []`. The selections are then
  re-pushed in fit order with `show` from the checkbox (lines 524-530).
- `save_parameters` saves the first shown entry (lines 316-342, `break` after the first `show`).

**Minimal correct behaviour.** After a recalculation, the saved calibration of each compass is the
most recently ticked one that is still ticked. Only when that is unticked does it fall back to the
previously ticked ones, as `update_hidden` orders them.

**Smallest port change.** Carry the selection order across recalculations. Keep the user's ordered
list of ticked fit ids, rather than rebuilding it in fit order. The port's selection reconcile step
(currently mirroring the reset) keeps the existing order and drops only fits that no longer exist.

## 4. NaN location / missing iron parameter / missing orientation parameter crash

**Row.** Bug: "NaN location / missing iron parameter / missing orientation parameter crash". Where:
`wmm.js` `get_mag_field_ef`; `load` iron matrix; `save_params` `param_to_string(undefined)`. Effect:
"No result / no file".

**Verdict.**

- Missing iron parameters: PROVEN.
- Missing orientation parameter: PROVEN.
- NaN location: NOT PROVEN, because the original cannot be given a NaN location.

**Reproduction.** `proofs/magfit/crashes.test.ts`:

- › "throws when the log has no COMPASS_DIA/ODI parameters for compass 1". `load` rejects with
  `Input data contains non-numeric values` (ml-matrix). › "throws when one diagonal is missing"
  (`COMPASS_DIA2_X` only) rejects the same way.
- › "loads and fits, then save_parameters throws". Without `COMPASS_ORIENT`, the load and fits succeed
  (`offsets.valid` 1, `params.orientation` `undefined`). `save_parameters()` then throws
  `TypeError: Cannot read properties of undefined (reading 'toString')`, and no file is saved.
- › "reports a log with no location" gives `alert('Could not get earth field for Lat: undefined Lng: undefined')`.
  › "treats a POS format with no records as no location" gives the same alert.
- › "throws only when get_mag_field_ef is called with NaN directly". `get_mag_field_ef(NaN, NaN)`
  throws `Cannot read properties of undefined (reading 'NaN')`.

**Evidence (iron).** It fails, and it contradicts ArduPilot.

- ArduPilot can be built without these parameters: `upstream/modules/ardupilot/libraries/AP_Compass/AP_Compass.cpp:385`
  `#if AP_COMPASS_DIAGONALS_ENABLED` encloses `AP_GROUPINFO("DIA", …)` (line 403) and
  `AP_GROUPINFO("ODI", …)` (line 422). The switch is in
  `upstream/modules/ardupilot/libraries/AP_Compass/AP_Compass_config.h:14-15`.
- Such a build applies no elliptical correction:
  `upstream/modules/ardupilot/libraries/AP_Compass/AP_Compass_Backend.cpp:93-104`
  (`#if AP_COMPASS_DIAGONALS_ENABLED` … `if (!diagonals.is_zero()) {` … `mag = mat * mag;`).
- Upstream mirrors the `is_zero` test (`upstream/MAGFit/magfit.js:1863`
  `if (!array_all_equal(MAG_Data[i].params.diagonals, 0.0)) {`). But with the parameters absent the
  values are `undefined`, the test passes, and the matrix built at line 1866 makes ml-matrix throw.
  The page stops before any result.

**Evidence (orientation).** It fails.

- For a compass that is not rotated, `upstream/MAGFit/magfit.js:1289`
  `orientation = MAG_Data[i].params.orientation` gives `undefined`.
- `save_params` writes it, at line 260 `ret += param_string(names.orientation, values.orientation)`.
- `param_to_string` cannot convert it. Its own error path also throws:
  `upstream/Libraries/Param_Helpers.js:89`
  `throw new Error("Could not convert " + value.toString() + " to float string")`.
- The Save button never produces a file.

**Evidence (NaN location, NOT PROVEN).**

- `extractLatLon` can only produce NaN from an empty `ORGN`/`POS` array
  (`upstream/MAGFit/magfit.js:1636` `Lat = POS.Lat[POS.Lat.length-1] * 10**-7`).
- The parser never lists a type with no records:
  `upstream/modules/JsDataflashParser/parser.js:1008` `if (msg && (msg.Total_Length != 0)) {`.
- A type with records has a non-empty `Lat` (`L`, int32, never NaN).
- So `get_mag_field_ef` only receives NaN when called directly. The tool never makes that call
  through its UI.

**Minimal correct behaviour.**

- Iron: when a compass's `COMPASS_DIA*`/`COMPASS_ODI*` parameters are absent, raw-field recovery
  skips the iron step, as ArduPilot does in a build without them. A partially missing set (not
  something ArduPilot writes) stops the load with a message rather than an uncaught exception.
- Orientation: saving does not throw. Either the orientation line is left out of the file, or the
  save stops with a message naming the missing parameter.

**Smallest port change.**

- Iron: in the port's load step, treat "all diagonals and off-diagonals absent" like
  "diagonals all zero" (skip the inverse). Keep the existing error for a partial set.
- Orientation: in the port's parameter-file builder, return a not-ok result with a message when the
  orientation is not a number, instead of throwing.

## 5. Samples with no attitude bin get NaN weight but are counted

**Row.** Bug: "Samples with no attitude bin get NaN weight but are counted". Where: `calculate_bins`,
`get_weights`. Effect: "All fits NaN when the expected field is NaN".

**Verdict.** NOT PROVEN. The row is mis-described: the NaN fits are not caused by the weighting.

**Reproduction.** `proofs/magfit/unbinned-samples.test.ts`:

- › "get_weights counts an undefined bin in the total and gives it a NaN weight".
  `get_weights([0, 0, 1, undefined]).weights` is `[1, 1, 2, NaN]` and its coverage is `2/80`.
  `get_weights([0, 0, 1])` gives `[0.75, 0.75, 1.5]`.
- › "a NaN attitude sample makes every fit invalid (NaN)". One NaN AHR2 quaternion leaves 2 compass
  samples without a bin (holes in `expected.bins`). Every fit of both compasses has `valid` 0, with
  NaN offsets.
- › "the fits stay NaN when the unbinned sample is given weight 0: the NaN comes from the expected
  field". The test replaces `get_weights` with one that skips unbinned samples entirely and
  recalculates. `expected.x[199]` and `expected.x[200]` are NaN, and every fit is still NaN and
  invalid.

**Evidence.**

- The counting does disagree with the comment, `upstream/MAGFit/magfit.js:947`
  `// Scale by mean_bin_size so that the average weight is 1`. `total_bins++` (line 939) counts the
  unbinned sample, but `count[bins[i]]++` (line 938) makes `count[undefined]` NaN.
- But the fits' NaN comes from the NaN expected field itself, which enters the least-squares system
  directly: line 1421 `B.data[index+0][0] = MAG_Data[i].expected.x[data_index] * sqrt_weight[j]`. Any
  finite weight, including 0, keeps it NaN (third test).
- The weighting therefore changes no observable output. Nothing in upstream or ArduPilot defines what
  the fits should be when attitude samples are NaN, so excluding them would be new behaviour, not a
  fix.
