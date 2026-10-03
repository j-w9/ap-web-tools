# Audit: S-Curve Tool

Port: `apps/scurve-tool`. Upstream: `upstream/SCurveTool/` (`index.html`, `SCurveTool.js`,
`params.json`, `ardupilot/wpnav.js` + `wpnav.wasm`), plus `Libraries/ParameterMetadata.js`,
`Libraries/Plotly_helpers.js`, `Libraries/Array_Math.js` and `Libraries/LoadingOverlay.js`.

Standard: [`docs/porting-policy.md`](../porting-policy.md). The maths is compared by oracle tests that
run upstream `SCurveTool.js` and the same Emscripten glue and wasm in a `node:vm` context
(`src/analysis/test-utils/upstream.ts`).

## Inventory

Status values: **identical** (same result, possibly restructured code), **presentation**,
**convenience** (added or changed UX that changes no computed result), **browser-forced**,
**reverted-in-this-audit** (port changed to match upstream).

### Computation

| Upstream item                                                                                                                         | Port location                                                  | Status                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `WPNavModule()` loading `ardupilot/wpnav.js` + `wpnav.wasm`                                                                           | `src/wasm/wpnav.ts`, `wpnav-glue.js`, `wpnav.wasm`             | identical (wasm byte-identical, md5 `299980ed…`; glue identical to `wpnav.js`, only renamed)                                         |
| `AC_WPNav_wrapper` calls: `set_wp_nav_params(WP_SPD, WP_SPD_UP, WP_SPD_DN, WP_RADIUS_M, WP_ACC, WP_ACC_CNR, WP_ACC_Z, WP_JERK, 10.0)` | `simulate.ts` `wpNavLimits`, `wasm/wpnav-engine.ts`            | identical (argument order checked)                                                                                                   |
| `set_psc_params(PSC_NE_POS_P, PSC_D_ACC_FLTT, PSC_D_ACC_FLTE, PSC_JERK_NE, PSC_JERK_D, dt)`                                           | `simulate.ts` `posControlSettings`                             | identical                                                                                                                            |
| `set_atc_params(ATC_RATE_R_MAX, ATC_RATE_P_MAX, ATC_ACC_R_MAX, ATC_ACC_P_MAX, ATC_INPUT_TC, ATC_RATE_FF_ENAB == 1.0)`                 | `simulate.ts` `attitudeSettings` (`=== 1`, same for numbers)   | identical                                                                                                                            |
| Waypoints: `n`, `e`, `d = -up` from `parseFloat` of the 12 fields                                                                     | `waypoints.ts` `toNed`                                         | identical                                                                                                                            |
| `dt = 1/400`, `T = 1000`, `n_steps = floor(T/dt)`                                                                                     | `simulate.ts` `DT`, `MAX_TIME`                                 | identical                                                                                                                            |
| `wp_start`: `set_initial_position`, `wp_and_spline_init_m`, destination 2, next 3, `add_curve(0)`                                     | `simulateMission`                                              | identical                                                                                                                            |
| `wp_run` loop: advance, `t += dt`, log pos/vel/accel, waypoint switching 2→3→4, break at 4, `add_curve(t)`                            | `simulateMission`                                              | identical (oracle: target path, legs, sample count)                                                                                  |
| `mission_leg_track`                                                                                                                   | not ported                                                     | identical (computed upstream but never used)                                                                                         |
| Jerk: first sample `[0,0,0]`, then backward difference `/dt`                                                                          | `simulate.ts` `differentiate`                                  | identical                                                                                                                            |
| `vectorLength` magnitudes for vel/accel/jerk colouring                                                                                | `simulate.ts` `magnitude`, `path3d.ts` `colourValues`          | identical (oracle, all three)                                                                                                        |
| `add_curve`: `get_current_1D_curve(dt)` + `array_offset(time, start)`                                                                 | `simulate.ts` `recordCurve`, `wpnav-engine.ts` `curveFrom`     | identical (oracle, every key of every leg)                                                                                           |
| `get_range`: min/max over waypoint x/y/z ± `WP_RADIUS_M`; x range reversed                                                            | `path3d.ts` `axisRange`, `traces.ts` `pathLayout`              | identical (oracle)                                                                                                                   |
| `generate_plotly_sphere(center, r, 100)` incl. float-accumulated loops and index pattern                                              | `path3d.ts` `sphereMesh`                                       | identical (oracle, all four spheres, x/y/z/i/j/k)                                                                                    |
| Mesh options `opacity 0.3`, `rgba(255, 0, 0, 0.5)`, `flatshading`, `hoverinfo: 'none'`                                                | `traces.ts` `radiusTraces`                                     | identical                                                                                                                            |
| Field parsing `parseFloat(input.value)`; an empty/invalid number field reads `''` → `NaN` and is simulated                            | `analysis/input.ts` `parseNumberInput`, `ui/NumberField.tsx`   | **reverted-in-this-audit** (port discarded non-finite text and kept the previous value, so a different value reached the simulation) |
| Field defaults (19 parameters, 12 waypoint coordinates)                                                                               | `params.ts` `DEFAULT_PARAMS`, `waypoints.ts` `DEFAULT_MISSION` | identical (test reads `index.html`)                                                                                                  |
| Waypoint field `min`/`max`/`step` (−300/300/10, Up 0/300/10); not clamped                                                             | `waypoints.ts` `AXIS_INPUT`, `WaypointTable.tsx`               | identical (test reads `index.html`)                                                                                                  |
| `ATC_RATE_FF_ENAB` becomes a select of `params.json` Values (0, 1); the four `data-paramValues="false"` ATC limits stay number fields | `params.ts` (`enum` vs `number`), `ParamRail.tsx`              | identical (test applies `layout_for_param`'s rule to `params.json`)                                                                  |
| Colour checkboxes + `update_wp_colours`: at most one ticked, any can be unticked; `replot` priority jerk > accel > vel > plain        | `path3d.ts` `COLOUR_BY_OPTIONS`, radio chips                   | identical (test explores every state reachable by clicking upstream's checkboxes: exactly none/vel/accel/jerk)                       |
| `display_wp_radius` (default off), `display_wp_vel` (default on)                                                                      | `App.tsx` state defaults                                       | identical                                                                                                                            |
| Every change reruns `replot` via `loading_call`                                                                                       | `App.tsx` `update` / `useLoading().run`                        | identical (colour/radius toggles only re-render; the simulation is deterministic so the result is the same)                          |

### Presentation and UI

| Upstream item                                                                                                             | Port location                                                      | Status                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Page layout: fieldsets of waypoints and parameters, 3D plot, display options, five 1D plots                               | `App.tsx`, `ParamRail.tsx`, `WaypointTable.tsx`                    | presentation                                                                                                          |
| Parameter label (name), units text, `Description` as title                                                                | `ParamRail.tsx`                                                    | presentation (title also shows DisplayName and the `params.json` range/increment; descriptions verbatim, see below)   |
| Select option text `0:Disabled` / `1:Enabled`                                                                             | radio chips `Disabled` / `Enabled`                                 | presentation                                                                                                          |
| Number field spinner step (upstream default 1 for parameters)                                                             | `step` = metadata increment                                        | presentation (only the arrow increment; typed values are taken as is)                                                 |
| Tooltips (`tippy`) on fieldsets/positions                                                                                 | section help, waypoint help column                                 | presentation (wording edited; Position 3/4 help reworded)                                                             |
| WP trace hover `WP: %{meta}<br> %{x:.0f} m…` with `meta: [1,2,3,4]`                                                       | `traces.ts` `waypointTrace` uses per-point `text` and N/E/U labels | presentation (same coordinates; upstream shows the whole meta array, see bugs)                                        |
| Target hover `N = %{y}` / `E = %{x}`                                                                                      | `traces.ts` `targetTrace` labels N = x, E = y                      | presentation (label text only; the plotted values are identical)                                                      |
| Target hover when not colouring: upstream keeps the `Vel = %{line.color}` line with a string colour                       | port omits that line                                               | presentation                                                                                                          |
| Plain path colour `rgba(0, 0, 0, 1)`                                                                                      | theme colour `defaultColor(1)`                                     | presentation (black is invisible on the dark theme)                                                                   |
| Trace colours, marker size, 3D margins                                                                                    | `traces.ts`                                                        | presentation                                                                                                          |
| `line.colorbar.title` as a string                                                                                         | `{ text: title }`                                                  | browser-forced (Plotly 3 no longer accepts a string title)                                                            |
| Colour scale bar: upstream never sets `line.showscale`, which defaults to false for `scatter3d` lines, so no bar is shown | port sets `showscale: true`                                        | convenience (draws the scale for the values already used for the colour; see bugs)                                    |
| `Plotly.newPlot` on every update resets the 3D camera and 1D zoom                                                         | `uirevision` keeps the camera                                      | convenience                                                                                                           |
| `link_plot_axis_range` / `link_plot_reset` across the five 1D plots                                                       | `packages/plot` `linkAxisRanges` / `linkAutorangeReset`            | identical (uses `Plotly.relayout` instead of mutating the layout and `redraw`)                                        |
| Commit on the field's `change` event                                                                                      | commit on blur or Enter (`NumberField`)                            | convenience (spinner clicks commit when the field is left rather than on each click; the value committed is the same) |
| —                                                                                                                         | "Reset to defaults" button                                         | convenience (sets the upstream defaults)                                                                              |
| —                                                                                                                         | Mission duration in the 3D section help                            | convenience (last sample time, already computed and plotted)                                                          |
| —                                                                                                                         | Note when position 4 is not reached within 1000 s                  | convenience (upstream silently stops at the same cut-off; the port shows that the plotted path is truncated)          |
| `window.onerror` alert "Sorry, something went wrong…" on a wasm or simulation exception                                   | `ErrorBanner`                                                      | crash rule: an error is shown instead, no new result is plotted (the previous plots stay, as upstream)                |
| Wasm load failure (unhandled rejection → alert)                                                                           | `ErrorBanner` "Could not load the WPNav WebAssembly module…"       | crash rule                                                                                                            |

## Remaining intentional differences

All are presentation or convenience; none changes a computed number, parsed value or decision.

- **Hover labels**: the target hover labels north as N and east as E (upstream swaps them); the
  waypoint hover shows its own index rather than the whole `meta` array. Values are the same.
- **Colour scale bar shown.** Upstream configures a colorbar but never displays it (see bugs);
  the port shows it. The colours themselves are computed identically.
- **Path colour with no colouring** follows the theme instead of black.
- **Camera and zoom kept** across updates (`uirevision`).
- **Commit on blur/Enter** instead of each spinner click.
- **Added conveniences**: reset button, mission duration, and the 1000 s truncation note. The
  duration and the `completed` flag come from the same simulation output upstream plots.
- **Tooltip wording**, section help, parameter range hints and the spinner step.
- **Errors** shown in-page instead of the generic `window.onerror` alert (crash rule).

## Reverted in this audit

1. **Non-finite field text.** The port's `NumberField` discarded text that was not a finite
   number and restored the previous value. Upstream passes `parseFloat(input.value)`, so an
   emptied field reaches `AC_WPNav` as `NaN`. The port now commits `parseFloat` of the field
   (`src/analysis/input.ts`). Oracle test: `simulate.test.ts` "passes an emptied field on as NaN"
   (a NaN waypoint coordinate and a NaN `WP_ACC_CNR`, compared sample for sample).
2. **Parameter descriptions** were shortened (dropped "Previously _POSXY_P." etc. and double
   spaces). Restored verbatim from `params.json`; test `upstream-inputs.test.ts`.

## Coverage added

- `src/analysis/upstream-inputs.test.ts`: defaults of all 31 fields and waypoint limits read from
  upstream `index.html`; DisplayName, Description, Units, picker-vs-number and Values checked
  against `params.json` with upstream's `recursive_search` and `data-paramValues` rule;
  `parseNumberInput` equals `parseFloat`; every colour state reachable through upstream's
  `update_wp_colours` maps one-to-one onto the four colour options.
- `src/analysis/simulate.test.ts`: NaN inputs; the 1000 s cut-off (0.1 m/s speeds, 400 000
  samples, same legs) compared with upstream.
- Harness: `clickUpstreamColour` drives upstream's `update_wp_colours` on the stub DOM.

Already covered before this audit: target path, sample count, velocity/acceleration/jerk colour
values, 1D curves of every leg, axis ranges and spheres for two missions.

## Upstream bugs reproduced

| Location                                        | Reproduction                                  | Effect                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCurveTool.js` `replot`, 1000 s limit          | Set `WP_SPD`, `WP_SPD_UP`, `WP_SPD_DN` to 0.1 | The mission silently stops after 1000 s; the path ends before position 4 with no message. The port computes the same truncated path (it adds a note).            |
| `SCurveTool.js` `replot`, field parsing         | Empty any number field                        | `NaN` is passed to `AC_WPNav`; the path and S-curves become `NaN` or degenerate. Reproduced.                                                                     |
| `SCurveTool.js` `reset_wp_plot_data`            | Hover the Target line                         | Labels swapped: `N = %{y}`, `E = %{x}` (x is north). Label text only; the port labels correctly (presentation).                                                  |
| `SCurveTool.js` `reset_wp_plot_data`            | Hover a waypoint                              | `%{meta}` with `meta: [1,2,3,4]` prints the whole array for every point. Label text only (presentation).                                                         |
| `SCurveTool.js` `reset_wp_plot_data` / `replot` | Colour by velocity                            | `line.showscale` is never set and defaults to false for `scatter3d` lines, so the configured colorbar and its title never appear. No computed value is affected. |

None of these changes a number the port computes differently, so no maths bug needed a deliberate
divergence.

## UI audit

Checked with `scripts/ui-audit.mjs` at 1440, 1024 and 390 px in dark and light: the default view,
waypoint-radius spheres, and colour by velocity, acceleration, jerk and none. Every upstream
control is present (four waypoints, the three parameter groups, the radius and colour options) and
every field has an accessible name; number fields commit on Enter or blur. No console errors,
overflow or clipped text in any capture.

Changed (presentation only):

- 3D path: the colour bar is horizontal under the scene and thinner, and the legend is a row
  above it, so the cube keeps the card width (on phones the vertical bar took half of it). The
  scene gets its own domain between them, and the default camera keeps Plotly's view direction
  from further out (eye 1.5, or 2 at phone width) so the cube's corners and tick labels are not
  cut off. The camera is still kept across recomputes; crossing phone width resets it.
- 1D S-curves: legend in a row above each plot.
- Waypoint table: the waypoint description wraps, and on phones the cells and inputs are narrower,
  so North, East and Up stay in view without scrolling the table sideways. The 3D plot is 500 px
  tall on phones.

Remaining: when the path is coloured, Plotly draws the "Target" legend swatch black (it cannot
show a colour scale in a legend), which is hard to see in the dark theme; the colour bar identifies
the line.
