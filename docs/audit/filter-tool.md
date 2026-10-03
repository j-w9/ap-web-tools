# Filter Tool audit

Port: `apps/filter-tool`. Upstream: `upstream/FilterTool/` (`index.html`, `filters.js`,
`params.json`), plus `Libraries/Array_Math.js`, `Libraries/ParameterMetadata.js` and
`Libraries/Plotly_helpers.js` that the page loads. The filter maths lives in `@apwt/filters` and
`@apwt/signal` (audited in [`filters.md`](filters.md) and [`signal.md`](signal.md)).

Oracles (all `node:vm`, upstream code run as is):

- `src/analysis/test-utils/upstream.ts` loads `filters.js` and calls its filter objects directly;
  `bode.test.ts` compares `gyroBode`/`pidBode` bit for bit with `get_filters`, `PID` and
  `evaluate_transfer_functions` (25 gyro and 11 PID configurations, every mode, option, both
  scales, pre and post filtering), including each notch's centre, bandwidth and initialisation.
- `src/analysis/test-utils/page.ts` (added in this audit) runs the whole page (`filters.js`,
  `ParameterMetadata.js`, `Param_Helpers.js`) over a stub DOM built from upstream `index.html` and
  `params.json`. The stub models the two browser rules the page relies on: a number input keeps
  only a valid floating-point number, and a `<select>` keeps only one of its option values.
  `page.test.ts` compares:
  - every trace (visibility, name, colour, hover template, x, y) and the layout fields that carry
    results (axis types and titles, legend, phase range) of `calculate_filter` and
    `calculate_pid` for 15 configurations x random plot settings x 3 axes x pre/post, including
    empty (`NaN`) fields and a gyro rate of 0;
  - which gyro and loop rates make the page throw;
  - the `filter.param` text of `save_parameters` (9 configurations);
  - the inputs after `load_parameters` for four files covering MAVProxy format, CRLF, indented
    lines, empty values, invalid number text, comments, `Q_A_RAT_`, operating-point ids, repeated
    names and out-of-range select values;
  - the state after `load()` reads a share link, for links made by the port, links made by
    upstream `get_link`, and hand-written links (case, `Infinity`, `ShowComponents=1`, ...);
  - the tracking-input visibility and greyed-out notch settings of `update_all_hidden`
    (40 enable/mode combinations including fractions, negatives and `NaN`);
  - the page defaults.

Statuses: **identical** (same result, possibly restructured code), **code-improved**,
**presentation**, **convenience** (changes no computed result), **browser-forced**,
**reverted-in-this-audit** (the port differed in a result and now matches upstream).

## Inventory

### Filter maths (`filters.js`)

