# SysID audit

Port: `apps/sysid`. Upstream: `upstream/SysID/` (`index.html`, `SysID.js`), the pyAircraftIden wheel
`upstream/modules/build/pyAircraftIden-1.0-py3-none-any.whl` and the JsDataflashParser module it loads.

The identification itself is Python: upstream runs three snippets embedded in `SysID.js` in Pyodide
0.26.1. They are kept verbatim in `src/python/capture_output.py`, `transfer_function.py` and
`state_space.py` (only the indentation of the template strings is removed), loaded with `?raw` and run
with the same globals in and the same `*_js` globals out. The wheel is a byte copy. So the maths is
upstream's by construction; the oracle tests prove that the TypeScript hands Python the same inputs.

Oracle: `src/test-utils/upstream.ts` runs upstream `run_transfer_function_ID` and `run_SS_ID` in
`node:vm` with the real upstream JsDataflashParser, a fake page built from the port's setup (fields by
id, first id wins as with `getElementById`) and a fake Pyodide that records every `globals.set`.
`src/analysis/request.test.ts` compares those globals with the port's, exactly, on a synthetic SID log
(`src/test-utils/synthetic-sid.ts`: RATE chirp, SIDD response, ATT starting late and ending early,
instanced IMU, a format with no records) and on `copter-sitl.bin`: plain, multiplier, empty
multiplier, roll and pitch compensation, a window running past the end of ATT (NaN), empty and
non-numeric times, every preset with and without the transfer function form opened first, sizes
edited after generating (missing cells as null, NaN bounds, no constraints as `[[]]`), the output
count alert, and the inputs upstream crashes on. `presets.test.ts` runs upstream's ten preset setters
from `index.html` and compares every value written. `log.test.ts` compares the message pickers with
`populate_log_message_select` on three logs. `runtime.test.ts` checks the global names, the scripts
run and the result conversion with a fake Pyodide.

Verified in a browser (production build, served locally): Pyodide 0.26.1 loads from the CDN, micropip
installs matplotlib, control and the wheel, Python output streams into the output panel, a
transfer function fit and a state space fit (yaw model with bounds entered in pyAircraftIden's order)
complete and plot, and the Multirotor yaw preset reproduces the upstream bounds failure below.

Statuses: **identical**, **code-improved**, **presentation**, **convenience** (changes no computed
result), **browser-forced**, **crash handling**.

## Inventory

### Python environment (`init_pyodide`)

| Upstream item                                                                                                            | Port location                                                                                                                                                 | Status                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Pyodide 0.26.1 from `cdn.jsdelivr.net/pyodide/v0.26.1/full/`                                                             | `python/runtime.ts` `loadPython` (`pyodide` npm 0.26.1 loader, same `indexURL`)                                                                               | identical runtime; loader from npm                                              |
| Progress lines `Initializing Pyodide...`, `Loading micropip package...`, `Installing ... package...`                     | `loadPython` via `appendOutput`                                                                                                                               | identical text                                                                  |
| `micropip.install("matplotlib", deps=false)` (JS: positional `false`)                                                    | same positional call                                                                                                                                          | identical                                                                       |
| `micropip.install("control", keep_going=true, deps=false)` (positional `true, false`), latest from PyPI                  | same positional call, unpinned                                                                                                                                | identical                                                                       |
| `micropip.install("../modules/build/pyAircraftIden-1.0-py3-none-any.whl", {keep_going, upgrade})`, failure only reported | wheel imported with `?url`, written to `/tmp/<wheel name>` in Pyodide's file system, installed from `emfs:` with the same options; same success/failure lines | browser-forced (the bundler's hashed asset name is not a valid wheel file name) |
| `sys.stdout`/`sys.stderr` written to the `output` text area                                                              | `capture_output.py` verbatim; `ui/ConsolePanel.tsx` keeps a text area with id `output`                                                                        | identical                                                                       |
| `main()` clears the output after init has started                                                                        | `App.tsx` `startPython`                                                                                                                                       | identical (see bugs)                                                            |

### Log and flight data (`load`, `setup_flight_data_plot`, `populate_log_message_select`)

