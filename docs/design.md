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
- Contrast is measured, not guessed: every text token meets WCAG AA (4.5:1) on every surface it
  sits on, in both themes. `--g500` (muted text) is therefore lighter than Tailwind gray-500 in dark
  mode (`134 141 154`, 4.8:1 on `--s3`) and darker than slate-500 in light mode (`93 108 131`,
  4.9:1 on `--s`). Form-field borders (`--field-border`) and the focus ring (`--focus-ring`, a
  deeper amber in light mode) meet the 3:1 non-text minimum.
- Reduced motion turns off transitions and the loading shimmer (the bar stays visible, static).

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

A rail shorter than the viewport sticks below the header; a taller one scrolls with the page until
its bottom is in view, then sticks there, so no control is hidden in a scroll box. Several
`RailCard`s in one rail are spaced 16 px apart. Below 1000 px the rail stacks above the results and the nav links move behind a menu button
(CustomBuild's mobile header): logo · [actions] · [theme] · [menu]. Below 560 px header actions
become icon buttons (their text stays for screen readers), cards and the rail use 16 px padding,
and plot height follows the width (`apwt-plot` 80vw, `apwt-plot--short` 62vw, within 260 to 420 px
and 220 to 320 px). The landing page uses the
same `SiteHeader` and `SiteFooter`.

## Components (from `@apwt/tool-shell`)

| Component                                         | Use                                                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ToolPage`                                        | Page frame. Pass `rail` for tools with settings.                                                                                     |
| `Section`                                         | A titled result card. `help` is one plain sentence; `tools` holds chips acting on it.                                                |
| `RailCard`, `ControlGroup`                        | The rail container and a labelled group of controls in it.                                                                           |
| `ControlGroup collapsible summary defaultOpen`    | A foldable group (native `<details>`); `summary` shows its state, e.g. "On · Throttle".                                              |
| `LogInput`                                        | Log drop zone that becomes a list of facts about the loaded log.                                                                     |
| `Chip`, `RadioChips`, `CheckChips`, `ChipLabel`   | All option pickers. No bare radio buttons or checkboxes.                                                                             |
| `ChipGroup`, `label` on `RadioChips`/`CheckChips` | A labelled chip group in a toolbar; label and chips wrap as one unit. Inside a `ControlGroup`, chips are named by the group's label. |
| `ErrorBanner`                                     | Inline error with a clear message of what went wrong and what to do.                                                                 |
| `Notice`                                          | Tinted message box: `variant` `info` (blue), `warning` (yellow) or `success` (green).                                                |
| `OpenInButton`                                    | Header action handing the log to another tool.                                                                                       |
| `useLoading().run(work, label)`                   | Busy overlay with a shimmer bar around heavy work.                                                                                   |

Inputs inside `.apwt-field` labels get the mono input style automatically. Small explanatory text
under a control uses `.apwt-note` (`.apwt-note--warning` for a cautionary note). Tables use
`.apwt-table` inside `.apwt-table-wrap`; headings are mono but keep their case, so units such as
`µs` survive; a wide table scrolls inside its card, with edge shadows
showing there is more to either side. Plots are `PlotlyChart` with `className="apwt-plot"`.

### Notices

Use `Notice` for anything that is not an error but needs to stand out; do not add tool-local
`.xx-warning` / `.xx-alert` classes.

```tsx
<Notice variant="warning">Fewer than 10 samples in the window; the fit may be poor.</Notice>
<Notice variant="success" title="Calibration complete">Save the parameters below.</Notice>
<Notice variant="info">Open a log to start.</Notice>
```

Without a `title` the whole message takes the variant colour (like `ErrorBanner`); with one, the
title is coloured and the body stays in the normal text colour. Warnings are announced
(`role="alert"`), info and success are polite (`role="status"`); pass `role="note"` for static
text that should not be announced.

### Plots

`PlotlyChart` themes every layout from the CSS tokens and re-themes on a theme switch:
transparent backgrounds, themed fonts, grid, axis lines, hover labels, modebar and 3D scene axes,
and axes with `automargin` so tick labels and titles never overlap. When the chart is narrower
than 560 px, a legend the layout does not position itself moves horizontally to the bottom of the figure and a
layout without its own `margin` gets tight margins. Margins are capped to phone sizes rather than replaced, so a tool's own margins still apply where
they are smaller; a layout that turns `automargin` off keeps its margins. Other layout settings a
tool sets explicitly always win. For chart-specific phone changes (hiding secondary axes, say),
pass `compact={(layout) => ...}` to `PlotlyChart`; it is applied before theming while the chart is
narrow. Colorbars are trace settings, so tools place them; prefer `orientation: 'h'` on phones.

`withEmptyNote(layout, text)` centres a note on an empty plot, and `useNarrowScreen()` says whether
the screen is phone width (for layout choices made outside `PlotlyChart`, such as a 3D camera
distance). Range sliders get a transparent background and a themed border; in light mode their
masks are lightened.

## Writing

Sentence case, plain verbs, no all-caps except the mono rail labels the shell renders. Empty
states say what to do next. Errors say what happened and how to fix it.
