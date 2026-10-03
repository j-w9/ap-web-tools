# SysID: bug proofs

Verdicts for the SysID rows of [`../upstream-bugs.md`](../upstream-bugs.md) (the same eight items as
"Upstream bugs reproduced" in [`../audit/sysid.md`](../audit/sysid.md)). Reproductions:
[`proofs/sysid/sysid.test.ts`](../../proofs/sysid/sysid.test.ts), which loads the original page
(`upstream/SysID/index.html` inline script, `SysID.js`, `Libraries/Array_Math.js`) in `node:vm` with a
DOM that keeps index.html's element order, the upstream JsDataflashParser, and a fake Pyodide that
records the globals and Python source handed to it. Python itself is not run: where a verdict depends
on Python it rests on a quoted reading of the Python source (SysID.js strings and the pinned
`upstream/modules/build/pyAircraftIden-1.0-py3-none-any.whl`), and anything that would need a Python run
to be certain is marked as such.

| #   | Bug                                                              | Verdict                                                               |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Multirotor yaw preset bounds do not line up with parameter order | PROVEN (misalignment); the SLSQP failure clause is NOT PROVEN         |
| 2   | Transfer function and state space forms share field ids          | PROVEN                                                                |
| 3   | Gravity compensation indexes ATT by the output's sample number   | PROVEN (reads outside the ATT window it computed; NaN past ATT's end) |
| 4   | Each State space selection adds another Generate fields handler  | NOT PROVEN                                                            |
| 5   | First progress line is wiped                                     | PROVEN                                                                |
| 6   | Low-pass cutoff converted with 2 \* 3.14                         | PROVEN                                                                |
| 7   | A ticked multiplier with an empty value is ignored               | NOT PROVEN                                                            |
| 8   | Instanced messages offered in the pickers cannot be read         | PROVEN                                                                |

PROVEN: 6. NOT PROVEN: 2.

pyAircraftIden paths below are inside the wheel (`AircraftIden/...`); line numbers are those of the
unzipped files.

## 1. Multirotor yaw preset bounds do not line up with pyAircraftIden's parameter order

Row: _`SysID/index.html` `setBounds` (MR_Yaw). Bounds follow the field order (Npedp before wlag);
pyAircraftIden orders by matrix cell (wlag before Npedp). SLSQP then usually fails with ``x0` violates
bound constraints``._

**Verdict: PROVEN** for the misalignment (it contradicts itself: each bound is commented with the
parameter it is for, and pyAircraftIden applies it to another). The consequence "SLSQP then usually
fails" is **NOT PROVEN** here: it depends on random starts and scipy's behaviour and needs a Python run.

Tests: `MR_Yaw: field order Nr, Nped, Npedp, wlag, wlg; cell order Nr, Nped, wlag, Npedp, wlg` (the
original page fills the preset; the globals handed to Python are `sym_var` = Nr, Nped, Npedp, wlag, wlg,
`matrixA` = `[[Nr, Nped], [0, wlag]]`, `matrixB` = `[[Npedp], [wlg]]`, `bounds_array` = `[[-1, 0, -10, -50, 0], [0, 80, 10, 0, 50]]`;
taking unknowns cell by cell gives wlag (-10, 10) and Npedp (-50, 0)); control
`%s: field order equals cell order` for MR_Roll, MR_Pitch and MR_Vertical.

Evidence:

- The preset states which bound belongs to which parameter, `upstream/SysID/index.html:569-575`:
  `//Npedp` / `Bound_min_3 ... "-10"` / `Bound_max_3 ... "10"` / `//wlag` / `Bound_min_4 ... "-50"` /
  `Bound_max_4 ... "0"`. The parameter fields are filled in the same order, `index.html:467-471`
  (`"Nr"`, `"Nped"`, `"Npedp"`, `"wlag"`, `"wlg"`).
- The matrices put wlag in A and Npedp in B, `index.html:669-680` (`matrixA_r1_c1` = `"wlag"`,
  `r0_c0` = `"Nr"`, `r0_c1` = `"Nped"`) and `index.html:709-714` (`matrixB_r0_c0` = `"Npedp"`,
  `r1_c0` = `"wlg"`).
