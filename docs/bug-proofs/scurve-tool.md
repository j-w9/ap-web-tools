# S-Curve Tool: bug proofs

Reproductions: `proofs/scurve-tool/scurve-tool.test.ts`. The harness `proofs/scurve-tool/_harness.ts`
runs the original `SCurveTool/SCurveTool.js` with `Libraries/Array_Math.js` and the original
Emscripten build (`SCurveTool/ardupilot/wpnav.js`, `wpnav.wasm`) in `node:vm`, with a stub DOM and
Plotly, and returns what `replot()` hands to Plotly. Paths below are relative to `upstream/`;
firmware paths are relative to `upstream/modules/ardupilot/` (f3836cf).

| #   | Row                                                    | Verdict       |
| --- | ------------------------------------------------------ | ------------- |
| 1   | Mission silently truncated at 1000 s of simulated time | NOT PROVEN    |
| 2   | Empty number field simulated as NaN                    | NOT PROVEN    |
| 3   | Target hover labels N and E swapped                    | PROVEN, FIXED |
| 4   | Waypoint hover prints the whole meta array             | NOT PROVEN    |
| 5   | Path colorbar never displayed                          | NOT PROVEN    |

Rows 4 and 5 depend on how Plotly renders a template or a default. The original loads
`../modules/plotly.js/dist/plotly.min.js` (`SCurveTool/index.html:16`) from the `modules/plotly.js`
submodule (`.gitmodules`), pinned at `d9308bd2` but not checked out in this repository
(`git submodule status` lists it with a leading `-`). That Plotly cannot be run or quoted locally, so
anything that turns on its behaviour cannot be shown with certainty.

## 1. Mission silently truncated at 1000 s of simulated time

Row: `SCurveTool/SCurveTool.js` `replot` (`T = 1000`): with slow speeds (e.g. `WP_SPD`, `WP_SPD_UP`
and `WP_SPD_DN` all 0.1) the path stops before position 4 with no message.

**Verdict: NOT PROVEN.**

Test: `row 13: with WP_SPD, WP_SPD_UP and WP_SPD_DN at 0.1 the path stops at 1000 s, short of
position 4`. The target path has exactly `Math.floor(1000 / dt)` = 400000 samples, and its last
point is more than 100 m from position 4. The control test (page defaults) ends within 1 m of
position 4 well before 1000 s.

Evidence: `SCurveTool/SCurveTool.js:367-368` `const T = 1000;` / `const n_steps = Math.floor(T/dt);`
and the loop `:376` ends either there or at `:391-393` (`if (wp_index == 4) { // Reached the end of
the "mission" break; }`). 0.1 m/s is a valid firmware value (`libraries/AC_WPNav/AC_WPNav.cpp:53`
`// @Range: 0.10 20.00` for `SPD`), so the input is legitimate. But the cap is an explicit constant,
and nothing in the original (code, help or Readme) says the plot must always reach position 4 or
that hitting the cap should be reported. A deliberate simulation bound is a reasonable reading, so
the truncation stays reproduced.

## 2. Empty number field simulated as NaN

Row: `replot` (`parseFloat(input.value)`): an emptied field passes NaN to AC_WPNav, so the path and
S-curves become NaN or degenerate.

**Verdict: NOT PROVEN.**

Tests: `row 14: an empty first waypoint North is passed as NaN and the start of the target path is
NaN` (the waypoint trace's first x is `NaN`; the target path has 30072 samples, the first 19842
`NaN`) and `row 14: an empty WP_SPD is not NaN in the path; the target crawls and is cut at 1000 s
before wp 2` (400000 samples, none `NaN`, one S-curve leg).

Evidence: `SCurveTool/SCurveTool.js:297-319` and `:325-353` parse every box with `parseFloat`. The
inputs carry no `required` and the original says nothing about empty boxes; an empty box is not a
value, and no reference here defines what the plot should be then.

Description note: "the path and S-curves become NaN" is not true for every field. An empty `WP_SPD`
gives a finite path (the wasm does not propagate the NaN into the target), which then runs into the
1000 s cap of row 1.

