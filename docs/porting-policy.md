# Porting policy

This repository is a port of the [ArduPilot WebTools](https://github.com/ArduPilot/WebTools), and
only of them. The maths stays the same; the code gets better.

## The maths must not change

For the same inputs, a ported tool produces the same numbers, parsed values, decisions (defaults,
which data is used, what is accepted or rejected) and output files as the original. Oracle tests that
run the upstream JavaScript side by side are the proof.

## Upstream bugs: fixed only when proven

Every bug found in the original is recorded in [`upstream-bugs.md`](upstream-bugs.md). A bug is fixed
in the port only when it is **proven** to the standard in [`bug-proofs/README.md`](bug-proofs/README.md):
a reproduction that runs the original code (in `proofs/`) plus a hard reference showing the result is
wrong (the original fails, contradicts itself, contradicts ArduPilot's source at the pinned commit, or
contradicts a specification it implements). Each fix changes only the proven case: tests show the
original's result, the corrected result, and identical results everywhere else. Bugs that are not
proven stay reproduced exactly. Verdicts and fix status are in `docs/bug-proofs/<tool>.md`.

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

## Deliberate decisions

Changes made by explicit decision rather than proof, recorded here with a test that pins the original
behaviour.

| Tool        | Upstream bug                                                                                                                                                                                                                                                                                                                         | Port behaviour                                                                     | Decided    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ---------- |
| DFU Loader  | Flash Bootloader stays enabled during a flash; a second press starts a second download whose USB transfers interleave with the first (reproduced in `proofs/dfu-loader`: two erases, both data streams sent). That this corrupts the write is not proven from local sources, so this is a safety precaution rather than a proven fix | Presses are ignored while a flash runs and the button shows as disabled            | 2026-10-03 |
| Filter Tool | `index.html` never loads `Libraries/Param_Helpers.js`, so Save Parameters throws `param_to_string is not defined` and saves nothing                                                                                                                                                                                                  | Saves the file `save_parameters` builds, formatted by upstream's `param_to_string` | 2026-10-03 |

Every difference that is not purely code structure is listed, with its reason, in the tool's file
under `docs/audit/`.