- SysID.js passes the bounds as two positional lists and does not use the parameter names to order them:
  `SysID.js:98-111` (`getBounds`), `SysID.js:876` `bnd = tuple(bounds_array)`, `SysID.js:901`
  `ssm_iden.estimate(LatdynSSPM, syms, constant_defines={}, rand_init_max=10, bounds = bnd)`; the names
  are only read as `sym_var = list(sym_var)` (`SysID.js:828`) and passed to `getMatrixJs`, which never
  uses its `sym_var` argument (`SysID.js:841-862`).
- `M = sp.Matrix(np.eye(int(orderA)))` (`SysID.js:800`); `StateSpaceParamModel.py:75-78`
  `M_inv = self.M ** -1` / `self.A = M_inv * self.F` / `self.B = M_inv * self.G`.
- `StateSpaceParamModel.py:101-104` determines unknowns from A, then B, then H0, H1, and
  `StateSpaceParamModel.py:128-139` walks each matrix `for i in range(m): for j in range(n):`, and
  `if not element.is_number:` appends `"{}_{}_{}".format(matname, i, j)` to `self.new_params_list`.
  For MR_Yaw that is A_0_0 (Nr), A_0_1 (Nped), A_1_1 (wlag), B_0_0 (Npedp), B_1_0 (wlg).
- `StateSpaceIden.py:104-105` `self.lower_bnd=bounds[0]` / `self.upper_bnd=bounds[1]`,
  `StateSpaceIden.py:108` `self.x_syms = list(sspm.get_new_params())`, and `StateSpaceIden.py:263-267`
  `bnds.append((self.lower_bnd[k],self.upper_bnd[k]))` then `minimize(f, x0, ..., bounds=bnds)`: bound k
  constrains `x_syms[k]`.
- For MR_Roll, MR_Pitch and MR_Vertical the field order equals the cell order (control test), so only
  MR_Yaw, whose B holds a parameter (Npedp) listed before an A parameter (wlag), is misaligned.

Minimal correct behaviour: with the Multirotor Yaw preset, wlag is bounded to (-50, 0) and Npedp to
(-10, 10), as the preset's comments say; every other preset is unchanged.

Smallest port change: in `apps/sysid/src/analysis/presets.ts` `MR_Yaw`, list `params` and `bounds` in
pyAircraftIden's cell order (`Nr, Nped, wlag, Npedp, wlg` with bounds `(-1,0), (0,80), (-50,0), (-10,10), (0,50)`),
so each bound field also sits next to the name of the parameter it constrains.

## 2. Transfer function and state space forms share field ids

Row: _`SysID/index.html` `createInputFields` (`input_name_1`, `output_name_1`, ...). After Transfer
function has been selected, state space Submit and presets use the transfer function form's Input 1 and
Output 1._

**Verdict: PROVEN** (it fails: the State Space form's own Input 1 / Output 1 selections are ignored, and
with the hidden form left at "None" Submit throws and no identification runs).

Tests: `state space Submit reads the visible form when Transfer function was never selected` (control:
input data is the chosen RATE.YOut), `after Transfer function was selected, state space Submit reads the
hidden form and throws` (two `input_name_1` elements; the first, in `tf_inputFieldsContainer`, is
"None"; `run_SS_ID` rejects with `TypeError: Cannot read properties of undefined (reading 'length')`),
`after Transfer function was selected, the Multirotor Yaw preset fills the hidden form` (RATE/YOut and
SIDD/Gz land in the transfer function form; the visible State Space selects stay "None").

Evidence:

- Both forms create fields with the same ids: `index.html:797-798`
  `createInputFields('tf_inputFieldsContainer', 'Input', 'input', 1)` /
  `createInputFields('tf_outputFieldsContainer', 'Output', 'output', 1, true, true)` and
  `index.html:832-833` `createInputFields('inputFieldsContainer', 'Input', 'input', 1)` /
  `createInputFields('outputFieldsContainer', 'Output', 'output', numOutputs, true, true)`, where
  `index.html:353-354` sets ``inputName.id = `${inputNamePrefix}_name_${i + 1}` ``. Selecting the other
  model only hides the form (`index.html:812-813`); its fields stay in the document, and `tf_form`
  (`index.html:91`) precedes `ss_form` (`index.html:113`).
