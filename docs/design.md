# Design

**Subject:** ArduPilot flight-log analysis and tuning tools. **Audience:** pilots and tuning
engineers reading dense plots. **Primary job:** load a log, pick what to analyse, read the plots.

## Concept: the test bench

The plots are the instruments; everything else is the bench they sit on and should recede.

```
┌ header ─ [mark] PID Review ───────────────────────────── [Open in] [theme] ┐
├ log strip ─ file: copter.bin   vehicle: Copter   duration: 74 s   ...       ┤
├ rail (sticky) ─┬ main ──────────────────────────────────────────────────────┤
│ FFT settings   │ Flight data                                                │
│ Analysis time  │ [plot ───────────────────────────────────────────────]     │
│ Axis           │ Time domain                                                │
│ [Calculate]    │ [plot] [plot]                                              │
└────────────────┴────────────────────────────────────────────────────────────┘
```

Below 900 px the rail stacks above the content. Plots fill the column width.

## Tokens

| Token       | Light     | Dark      | Use                                   |
| ----------- | --------- | --------- | ------------------------------------- |
| `--bg`      | `#EEF1F4` | `#11161C` | page, the "bench"                     |
| `--surface` | `#FFFFFF` | `#192029` | main column, rail                     |
| `--ink`     | `#18212B` | `#E3E8ED` | text                                  |
| `--muted`   | `#5A6675` | `#93A0AE` | secondary text, axis titles           |
| `--rule`    | `#D5DBE2` | `#2B343F` | hairlines between sections            |
| `--amber`   | `#C98A0B` | `#F0B64A` | active, selected, analysis range only |

Plot traces keep Plotly's default categorical colours so users of the original tools read them the
same way; plot backgrounds are transparent and grids use `--rule`.

## Type

Barlow for everything, Barlow Semi Condensed for the tool name and section titles. Numerals are
tabular everywhere so changing values do not jitter. Sentence case throughout, no all-caps labels.

## Principles

1. Amber means "this is active" and nothing else: selected axis, focused input, analysis range.
2. Everything is left aligned. Help text is a disclosure under the section title, not a hover-only icon.
3. Empty states say what to do next ("Open a .bin log with RATE or PID messages").
4. One memorable element: the log strip, which turns from a drop target into a summary of the log.