## 3. Target hover labels N and E swapped

Row: `reset_wp_plot_data` / `replot` hovertemplates show `N = %{y}`, `E = %{x}` although x is north.

**Verdict: PROVEN** (it contradicts itself; label text only).

Test: `row 15: x is north and y is east, but the Target hover labels %{y} as N and %{x} as E`. The
scene axis titles are `North (m)`, `East (m)`, `Up (m)`; the waypoint trace has `x = [0, 300, 70,
100]` (the `*_wp_x` North boxes) and `y = [0, 300, 35, 250]`; the target hovertemplate is
`<extra></extra>N = %{y:.0f} m<br>E = %{x:.0f} m<br>U = %{z:.0f} m<br>Vel = %{line.color:.2f} m/s`.

Evidence:

- `SCurveTool/SCurveTool.js:62-63`: `xaxis: { title: {text: "North (m)" }, ...` /
  `yaxis: { title: {text: "East (m)"}, ...`
- `SCurveTool/SCurveTool.js:298-299`: `n: parseFloat(document.getElementById("first_wp_x").value),` /
  `e: parseFloat(document.getElementById("first_wp_y").value),`
- `SCurveTool/SCurveTool.js:424-425` and `:428-429`: `wp_pos_plot.data[0].x = [ point1.n, ...]`,
  `wp_pos_plot.data[1].x = pos_targ.map(v => v[0]);` / `.y = pos_targ.map(v => v[1]);`
- `SCurveTool/SCurveTool.js:35`, `:438`, `:442`, `:446`: `"<extra></extra>N = %{y:.0f} m<br>E = %{x:.0f} m<br>..."`

The same code names x North and y East, puts north in x, and labels the y value "N".

Minimal correct behaviour: the target hover shows the north value (x) as N and the east value (y) as
E.

Smallest port change: none; the port already labels them correctly (recorded as presentation).
Only the classification changes to a proven fix.

Status: FIXED. Port: `apps/scurve-tool/src/ui/traces.ts` `targetTrace`
(`N = %{x:.0f} m<br>E = %{y:.0f} m`). Test: `target hover labels` › `upstream swaps N and E; the
port labels x as N and y as E` (`apps/scurve-tool/src/ui/traces.test.ts`). No code change was
needed.

## 4. Waypoint hover prints the whole meta array

Row: `reset_wp_plot_data` (`meta: [1,2,3,4]`, `%{meta}`): every waypoint shows the full array.

**Verdict: NOT PROVEN.**

Test: `row 16: the waypoint trace has a four-entry trace-level meta and a bare %{meta} token`
(`meta` is `[1, 2, 3, 4]`, the hovertemplate is
`<extra></extra>WP: %{meta}<br> %{x:.0f} m<br>%{y:.0f} m<br>%{z:.0f} m`).

Evidence: `SCurveTool/SCurveTool.js:23` and `:26`. The intent (one index per waypoint) is plain,
but what a bare `%{meta}` renders to is Plotly's behaviour, in the pinned Plotly that is not
available locally (see above). The original's own code does not produce the hover text, so the
reproduction cannot show the output.

## 5. Path colorbar never displayed

Row: `reset_wp_plot_data` / `replot`: `line.showscale` is never set and Plotly defaults it to false
for scatter3d lines, so the colorbar and its title never appear.

**Verdict: NOT PROVEN.**

Test: `row 17: a coloured path sets a colorbar title but never line.showscale` (with "colour by
velocity" the line has `colorbar.title` `Vel Magnitude` and no `showscale` key; with no colour box
ticked `showscale` is `false`).

Evidence: `SCurveTool/SCurveTool.js:36-45` (the line's `colorbar: { title: "", len: 0.75,
thickness: 40 }`), `:437`, `:441`, `:445` (colorbar titles), `:447-449`
(`line.showscale = false` only in the uncoloured case). The original plainly expects a colorbar
when the path is coloured, but whether it appears depends on the default of `line.showscale` in
the pinned Plotly, which cannot be checked locally.
