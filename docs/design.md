# Design

The tools share the look of ArduPilot CustomBuild (custom.ardupilot.org,
https://github.com/ArduPilot/CustomBuild) so the two sites read as one family. The tokens in
`packages/tool-shell/src/tool.css` mirror CustomBuild's `frontend/src/index.css`.

## Look

- Dark first: near-black surfaces `--s` to `--s4`, greys `--g100` to `--g700`, stored as `r g b`
  so alpha can be applied (`rgb(var(--s4) / 0.5)`). Light mode is `html.light`; the header and
  footer stay dark in light mode.
- One accent: CustomBuild yellow `#FACC15` (`--yellow`, with `--yellow-text` for text that must
  stay readable on light backgrounds). Use it for primary actions, selected chips, focus rings.
- Type: Space Grotesk for text, JetBrains Mono for small labels, inputs, badges and table data.
  Both are bundled (`@fontsource`) so the tools work offline.
- A faint yellow 40 px grid and a soft yellow glow at the top of the page.

## Page anatomy (`ToolPage`)

```
header   logo · All tools · ardupilot.org · GitHub · Help · [Open in] · [theme]
hero     Tool <gradient>Name</gradient>, one or two sentences of intro
layout   rail (sticky card, 320 px)        | main column of Section cards
         LogInput (drop zone, then facts)  | Section: title, help, tools (chips), body
         ControlGroup per setting          | plots fill the card width
         primary action button             |
footer   name · Original tools · Donate · GPL-3.0
```

Below 1000 px the rail stacks above the results.

## Components (from `@apwt/tool-shell`)

| Component                                       | Use                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ToolPage`                                      | Page frame. Pass `rail` for tools with settings.                                      |
| `Section`                                       | A titled result card. `help` is one plain sentence; `tools` holds chips acting on it. |
| `RailCard`, `ControlGroup`                      | The rail container and a labelled group of controls in it.                            |
| `LogInput`                                      | Log drop zone that becomes a list of facts about the loaded log.                      |
| `Chip`, `RadioChips`, `CheckChips`, `ChipLabel` | All option pickers. No bare radio buttons or checkboxes.                              |
| `ErrorBanner`                                   | Inline error with a clear message of what went wrong and what to do.                  |
| `OpenInButton`                                  | Header action handing the log to another tool.                                        |
| `useLoading().run(work, label)`                 | Busy overlay with a shimmer bar around heavy work.                                    |

Inputs inside `.apwt-field` labels get the mono input style automatically. Tables use
`.apwt-table` inside `.apwt-table-wrap`. Plots are `PlotlyChart` with `className="apwt-plot"`.

## Writing

Sentence case, plain verbs, no all-caps except the mono rail labels the shell renders. Empty
states say what to do next. Errors say what happened and how to fix it.
