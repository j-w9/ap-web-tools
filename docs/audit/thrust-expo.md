# Thrust Expo audit

Upstream: `upstream/ThrustExpo/` (`ThrustExpo.js`, `index.html`, `params.json`), with
`Libraries/Array_Math.js`, `Libraries/Param_Helpers.js`, `Libraries/ParameterMetadata.js` and Tabulator
6.2.1 (submodule `modules/tabulator` at 7333c33). Port: `apps/thrust-expo/`.

The port models the page as a state machine (`src/analysis/session.ts`): each upstream event handler
is one function updating what each input shows, upstream's `params` values and the table, then
running `updatePlotData` exactly when upstream does. The oracle (`src/analysis/session.test.ts`) runs
the real `ThrustExpo.js` in `node:vm` (`src/analysis/test-support/upstream.ts`, now also building the
table through a Tabulator stand-in so the real paste parser runs) and compares, after every step of
each scenario, every input's text, every `params` value, the hover save flag, all three plots and the
saved file (or the error saving throws).

## Inventory

| Upstream item                                                                                                                                                                                                                                | Port location                                                       | Status                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params` defaults and `save` flags                                                                                                                                                                                                           | `analysis/params.ts` `INPUTS`, `session.ts`                         | identical (oracle)                                                                                                                                                                                 |
| `params.json` metadata, `constrain` min/max                                                                                                                                                                                                  | `analysis/params.ts` `PARAM_METADATA`                               | identical (test)                                                                                                                                                                                   |
| AP linearisation, `get_corrected_thrust`, gradient, std deviation, expo search -1..1 step 0.005                                                                                                                                              | `analysis/linearisation.ts`                                         | identical (oracle)                                                                                                                                                                                 |
| `if (thrustExpo)` keeps a manual expo                                                                                                                                                                                                        | `linearisation.ts` `keepsExpo`                                      | reverted in this audit: 0 was kept; now 0 and NaN refit (upstream bug)                                                                                                                             |
| Expo written to `params` unrounded and shown `toFixed(3)` after every update                                                                                                                                                                 | `session.ts` `updatePlotData`                                       | reverted in this audit: display followed the typed text                                                                                                                                            |
| Uncorrected thrust, throttle %, gradient positions                                                                                                                                                                                           | `linearisation.ts`                                                  | identical (oracle; upstream's `linear_interp` holes are NaN in the port, same gaps and same later NaN)                                                                                             |
| Hover estimate (`AUW / motors`, interpolation, 0..100 %, 4 dp, `toFixed(3)` display)                                                                                                                                                         | `linearisation.ts` `estimateHover`, `session.ts`                    | identical (oracle)                                                                                                                                                                                 |
| `MOT_THST_HOVER.save` set on first estimate, never cleared but by Reset; value is the last estimate or a value loaded from a file                                                                                                            | `session.ts` `hoverSave`, `savedParams`                             | reverted in this audit: was written only with a current estimate                                                                                                                                   |
| Hover box cleared on each update with data, left as is without data                                                                                                                                                                          | `session.ts`                                                        | identical                                                                                                                                                                                          |
| Spin markers, PWM axis range, raw cell values on the PWM plot                                                                                                                                                                                | `linearisation.ts` `spinMarkers`, `ui/traces.ts`                    | identical (oracle)                                                                                                                                                                                 |
| Row filter `row.pwm && row.thrust && !isNaN(...)`, `parseFloat`                                                                                                                                                                              | `analysis/thrust-table.ts` `isUsableRow`, `thrustData`              | reverted in this audit: 0 cells were kept and text trimmed with `Number`; now upstream truthiness and `parseFloat` (numeric 0 drops a row, `"0x10"` reads 0)                                       |
| Input `change` handlers (`parseFloat(this.value)`, then `updatePlotData()`)                                                                                                                                                                  | `session.ts` `commitInput`, `ui/Rail.tsx` `Field` (native `change`) | identical                                                                                                                                                                                          |
| MOT_SPIN_MIN `input` handler: string comparison with MOT_SPIN_ARM's text, per keystroke; its `change` only replots; MOT_SPIN_ARM `change` dispatches it                                                                                      | `session.ts` `typeSpinMin`, `spinMinInput`                          | reverted in this audit: was numeric and on blur                                                                                                                                                    |
| `loadParamFile`: split on `\n` and `,`, untrimmed id, `parseFloat`, `change` per line in order                                                                                                                                               | `session.ts` `loadParamFile`                                        | reverted in this audit: used the shared trimming parser accepting other separators, and applied MOT_SPIN_MIN; now upstream parsing, and a loaded MOT_SPIN_MIN is shown but not used (upstream bug) |
| A file line naming `paramFile` throws (file input value)                                                                                                                                                                                     | `session.ts` (`error`)                                              | reproduced: stops with the earlier lines applied, error shown (crash clause)                                                                                                                       |
| `saveParamFile`: saved params in declaration order, `param_to_string`, `ThrustExpo.param`                                                                                                                                                    | `session.ts` `paramFileText`, `PARAM_FILE_NAME`                     | identical (oracle); an empty input now throws upstream's "Could not convert NaN to float string", shown as an error, where the port used to disable the button                                     |
| Reset (defaults, 10 empty rows, hover save off)                                                                                                                                                                                              | `session.ts` `reset`                                                | identical                                                                                                                                                                                          |
| Example (data, replot, AUW 2.5 via `change`)                                                                                                                                                                                                 | `session.ts` `loadExample`                                          | identical                                                                                                                                                                                          |
| Tabulator grid: columns, numeric validator, edit on double-click or Enter, Escape cancels, invalid edit stays open, edit of the last row adds a row                                                                                          | `thrust-table.ts` `editCell`, `ui/ThrustTable.tsx`                  | reverted in this audit: cells were always-on text inputs accepting anything                                                                                                                        |
| Range selection (drag, Shift, column header, row header, corner), Delete/Backspace clears to `undefined` (`selectableRangeClearCells`), Ctrl/Cmd+C copies the range tab-separated                                                            | `ui/ThrustTable.tsx`, `thrust-table.ts` `clearRange`, `copyRange`   | restored in this audit (had been dropped)                                                                                                                                                          |
| `clipboardPasteParser` (trim, lines, tabs, `parseFloat`, columns from the range's left edge, rows added to leave one after the paste) and Tabulator's `range` paste action (single cell: all lines; larger range: its rows, repeating lines) | `thrust-table.ts` `applyPaste`                                      | reverted in this audit: unreadable values became empty and range height was ignored; now NaN ("NaN") and Tabulator's behaviour (oracle for the parser)                                             |
| `dataChanged` (debounced 100 ms) replots and refits; unchanged edits do not                                                                                                                                                                  | `session.ts` `setRows`, `ThrustTable`                               | identical (no debounce needed)                                                                                                                                                                     |
| Plot layouts, titles, legend, colours, `Std dev` legend text                                                                                                                                                                                 | `ui/traces.ts`                                                      | identical, except the gradient mean line dash (below)                                                                                                                                              |

## Remaining intentional differences

- Presentation: rail layout; placeholders instead of empty plots without data (upstream also keeps
  the last PWM axis range there); table height; the mean line uses Plotly's `dash` style because
  `@types/plotly.js` rejects upstream's custom `4px,3px`; help texts.
- Conveniences (no computed result changes): "Fit to data" button (runs the same `updatePlotData()`
  any other input change runs); parameter summary table of what Save writes; count of rows used;
  the loaded file's name; Ctrl/Cmd+arrow jumps to the first or last row/column (Tabulator jumps to the
  edge of the filled block); Tab moves right.
- Crash clause: saving with a value that is not a number, and a file line naming `paramFile`, show
  the thrown message instead of upstream's alert.

## Upstream bugs reproduced

| Location                                 | Reproduction                               | Effect                                              |
| ---------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| Row filter truthiness                    | Paste `0` as a thrust, or type `0`         | Pasted 0 drops the row, typed "0" keeps it          |
| `MOT_THST_HOVER.save` never cleared      | Example, then AUW 100                      | Hover box empty, file still writes the old estimate |
| `loadParamFile` on `paramFile`           | File line `paramFile,1`                    | Throws, later lines not applied                     |
| `updateThrustExpoPlot` `if (thrustExpo)` | Example, empty the expo box                | Fit runs (an entered 0 is fixed, see below)         |
| MOT_SPIN_MIN rule runs per keystroke     | Type `0.15` in MOT_SPIN_MIN with arm `0.1` | First keystroke `0` snaps to `0.1`                  |

## Proven upstream bugs fixed

Proven to the standard in `docs/bug-proofs/README.md`; verdicts and reproductions in
`docs/bug-proofs/thrust-expo.md` and `proofs/thrust-expo/`. The oracle tests assert upstream's
result and the port's for each, and identical results everywhere else.

| Location                                      | Reproduction                         | Upstream                                             | Port                                                     |
| --------------------------------------------- | ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------- |
| `updateThrustExpoPlot` `if (thrustExpo)`      | Example, enter expo 0                | Fit runs and overwrites 0 (box `0.385`)              | 0 is kept (box `0.000`)                                  |
| MOT_SPIN_MIN listens to `input` for its value | Load a file with `MOT_SPIN_MIN,0.13` | Box shows 0.13, plots and saved file keep 0.15       | 0.13 is used and saved                                   |
| MOT_SPIN_MIN rule compares strings            | Arm `10`, type min `2`               | `2` is not raised (`"2" < "10"` is false as strings) | Raised to `10` (numbers); empty boxes behave as upstream |
| `param_to_string(NaN)`                        | Empty MOT_PWM_MAX, Save              | "Could not convert NaN to float string", no file     | "MOT_PWM_MAX is empty. Could not convert ...", no file   |

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in dark and light: empty and with
the example data loaded. The data grid works from the keyboard (arrows, Shift, Tab, Enter to
edit, Delete, copy and paste) as before; rail fields and buttons are labelled. No console errors,
overflow or clipped text. Compared against `upstream/ThrustExpo/index.html`: every input, the
grid, the three plots, Example, Reset and Save are present.

Changed (presentation only):

- Rail fields show the parameter name in mono over a short sentence-case label (as Filter Tool
  and Analytic Tune), with a 128 px input column; the full description stays the tooltip.
- Grid selection uses the shell's yellow accent instead of a blue that appears nowhere else.
- Grid headings keep their units' case: "ESC signal (µs)" rendered as "(MS)" under the uppercase
  heading style.
- Legend names in sentence case ("Measured thrust", "Linearised thrust"); the gradient axis
  title is on two lines (with Δ) so it fits the plot height. The right margin no longer reserves
  150 px: Plotly widens it for the legend, and on phones the legend sits above the plot.
- Inline styles moved to `ui/thrust-expo.css`.

Remaining: on phones the SPIN_ARM and SPIN_MIN marker labels on the PWM plot can overlap, as they
sit close together; the grid scrolls sideways.
