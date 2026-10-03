# AP Web Tools (TypeScript port)

A clean, modular TypeScript rewrite of the [ArduPilot WebTools](https://github.com/ArduPilot/WebTools):
browser-based tools for ArduPilot log review, tuning and vehicle setup.

The original tools are vendored unmodified as the `upstream/` submodule and serve as the behavioural
reference for every port. Nothing in `upstream/` is imported at runtime.

## Layout

npm-workspaces monorepo. Shared logic lives in framework-free packages; each tool is a small app on top.

| Workspace                 | Responsibility                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `packages/dataflash`      | ArduPilot DataFlash (`.bin`) log parser: lazy, instance-aware, typed columns            |
| `packages/ardupilot`      | ArduPilot domain helpers: parameter files, device ids, firmware version, board ids      |
| `packages/signal`         | Array and complex maths, FFT windowing and spectrum helpers                             |
| `packages/plot`           | Typed Plotly wrapper that follows the page theme, axis linking                          |
| `packages/tool-shell`     | Shared page frame in the CustomBuild style, controls, tool registry, "Open in" hand-off |
| `apps/<tool>`             | One Vite entry per tool, served at `apps/<tool>/`                                       |
| `site/`                   | Landing page, generated from the tool registry                                          |
| `vendor/arduconfigurator` | Submodule; its `firmware-flash` package drives the DFU Loader                           |

See `docs/architecture.md`, `docs/typescript-standard.md` and `docs/design.md`.

## Porting status

Ported tools are checked against the original JavaScript in oracle tests, which run the upstream code
and compare results exactly. Tools not yet ported link to the original site from the landing page.

| Tool                                                                                                                | Status                                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| PID Review, MAGFit, Hardware Report, Log Finder, Filter Tool, Stream Stats, DFU Loader, Rotation Check, Thrust Expo | Ported                                  |
| Filter Review, Airspeed Fit, Kinematic Tool, S-Curve Tool, Geofence Generator, Analytic Tune                        | In progress                             |
| Telemetry Dashboard, Simple GCS, Video Overlay                                                                      | Planned, on a generated MAVLink package |
| SysID, AI Log Analyzer                                                                                              | Planned                                 |

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