| Upstream item                                                                                                                                                                                                                     | Port location                                                                                        | Status                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Flight data: ATT Roll/Pitch, RATE AOut, POS RelHomeAlt, four y axes, range slider                                                                                                                                                 | `analysis/log.ts` `loadLog`, `ui/traces.ts` `flightDataTraces/Layout`                                | identical                                                                |
| Start/end times = earliest first and latest last sample of those messages                                                                                                                                                         | `loadLog` `timeRange`, `App.tsx` load handler                                                        | identical                                                                |
| Zoom sets start `floor`, end `ceil`; autorange reset leaves them                                                                                                                                                                  | `App.tsx` `onFlightRelayout`                                                                         | identical                                                                |
| Message list: types in the log except instanced bases, which appear as `NAME[i]`; `localeCompare` sort; "None" first; fields from `expressions`; field picker reset to "None" on message change and disabled for unknown messages | `listMessages`, `analysis/setup.ts` `messageOptions/fieldOptions/withMessage`, `ui/SignalPicker.tsx` | identical (oracle)                                                       |
| Pickers created before a log is loaded are empty and filled on load                                                                                                                                                               | `newSignal`, `onLogLoaded`                                                                           | identical                                                                |
| Title `SysID: <file>`                                                                                                                                                                                                             | `App.tsx`                                                                                            | identical                                                                |
| Submit enabled once a log is loaded                                                                                                                                                                                               | `Rail.tsx` `submitEnabled`                                                                           | identical (also needs a model type, where upstream's click does nothing) |

### Model forms (`index.html` `main()`)

| Upstream item                                                                                                                                                                                                                                                                                        | Port location                                                   | Status                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| Neither model type selected at start                                                                                                                                                                                                                                                                 | `INITIAL_SETUP.model = null`                                    | identical                                                           |
| Transfer function radio recreates Input 1 / Output 1 (multiplier, gravity compensation Roll/Pitch)                                                                                                                                                                                                   | `selectModel`, `TransferFunctionSetup.tsx`                      | identical; chips instead of checkboxes (presentation)               |
| Numerator, Denominator, Symbolic params text                                                                                                                                                                                                                                                         | `TransferFunctionSetup.tsx`                                     | identical (placeholders added: presentation)                        |
| State space radio recreates the preset dropdown (Manual entry)                                                                                                                                                                                                                                       | `selectModel`                                                   | identical                                                           |
| Preset choice, Outputs, Matrix A order, Number of params, Number of constraints, Generate fields                                                                                                                                                                                                     | `StateSpaceSetup.tsx`, `generateFields`                         | identical; chips for the preset (presentation)                      |
| Generate: preset writes sizes; alert `Please enter valid numbers for inputs and outputs.` on `manual && isNaN(outputs) \|\| outputs <= 0`; fields recreated; preset fills params, constraints, input, outputs; order checked afterwards (same alert, matrix tables kept); matrices and bounds filled | `generateFields`                                                | identical (oracle); alert shown in the page                         |
| Preset setters (`setinputValues` ... `setH1`)                                                                                                                                                                                                                                                        | `analysis/presets.ts` tables                                    | identical (oracle against the upstream functions)                   |
| `select.value = x` for a message the log lacks leaves the picker empty                                                                                                                                                                                                                               | `generateFields` `choose`                                       | identical                                                           |
| Preset without a loaded log: upstream throws part way (`input.onchange` is null)                                                                                                                                                                                                                     | `generateFields` returns the partial setup and an error message | crash handling                                                      |
| Shared ids between the two forms                                                                                                                                                                                                                                                                     | `setup.ts` `slotOwner/readSlot/writeSlot`                       | identical (see bugs); a note in the page says the fields are shared |

### Submit (`run_transfer_function_ID`, `run_SS_ID`)

| Upstream item                                                                                              | Port location                                                       | Status                                      |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `File Submitted successfully. Please wait!!!!!!` (transfer function only)                                  | `App.tsx` `submit`                                                  | identical                                   |
| Input sliced `[nearestIndex(t, start*1e6), nearestIndex(t, end*1e6))` on its own TimeUS; outputs on theirs | `analysis/prepare.ts` `prepareSignals`, `columns.ts` `nearestIndex` | identical (oracle)                          |
| Times: transfer function uses the trimmed text (`Number`), state space `parseFloat`                        | `analysis/request.ts`                                               | identical (oracle)                          |
| Multiplier applied when its text is truthy (`parseFloat`)                                                  | `prepare.ts` `multiplierValue`                                      | identical                                   |
| Gravity compensation `± (pi/180) * mult * 9.81 * ATT[att_ind1 + j]`                                        | `prepare.ts` `compensate`                                           | identical, NaN past the end of ATT (oracle) |
| State space alert for bad output count                                                                     | `request.ts` `stateSpaceInputs`                                     | identical text, in the page                 |
| Matrix cells: numeric text to number, other text kept, empty or missing to null                            | `request.ts` `matrixValues`                                         | identical (oracle)                          |
| Bounds `parseFloat` per param field; constraints `[[A, B], ...]` or `[[]]`                                 | `stateSpaceInputs`                                                  | identical (oracle)                          |
| Globals set and Python run                                                                                 | `runtime.ts` `runTransferFunction/runStateSpace`                    | identical names and values                  |
| Missing message/field/instanced message: upstream throws in `parser.get(...)`/`Array.from`                 | `columns.ts` `requireColumn` throws `MissingDataError`              | crash handling (error banner)               |
| Fields missing because sizes were raised after generating: upstream throws                                 | `request.ts` `missing`                                              | crash handling                              |
| Python exceptions: upstream leaves an unhandled rejection; traceback in the output                         | traceback in the output (Python's stderr), error banner             | crash handling                              |

### Results

| Upstream item                                                                                                          | Port location                                                       | Status                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| Transfer function plot "Frequency Response Data": source/fit H Amp, source/fit H Phase, Coherence of xy; 3 rows, log x | `ui/traces.ts` `transferFunctionTraces`, `TRANSFER_FUNCTION_LAYOUT` | identical                                        |
| State space plot "State Space Frequency Response Data": per output Hs/Hest Amp, Hs/Hest Pha, Coherence                 | `stateSpaceTraces`, `STATE_SPACE_LAYOUT`                            | identical                                        |
| Numerator, denominator, tau, eigenvalues, stability, parameters, A and B printed by Python                             | output panel                                                        | identical                                        |
| matplotlib Bode figures drawn but never shown                                                                          | same Python                                                         | identical (nothing is displayed upstream either) |

## Differences (not code structure)

| Difference                                                                                                                                                                                                               | Reason                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Wheel installed from Pyodide's file system                                                                                                                                                                               | browser-forced: Vite gives the asset a hashed name, micropip needs the wheel file name          |
| `pyodide` npm package as loader instead of a `<script>` tag                                                                                                                                                              | browser-forced by the module build; same version and CDN runtime files                          |
| `alert()` texts shown as an in-page message                                                                                                                                                                              | policy                                                                                          |
| Error banner for upstream crashes (missing data, Python exceptions, preset without a log)                                                                                                                                | crash handling; no result is produced in either                                                 |
| Layout: rail with log, analysis time, model type, frequencies, Submit; sections for flight data, output, setup and results; chips for radios and checkboxes; parameter fields and bounds in one table; matrices as grids | presentation                                                                                    |
| Python status badge, Clear button on the output, help texts                                                                                                                                                              | convenience                                                                                     |
| Generate fields runs once per click                                                                                                                                                                                      | upstream runs it once per earlier State space selection; only repeated alerts differ (see bugs) |

## Upstream bugs reproduced

Listed in `docs/upstream-bugs.md`:

1. Multirotor yaw preset bounds misaligned. `setBounds` writes Nr, Nped, Npedp, wlag, wlg; pyAircraftIden
   creates unknowns per matrix cell, A before B, so the order is Nr, Nped, wlag, Npedp, wlg. wlag gets
   (-10, 10) and Npedp (-50, 0). `constrain_func` then sets A_1_1 = -B_1_0 in place in x0, which leaves
   the bounds, and scipy's SLSQP raises ``ValueError: `x0` violates bound constraints`` on most random
   starts. Reproduced natively with the same wheel and in the browser. Entering bounds in cell order works.
2. Shared field ids between the forms (state space uses the transfer function's Input 1 / Output 1).
3. Gravity compensation indexed by output sample number into ATT, NaN past its end; discarded `slice`.
4. Repeated Generate fields handlers after toggling model types.
5. Output cleared after init starts, losing "Initializing Pyodide...".
6. Cutoff converted with `2 * 3.14`.
7. Ticked but empty multiplier ignored.
8. Instanced messages listed but unreadable.