- `populate_log_message_select` treats the four containers separately (`SysID.js:382`
  `['inputFieldsContainer', 'outputFieldsContainer', 'tf_inputFieldsContainer', 'tf_outputFieldsContainer']`,
  looking up each field select inside its own container, `SysID.js:390`), so the State Space form
  offers its own working pickers.
- Submit reads by id: `SysID.js:666-667` `getFieldValues('input', 1)` / `getFieldValues('output', numOutputs)`
  → `SysID.js:65-66` ``document.getElementById(`${prefix}_name_${i + 1}`)``, which returns the first
  element in document order. With "None", `SysID.js:675` `parser.get(inputValues.names[0], "TimeUS")`
  is `undefined` and `SysID.js:118` `arr.length` throws. The presets write the same ids:
  `index.html:483-485` and `index.html:505-531`.
- The throw escapes: the Submit handler calls `run_SS_ID(log)` without awaiting or catching it
  (`index.html:882-883`).

Minimal correct behaviour: State Space Submit and the State Space presets read and write the State Space
form's Input 1 and Output 1 (and its multiplier and compensation controls), whether or not Transfer
function was selected before; Transfer function Submit keeps reading its own form.

Smallest port change: stop sharing slots between the forms in `apps/sysid/src/analysis/setup.ts`
(`slotOwner` always gives the State Space slots to the State Space form) and drop the
"shared with the transfer function form" note in `App.tsx`.

## 3. Gravity compensation indexes ATT by the output's sample number

Row: _`SysID/SysID.js` `run_*_ID` (`ang_data_arr[att_ind1 + j]`). Only aligned when ATT is logged with
the output; past the end of ATT the value is NaN. The `ang_data_arr.slice(...)` result is discarded._

**Verdict: PROVEN** (it contradicts itself). The code finds the ATT window by time, `att_ind1`..`att_ind2`,
the same way it finds the output window, and states that only that window is used
(`ang_data_arr.slice(att_ind1, att_ind2)`); it then reads `ATT[att_ind1 + j]` for every output sample j,
which leaves that window, and leaves the array (NaN), whenever the output has more samples in
`[t_start, t_end]` than ATT does.

Test: `20 Hz output, 10 Hz ATT: sample j uses ATT[j], past the ATT window and then NaN`. ATT (Roll =
its sample number) covers 0-2.0 s at 10 Hz, SIDD.Ay = 0 at 20 Hz, window 0-2 s: 39 output samples;
output sample 10 (0.50 s) gets `(π/180)·9.81·10`, the attitude logged at 1.00 s; samples 21-38
(1.05-1.90 s) are NaN although ATT covers those times.

Evidence:

- `SysID.js:447-450` `const ATT_t_data = parser.get("ATT", "TimeUS")` /
  `const att_ind1 = nearestIndex(ATT_t_data, t_start*1000000)` /
  `const att_ind2 = nearestIndex(ATT_t_data, t_end*1000000)` (same at `SysID.js:712-715`), and the
  output window `SysID.js:432-438` (`ind1_d`, `ind2_d`, `outputData.slice(ind1_d, ind2_d)`).
- `SysID.js:456-457` `ang_data_arr = Array.from(ang_data)` / `ang_data_arr.slice(att_ind1, att_ind2)`
  (result discarded; same at `SysID.js:721-722`).
- `SysID.js:461-462` `for (let j = 0; j < outputData.length; j++) {` /
  `outputData[j] = outputData[j] + (Math.PI/180) * mult * G * ang_data_arr[att_ind1 + j]` (Pitch
  `SysID.js:466-467`; state space `SysID.js:726-734`). `j` is bounded by the output's length, never by
  `att_ind2 - att_ind1`.
- The NaN samples are handed to Python as `output_data` (`SysID.js:480`) and low-pass filtered with
  `filtfilt` (`SysID.js:516-519, 527`).
- Context, not needed for the verdict: in SystemId mode the firmware writes ATT next to every SIDD
  (`upstream/modules/ardupilot/ArduCopter/mode_systemid.cpp:416-421`, SIDD only when
  `is_positive(delta_angle_dt) && is_positive(delta_velocity_dt)`), which is why SIDD outputs are usually
  aligned; outputs from other messages, windows that extend outside SystemId mode, or skipped SIDD samples
  are not.

