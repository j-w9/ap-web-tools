# Porting policy

This repository is a port of the [ArduPilot WebTools](https://github.com/ArduPilot/WebTools), and
only of them. The maths stays the same; the code gets better.

## The maths must not change

For the same inputs, a ported tool produces the same numbers, parsed values, decisions (defaults,
which data is used, what is accepted or rejected) and output files as the original. This includes
the original's maths bugs: they are reproduced and recorded in [`upstream-bugs.md`](upstream-bugs.md)
with a reproduction, so a fix can be made deliberately later. Oracle tests that run the upstream
JavaScript side by side are the proof.

## The code should improve

Nothing about the original's code structure has to survive. Rewrite freely: typed domain models,
pure functions, smaller modules, clear names, removal of globals and DOM coupling, better error
handling. See [`typescript-standard.md`](typescript-standard.md).

## Scope

- **Only WebTools logic.** Logic comes from `upstream/` (including the libraries and modules it
  ships). Nothing is taken from other projects. Third-party libraries the original uses (Plotly,
  Leaflet, fft.js, ml-matrix, Ruckig, ...) are used through their npm packages.
- **No new analysis.** Do not add computations, outputs or checks that produce results the original
  does not.
- **Nothing removed.** Every option, output and piece of information the original offers remains.
- **Presentation and convenience are free.** Layout, styling, wording, theming, components, and
  conveniences that do not change any computed result (filtering or sorting a table, a Stop button,
  showing a value the original only logged to the console) may differ or be added.
- **Browser constraints and crashes.** Where the original's approach no longer works in current
  browsers, make the minimum change that restores it. Where the original throws and stops, the port
  may show an error instead. `alert()`/`confirm()` become in-page messages with the same text and
  choices.

## Deliberate fixes

An upstream bug is fixed in the port only by an explicit decision, recorded here and in
[`upstream-bugs.md`](upstream-bugs.md), with a test that pins the original behaviour.

| Tool        | Upstream bug                                                                                                                        | Port behaviour                                                                     | Decided    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------- |
| Filter Tool | `index.html` never loads `Libraries/Param_Helpers.js`, so Save Parameters throws `param_to_string is not defined` and saves nothing | Saves the file `save_parameters` builds, formatted by upstream's `param_to_string` | 2026-10-03 |

Every difference that is not purely code structure is listed, with its reason, in the tool's file
under `docs/audit/`.