| Upstream item                                                                                                   | Port location                                                                     | Status                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PID` (P, I = kI/rate x z/(z-1), D = kD x rate x (1-z^-1), E and D filters, component attenuation/phase)        | `@apwt/filters` `designPid`, `pidResponse`; `bode.ts` `pidBode`                   | identical (oracle)                                                                      |
| `LPF_1P` (unity for cut-off <= 0, `calc_lowpass_alpha_dt`)                                                      | `@apwt/filters` `designFirstOrderLowPass`                                         | identical (oracle); sample-rate quirk: see bugs                                         |
| `DigitalBiquadFilter` (`INS_GYRO_FILTER`, disabled for cut-off <= 0)                                            | `@apwt/filters` `designBiquadLowPass`                                             | identical (oracle)                                                                      |
| `NotchFilter` (`calculate_A_and_Q`, `init_with_A_and_Q`, range checks)                                          | `@apwt/filters` `designNotchWithBandwidth`                                        | identical (oracle)                                                                      |
| `HarmonicNotchFilter`: modes 0-5 by `==`, throttle/RPM1/RPM2/ESC tracking, multi-source chaining, double/triple | `config.ts` `trackingFromParams`, `compositionFromOptions`; `designHarmonicNotch` | identical (oracle, incl. mode 1.5 = fixed, fractional `NUM_MOTORS`)                     |
| `get_form` (`parseFloat(element.value)`)                                                                        | `ui/Fields.tsx` `NumberInput`, `analysis/fields.ts`                               | reverted-in-this-audit (an empty or invalid field is now `NaN`, as upstream; see below) |
| `get_filters` (notch 1, notch 2, low-pass, in that order)                                                       | `bode.ts` `gyroFilters`, `gyroFilterList`                                         | identical                                                                               |
| `unwrap` (45 deg negative / 315 deg positive thresholds)                                                        | `@apwt/filters` `unwrapPhase`                                                     | identical (oracle); empty-array quirk: see bugs                                         |
| `evaluate_transfer_functions` (grid from `array_from_range`, one z grid per group at the first filter's rate)   | `@apwt/filters` `chainResponse`, `frequencyGrid`; `bode.ts`                       | identical (oracle)                                                                      |
| Sample-rate "miss match" check (`error(...)`, undefined)                                                        | `bode.ts` `checkGroupSampleRates`                                                 | reverted-in-this-audit (the port had no check; see bugs)                                |
| `calculate_filter`: 0.1 Hz step to rate/2, components only if more than one filter enabled, RPM = Hz x 60       | `bode.ts` `gyroBode`, `ui/traces.ts` `gyroPlot`                                   | identical (page oracle)                                                                 |
| `calculate_pid`: 0.05 Hz step to loop rate/2, axis prefix, post filtering adds the gyro chain at the gyro rate  | `bode.ts` `pidBode`, `ui/traces.ts` `pidPlot`                                     | identical (page oracle)                                                                 |
| Trace names, colours, hover templates, axis titles (`Magnitude (dB)`, `Gain (dB)`, `Frequency (RPM)`, ...)      | `ui/traces.ts` `bodeTraces`, `bodeLayout`                                         | identical (page oracle); margins differ (presentation)                                  |
| Wrapped phase: y2 range [-180, 180], fixed; unwrapped: autorange                                                | `bodeLayout`                                                                      | identical                                                                               |
| `PID_title` (`Roll axis`, `Pitch axis`, `Yaw axis`)                                                             | `App.tsx` section title (`Rate controller: Roll`)                                 | presentation                                                                            |

### Inputs and defaults (`index.html`)

| Upstream item                                                                                                                    | Port location                                               | Status                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GyroSampleRate` 2000 (step 1), `INS_GYRO_FILTER` 20 (step 0.1)                                                                  | `params.ts` `DEFAULT_INPUTS`, `ui/field-specs.ts`           | identical (page oracle checks every default)                                               |
| Notch fields `ENABLE`, `MODE`, `FREQ`, `BW`, `ATT`, `REF`, `FM_RAT`, `HMNCS`, `OPTS`, all 0; steps 1/1/0.1/0.1/0.1/0.01/0.01/1/1 | `DEFAULT_INPUTS`, `NOTCH_STEPS`                             | identical                                                                                  |
| `Throttle` 0.3, `NUM_MOTORS` 1, `ESC_RPM` 2500, `RPM1` 2500, `RPM2` 2500                                                         | `DEFAULT_INPUTS`, `SIM_INPUTS`                              | identical                                                                                  |
| `SCHED_LOOP_RATE` 400, number input (`data-paramValues="false"`)                                                                 | `DEFAULT_INPUTS`; `ParamField freeValues`                   | identical value handling; suggestions list added (presentation)                            |
| `ATC_RAT_{RLL,PIT,YAW}_{P,I,D,FLTE,FLTD}` 0.135/0.135/0.0036/0/20, 0.135/0.135/0.0036/0/20, 0.09/0.009/0/2.5/0                   | `DEFAULT_INPUTS`, `PID_STEPS`                               | identical                                                                                  |
| Graph settings: dB, un-wrapped, log, Hz, no components; PID: same plus Filtering Pre                                             | `settings.ts` `DEFAULT_BODE_SETTINGS`, `DEFAULT_STATE`      | identical; Pre/Post shown as "Excluded"/"Included" (presentation)                          |
| `load_param_inputs`: labels, `Description` tooltips, units, `Values` parameters as `<select>`, bitmask checkboxes                | `metadata.ts` (checked against `params.json`), `Fields.tsx` | presentation (tooltip adds display name and range; short chip labels)                      |
| `<select>` keeps only an option value; other values read as `NaN`                                                                | `fields.ts` `assignFieldText`; `Fields.tsx` blank option    | reverted-in-this-audit (the port kept the number and showed "other")                       |
| Bitmask checkboxes rebuild the value from the listed bits (`read_bits`, 32-bit, no sign conversion)                              | `Fields.tsx` bitmask case                                   | identical                                                                                  |
| `update_hidden`: notch settings disabled unless `parseFloat(_ENABLE) > 0`                                                        | `config.ts` `notchInputsEnabled`, `Rail.tsx`                | reverted-in-this-audit (the port used the filter's `!(enable <= 0)`)                       |
| `update_hidden_mode`: Throttle / ESC / RPM inputs shown by `Math.floor(_MODE)` of enabled notches                                | `config.ts` `trackingSourcesShown`, `Rail.tsx`              | reverted-in-this-audit (the port used the unrounded tracking mode and `!(enable <= 0)`)    |
| Calculate Roll / Pitch / Yaw buttons, last axis remembered                                                                       | `Rail.tsx` axis chips, `PidSettings.axis`                   | presentation (the chips also choose which axis' gains the rail shows; all remain editable) |

### Files, links and storage

| Upstream item                                                                                                                                                              | Port location                                                                | Status                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save_parameters`: `INS_*` number inputs in form order, then the selects (`_ENABLE`, `_MODE` last), `NAME,param_to_string(text)`                                           | `param-file.ts` `SAVED_PARAMS`, `formatParamFile`                            | reverted-in-this-audit (the port sorted names naturally); empty field written as `0` as upstream                                                                                |
| `save_parameters` throws (`param_to_string` not loaded)                                                                                                                    | `formatParamFile`                                                            | not reproduced; see remaining differences                                                                                                                                       |
| File name `filter.param`                                                                                                                                                   | `App.tsx`                                                                    | identical                                                                                                                                                                       |
| `load_parameters`: split on `\n`, no trim, first `Q_A_RAT_` replaced, split on `[\s,=\t]+`, two or more fields set the element with that id to the raw text                | `param-file.ts` `parseParamFile`                                             | reverted-in-this-audit (the port trimmed lines, used the shared reader, skipped empty and non-finite values and only set parameters)                                            |
| After loading: `update_all_hidden(); calculate_filter()`                                                                                                                   | live state                                                                   | presentation (the PID plot also updates)                                                                                                                                        |
| `get_link`: every form input and select, checked radios, checkboxes as `true`/`false`; copy to clipboard if available                                                      | `settings.ts` `stateToQuery`, `persist.ts` `shareLink`                       | identical names and values; parameter order differs and `PID_axis` is added (convenience; upstream ignores it)                                                                  |
| `load()` from a link: whole URL lowercased, `searchParams.get` (first of repeated keys), radios by value, checkbox `=== 'true'`, numbers `parseFloat` and skipped if `NaN` | `settings.ts` `stateFromQuery(…, 'link')`                                    | reverted-in-this-audit (values were not lowercased, so `Infinity` was read; last repeated key won; `ShowComponents=1` kept the previous value; values bypassed the select rule) |
| Cookies: every value read by `get_form` and every radio, restored by `load_cookies` when there is no query (including `NaN`)                                               | `persist.ts` (localStorage, same query names), `stateFromQuery(…, 'stored')` | browser-forced/convenience: localStorage instead of cookies; all inputs are stored, not only those read; `NaN` restored as upstream                                             |
| `window.onerror` alert                                                                                                                                                     | "Calculation failed: …" in place of the plot                                 | crash handling                                                                                                                                                                  |

## Remaining intentional differences

- **Live plots.** Upstream recalculates on Calculate, an axis button, a graph option or a file
  load; the port recalculates whenever an input changes. The plot for a given set of inputs is the
  same (page oracle). Presentation.
- **Save Parameters works.** Upstream `index.html` never loads `Libraries/Param_Helpers.js`, so
  `save_parameters` throws `ReferenceError: param_to_string is not defined` at the first `INS_`
  input and no file is saved (the error alert shows). The port saves the file the function builds
  (upstream order and `param_to_string` formatting, oracle-checked with `Param_Helpers.js`
  loaded). Reproducing the crash would remove the page's only output file, which the policy's
  "nothing removed" forbids; this is the one upstream bug not reproduced and is listed below.
  **Flagged for review.**
- **Share-link timing.** Upstream converts `_ENABLE`/`_MODE` to selects when `params.json`
  arrives, asynchronously. If that happens before `load()` runs, a link's `_ENABLE`/`_MODE` are not
  read at all (they are no longer `<input>`s). The port always reads them, i.e. it follows the
  usual order (metadata after `onload`); the select rule still applies to the values.
- **Storage.** localStorage replaces cookies (cookies set by `file://` pages and shared across all
  WebTools on an origin are unreliable); the same query names are used, the whole state is stored,
  and the PID axis is remembered. Upstream only stored the operating-point inputs a calculation
  read. Convenience; no computed result for given inputs changes.
- **Components option.** The gyro "Individual filters" chip stays settable when fewer than two
  filters are enabled (it then has no effect, as upstream) and says so in its tooltip.
- **Error display.** Where upstream throws (negative or empty gyro/loop rate, empty gyro rate with
  post filtering), the port shows the error message instead of the plot.
- **Removed in this audit:** the notch status line ("N notches, fundamental at X Hz", "No notch is
  active...") reported values upstream never shows, and the gyro-rate (> 50 kHz) and loop-rate
  (> 10 kHz) limits refused inputs upstream plots. Both were new checks; they are gone. (The file
  `src/analysis/summary.ts` that computed the status is no longer used.) A very large rate makes
  the page slow, as upstream.
- **Wording, layout, theming**: rail instead of fieldsets, short labels, help text, intro.

## Upstream bugs reproduced

| Where                                                             | Reproduction                                                             | Effect                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filters.js` `evaluate_transfer_functions` sample-rate check      | Clear Gyro Sample Rate, Filtering Post, calculate PID                    | Compares `filters[0].sample_rate` with itself, so it only fires for `NaN`, then calls the undefined `error()`: ReferenceError, no PID plot. Reproduced (`checkGroupSampleRates`); with Pre filtering the PID plots.                       |
| `filters.js` `LPF_1P` with cut-off <= 0                           | `ATC_RAT_RLL_FLTE` = 0                                                   | Returns before setting `sample_rate`. No effect in this tool: an `LPF_1P` is never first in a group (the `PID`, whose own rate is used, is). Nothing to reproduce.                                                                        |
| `ParameterMetadata.js` selects for `_ENABLE`, `_MODE`             | Load `INS_HNTCH_MODE 1.000000` (MAVProxy format) or `INS_HNTCH_ENABLE,2` | The select has no such option and reads `""` → `NaN`: mode `NaN` is a fixed notch; enable `NaN` still enables the filter (`NaN <= 0` is false) while its settings are greyed out. Reproduced (`assignFieldText`).                         |
| `filters.js` `update_hidden` vs `HarmonicNotchFilter` enable test | `_ENABLE` empty (`NaN`)                                                  | The UI tests `> 0`, the filter `!(<= 0)`: settings greyed out, notch applied. Reproduced.                                                                                                                                                 |
| `filters.js` `update_hidden_mode`                                 | `_MODE` 1.5 (only possible before the select replaces the input)         | Visibility uses `Math.floor(mode)` (throttle input shown) while the filter compares `mode == 1` (fixed notch). Reproduced (`trackingSourcesShown`).                                                                                       |
| `filters.js` `save_parameters` order and values                   | Save                                                                     | Number inputs first, selects (`_ENABLE`, `_MODE`) last; an empty field is written as `0` (`Math.fround("")`). Reproduced.                                                                                                                 |
| `index.html` missing `Param_Helpers.js`                           | Save Parameters                                                          | `param_to_string is not defined`, no file. **Not reproduced** (see remaining differences).                                                                                                                                                |
| `filters.js` `load_parameters` does not trim                      | Load a file with indented lines or `NAME,`                               | Indented lines are ignored (first field empty); `NAME,` empties the field (`NaN`); `5.`, `+1`, `Infinity` empty a number field; any element id can be set, including `GyroSampleRate`, `Throttle`, `RPM1`. Reproduced (`parseParamFile`). |
| `filters.js` `load()`                                             | Link with `Throttle=Infinity`                                            | The whole URL is lowercased, so `infinity` is not a number and is skipped. Reproduced.                                                                                                                                                    |
| `filters.js` `unwrap` of an empty array                           | Gyro Sample Rate 0                                                       | Returns `[undefined]` (writes index 0 of a length-0 array). The port's `unwrapPhase` returns `[]`; with no x values neither plots anything, so the plot is the same.                                                                      |