Minimal correct behaviour: each output sample is compensated with an ATT sample from the analysis window
that corresponds to that sample's time; no sample is compensated with attitude from outside
`[t_start, t_end]`, and no sample becomes NaN while ATT covers its time. Where ATT is logged one-for-one
with the output from the window start (the SystemId case) the result is unchanged.

Smallest port change: in `apps/sysid/src/analysis/prepare.ts` `compensate`, index the angle by the ATT
sample nearest in time to output sample j (`nearestIndex(attTime, outputTime[j])`, passing the output's
sliced TimeUS), instead of `attStart + j`.

## 4. Each State space selection adds another Generate fields handler

Row: _`SysID/index.html` `ss_select` change handler. After toggling model types one click runs the
generator (and its alert) once per selection. The port runs it once._

**Verdict: NOT PROVEN.** The duplicate handler is real (`index.html:808-815` adds a `click` listener on
every `change` of `ss_select`), but the second run regenerates the same State Space form, so no result
differs; the visible differences are a repeated alert and an extra copy of every option appended to the
hidden transfer function selects (the selected values do not change). No reference states that the
generator must run once; this is a UI quirk with no stated intent.

Tests: `after ss, tf, ss one click runs the generator twice` (two listeners; Manual Entry with no
outputs gives the alert twice), `a valid click leaves the State Space form as one run does` (State Space
form identical to a page with one listener; hidden transfer function selects have one more option set,
same selection).

Evidence: `index.html:815` `document.getElementById('createFieldsButton').addEventListener('click', function () {`
inside `index.html:808` `document.getElementById("ss_select").addEventListener("change", function () {`;
`index.html:827-829` the alert; `index.html:836` `populate_log_message_select()` appends options to all
four containers (`SysID.js:350-359, 382`).

Note: the row's "The port runs it once" is a deviation the standard does not cover (the bug is not
proven); it changes only the alert count and the hidden form's option list.

## 5. First progress line is wiped

Row: _`SysID/index.html` `main()` clears `output` after `init_pyodide()` starts. "Initializing
Pyodide..." never stays in the output._

**Verdict: PROVEN** (it contradicts itself: the page writes a progress line for display and erases it in
the same synchronous task, before it can ever be seen).

Test: `writes "Initializing Pyodide..." and main() clears it in the same task` (the output's value is
written `"Initializing Pyodide...\n"` then `""`, and is `""` when the script finishes).

Evidence:

- `index.html:183` `init_pyodide()` runs first; `SysID.js:8-10` `async function init_pyodide() {` /
  `addToOutput("Initializing Pyodide...")` / `pyodide = await loadPyodide()`: the line is written
  synchronously, via the hoisted `index.html:895-898` `function addToOutput(message)` /
  `output.value += message + "\n"`.
- `index.html:889` `main()` then runs, and its first statements, before any `await`, are
  `index.html:203-204` `const output = document.getElementById("output");` / `output.value = '';`.
- The later progress lines (`SysID.js:12-27`) come after `await`s and stay.

Minimal correct behaviour: "Initializing Pyodide..." is the first line of the output and stays there with
the later progress lines.

Smallest port change: in `apps/sysid/src/App.tsx` `startPython`, remove the `clearOutput()` after
`loadPython(appendOutput)` (or clear before starting the load).

## 6. Low-pass cutoff converted with 2 \* 3.14

Row: _Python in `SysID/SysID.js` (`float(f_cutoff)/(2*3.14)`). The cutoff in Hz is 0.05 % higher than
the rad/s value entered._

**Verdict: PROVEN** (it contradicts mathematics: the rad/s to Hz conversion divides by 2π; 2 × 3.14 =
6.28 is a different constant).

Test: `passes the rad/s text to Python, which divides by 2*3.14 in both models` (`f_cutoff` is handed
over as the text `"10"` by both models; both Python sources contain
`f_cutoff = float(f_cutoff)/(2*3.14)`, seconds from `/1000000` and `normal_cutoff = cutoff / nyquist`;
`10/(2·3.14)` ÷ `10/(2π)` = 1.000507).

Evidence:

