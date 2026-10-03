# Porting policy

This repository is a port of the [ArduPilot WebTools](https://github.com/ArduPilot/WebTools), and
only of them. Every tool's logic must match the original exactly.

## Rules

1. **Same logic, same results.** For the same inputs, a ported tool computes the same values, picks
   the same defaults, accepts and rejects the same inputs, and writes the same files as the original.
   Oracle tests that run the upstream JavaScript side by side are the proof.
2. **Only WebTools code.** Logic comes from `upstream/` (including the libraries and modules it ships).
   No logic is taken from other projects. Third-party libraries the original uses (Plotly, Leaflet,
   fft.js, ml-matrix, Ruckig, ...) are used through their npm packages at compatible versions.
3. **No added features.** Do not add analysis, options, outputs or checks the original does not have.
4. **No removed features.** Every option, output and piece of information the original offers is
   available in the port.
5. **Upstream bugs are reproduced, not fixed.** If the original computes something wrong, the port
   computes the same thing and the bug is recorded in [`upstream-bugs.md`](upstream-bugs.md) with a
   reproduction. Fixes can be proposed upstream and adopted here later, deliberately.

## What may differ

- **Presentation.** Layout, styling, wording, theming and component choice (the CustomBuild look,
  chips instead of radio buttons, a rail instead of a table of fieldsets). The same information and
  options must remain.
- **Browser constraints.** Where the original's approach no longer works in current browsers, the
  minimum change that restores the same behaviour (e.g. https map tiles instead of http). `alert()`
  and `confirm()` become in-page messages carrying the same text and the same choices.
- **Crashes.** Where the original throws and the page stops working, the port may show an error
  instead, provided the outcome for the user is otherwise the same (no result is produced).

Every intentional difference is listed, with its reason, in the tool's file under `docs/audit/`.
