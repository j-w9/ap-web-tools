# AP Web Tools (TypeScript port)

A clean, modular TypeScript rewrite of the [ArduPilot WebTools](https://github.com/ArduPilot/WebTools):
browser-based tools for ArduPilot log review, tuning and vehicle setup.

The original tools are vendored unmodified as the `upstream/` submodule and serve as the behavioural
reference for every port. Nothing in `upstream/` is imported at runtime.

## Layout

npm-workspaces monorepo. Shared logic lives in framework-free packages; each tool is a small app on top.

| Workspace             | Responsibility                                                                          |
| --------------------- | --------------------------------------------------------------------------------------- |
| `packages/dataflash`  | ArduPilot DataFlash (`.bin`) log parser: lazy, instance-aware, typed columns            |
| `packages/ardupilot`  | ArduPilot domain helpers: parameter files, device ids, firmware version, board ids      |
| `packages/signal`     | Array and complex maths, FFT windowing and spectrum helpers                             |
| `packages/filters`    | Digital filter and rate controller models with frequency responses, phase unwrap/wrap   |
| `packages/plot`       | Typed Plotly wrapper that follows the page theme, axis linking                          |
| `packages/tool-shell` | Shared page frame in the CustomBuild style, controls, tool registry, "Open in" hand-off |
| `apps/<tool>`         | One Vite entry per tool, served at `apps/<tool>/`                                       |
| `site/`               | Landing page, generated from the tool registry                                          |

See `docs/architecture.md`, `docs/typescript-standard.md` and `docs/design.md`.

## Porting status

All twenty tools are ported. The port keeps the original maths and improves the code: see
[`docs/porting-policy.md`](docs/porting-policy.md).

- **Logic audit:** every tool and shared package is checked against the original JavaScript by
  oracle tests that run the upstream code side by side. Audit records are in [`docs/audit/`](docs/audit).
- **UI audit:** every tool is captured at desktop, tablet and phone widths in both themes with
  `node scripts/ui-audit.mjs` and reviewed.
- **Upstream bugs:** every bug found in the original is listed in
  [`docs/upstream-bugs.md`](docs/upstream-bugs.md). A bug is fixed only when proven, with a
  reproduction that runs the original code (in `proofs/`) and a hard reference; verdicts are in
  [`docs/bug-proofs/`](docs/bug-proofs). Bugs that are not proven are reproduced exactly.

## Development

```bash
git clone --recurse-submodules --shallow-submodules https://github.com/j-w9/ap-web-tools.git
npm install
npm run dev        # all tools, hot reload
npm run typecheck
npm test
npm run build
```

To compare every log-reading tool with upstream on your own logs, point `APWT_REAL_LOGS` at a folder
of DataFlash `.bin` files. Nothing from the logs is stored; without the variable these tests skip.

```bash
APWT_REAL_LOGS=~/logs npm run test:real-logs
```

## License

GPL-3.0-only, the same as upstream WebTools from which this work derives.
