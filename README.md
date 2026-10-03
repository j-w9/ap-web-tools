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

The port keeps the original maths and changes the code: see [`docs/porting-policy.md`](docs/porting-policy.md).
Each ported tool is checked against the original JavaScript in oracle tests that run the upstream
code side by side, and has an audit record in [`docs/audit/`](docs/audit). Bugs found in the
original are reproduced and listed in [`docs/upstream-bugs.md`](docs/upstream-bugs.md).

| Tool                                                                                                                                                                                                  | Status                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| PID Review, MAGFit, Hardware Report, Log Finder, Filter Tool, Filter Review, Stream Stats, Rotation Check, Thrust Expo, Airspeed Fit, Kinematic Tool, S-Curve Tool, Geofence Generator, Analytic Tune | Ported and audited        |
| DFU Loader, AI Log Analyzer, Simple GCS, Telemetry Dashboard, Video Overlay                                                                                                                           | Ported, audit in progress |
| SysID                                                                                                                                                                                                 | In progress               |

## Development

```bash
git clone --recurse-submodules --shallow-submodules https://github.com/j-w9/ap-web-tools.git
npm install
npm run dev        # all tools, hot reload
npm run typecheck
npm test
npm run build
```

## License

GPL-3.0-only, the same as upstream WebTools from which this work derives.