- The field is in rad/s: `index.html:175` `LPF cutoff frequency (rad/sec):`.
- `SysID.js:506` and `SysID.js:820` `f_cutoff = float(f_cutoff)/(2*3.14)`.
- The filter takes Hz: `SysID.js:521, 524` (`time_seq_source = np.array(time_data).flatten()/1000000`,
  `dt = np.mean(np.diff(time_seq_source))`, seconds), `SysID.js:526` `apply_lowpass_filter(input_data, f_cutoff, 1/dt)`
  (fs in Hz), `SysID.js:510-512` `nyquist = 0.5 * fs` / `normal_cutoff = cutoff / nyquist` /
  `butter(order, normal_cutoff, ...)`; state space `SysID.js:803-806, 814, 822-825`.
- 2π / 6.28 = 1.000507: the cutoff used is 0.0507 % higher than the value entered.

Minimal correct behaviour: the cutoff passed to the filter is `f_cutoff / (2π)` Hz for the value entered
in rad/s.

Smallest port change: in `apps/sysid/src/python/transfer_function.py:17` and
`apps/sysid/src/python/state_space.py:38`, use `/(2*math.pi)` (`math` is already imported by both
upstream scripts, `SysID.js:494, 787`).

## 7. A ticked multiplier with an empty value is ignored

Row: _`SysID/SysID.js` (`if (outputValues.multipliers[i])`). No scaling is applied and nothing is shown._

**Verdict: NOT PROVEN.** An empty multiplier has no defined value; skipping the scaling (and using
`mult = 1` in the compensation) is a reasonable reading, and no help text or reference says what an
empty ticked multiplier should do (applying `parseFloat('')` would make every sample NaN).

Test: `scales nothing and reports nothing` (output data equals the raw RATE.YOut samples; no alert).

Evidence: `SysID.js:69-70` `if (multiplierCheckbox && multiplierCheckbox.checked) {` /
``multipliers.push(document.getElementById(`multiplier_${i + 1}`).value.trim())``; `SysID.js:441-443`
`if (outputValues.multipliers[0]) {` ... `outputData = outputData.map(value => value * multiplier)`;
`SysID.js:451-454` (`let mult = 1`) and `SysID.js:706-708, 716-719` for state space.

## 8. Instanced messages offered in the pickers cannot be read

Row: _`SysID/SysID.js` `parser.get('IMU[0]', ...)`. `get` matches FMT names only, so Submit throws on the
undefined array. The port shows an error instead._

**Verdict: PROVEN** (it fails: the pickers offer `IMU[0]`, its fields and Submit, and the run throws
before any identification).

Tests: `lists IMU[0] and IMU[1], and Submit with IMU[0] throws` (options include `IMU[0]` and `IMU[1]`,
not `IMU`; field options `None, TimeUS, I, GyrZ`; `run_transfer_function_ID` rejects with
`TypeError: Cannot read properties of undefined (reading 'length')`), `the parser's own get_instance
reads the data that get('IMU[0]') does not`.

Evidence:

- Offered: `SysID.js:330-335` lists every `log.messageTypes` key except bases with `instances`
  (`// Don't add base message types with instances`); the parser adds one key per instance,
  `upstream/modules/JsDataflashParser/parser.js:1026-1035`
  (`const inst_name = msg.Name + '[' + instance + ']'` / `messageTypes[inst_name] = { expressions: fields, ...`),
  and `SysID.js:369-374` fills the field select from it.
- Not readable: `SysID.js:414` `parser.get(inputValues.names[0], "TimeUS")`; `parser.js:541-543`
  `get(name, field) { return this.get_instance(name, null, field) }`; `parser.js:466-470`
  `const msg_FMT = this.getFMT(name)` / `if (msg_FMT == null) { // no such message return }`;
  `parser.js:428-436` `getFMT` compares `this.FMT[i].Name == element`, and no FMT is named `IMU[0]`.
  Then `SysID.js:118` `const len = arr.length` throws (same for outputs, `SysID.js:432-433`, and state
  space, `SysID.js:675, 695`).
- The parser can read the instance: `parser.js:464` `get_instance(name, instance, field)` with
  `parser.js:536-537` `return parse(msg_FMT.InstancesOffsetArray[instance])`.

Minimal correct behaviour: choosing `NAME[n]` in a picker uses instance n of NAME (its TimeUS and the
chosen field), as the parser's `get_instance(NAME, n, field)` returns it; non-instanced names are read as
before.

Smallest port change: in `apps/sysid/src/analysis/columns.ts` (`upstreamColumn`, used by
`requireColumn`), resolve a `NAME[n]` message to instance n of NAME instead of reporting it as
unreadable.
