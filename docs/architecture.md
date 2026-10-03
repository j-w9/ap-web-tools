# Architecture

## Principles

1. **Analysis is pure.** Every computation a tool does (parsing, FFTs, fits, step responses) lives
   in a framework-free module that takes typed arrays in and returns typed data out. It has unit
   tests, usually with the upstream JavaScript as the oracle, and never touches the DOM.
2. **UI is thin.** React components render state and raise events. They do not compute.
   Plot traces are built by small `build*Traces()` functions from analysis results.
3. **Shared code lives in packages.** If two tools need it, it goes in `packages/`. Tool apps only
   contain what is specific to that tool.
4. **Behaviour parity with upstream first.** Port the maths exactly, note any deliberate deviation
   in a comment, then improve. `upstream/` is the reference, never a runtime dependency.

## Packages

| Package            | Depends on               | Contents                                                                                   |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------ |
| `@apwt/signal`     | `fft.js`                 | complex and array math, windows, batch FFT, amplitude/frequency scaling                    |
| `@apwt/filters`    | `@apwt/signal`           | filter and controller models (low-pass, notch, harmonic notch, PID), chains, phase unwrap  |
| `@apwt/dataflash`  | –                        | DataFlash `.bin` parser: lazy, columnar typed arrays, per-instance access, params, modes   |
| `@apwt/ardupilot`  | `@apwt/dataflash`        | param names/values/files, device ids, firmware version and board, board id table           |
| `@apwt/plot`       | `plotly.js`, react       | `PlotlyChart` component, axis-range linking, default colours                               |
| `@apwt/tool-shell` | `@apwt/dataflash`, react | page chrome, loading overlay, error reporter, file input and downloads, "Open in" hand-off |

## Apps

One directory per tool under `apps/`, each with `index.html`, `src/main.tsx`, `src/App.tsx`,
`src/analysis/` (pure) and `src/ui/` (components). Vite discovers every `apps/*/index.html`
automatically (see `vite.config.ts`), so adding a tool needs no build configuration.

Upstream tool names map to kebab-case app names: `PIDReview` → `pid-review`, `FilterReview` →
`filter-review`, and so on. The "Open in" destinations in `tool-shell` use these paths.

## Conventions

- TypeScript strict plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- camelCase everywhere; upstream snake_case names appear only in comments pointing at the source.
- Columns are typed arrays (`Float64Array` etc.), never `number[]`, unless Plotly needs an array.
- Tests sit next to the code as `*.test.ts` and run with `npm test`.
