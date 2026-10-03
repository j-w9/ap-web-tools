# AP Web Tools (TypeScript port)

A clean, modular TypeScript rewrite of the [ArduPilot WebTools](https://github.com/ArduPilot/WebTools):
browser-based tools for ArduPilot log review, tuning and vehicle setup.

The original tools are vendored unmodified as the `upstream/` submodule and serve as the behavioural
reference for every port. Nothing in `upstream/` is imported at runtime.

## Layout

npm-workspaces monorepo. Shared logic lives in framework-free packages; each tool is a small app on top.

| Workspace | Responsibility |
| --- | --- |
| `packages/dataflash` | ArduPilot DataFlash (`.bin`) log parser: lazy, instance-aware, typed columns |
| `packages/signal` | Array / complex math, FFT windowing and spectrum helpers |
| `packages/plot` | Typed Plotly wrappers: axis linking, colours, time-range and spectrogram patterns |
| `packages/tool-shell` | Shared tool chrome: file loading, loading overlay, error reporting, "Open in" handoff |
| `apps/<tool>` | One Vite entry per tool, served at the same URL path as upstream |

## Development

```bash
git clone --recurse-submodules https://github.com/j-w9/ap-web-tools.git
npm install
npm run dev        # all tools, hot reload
npm run typecheck
npm test
npm run build
```

## License

GPL-3.0-only, the same as upstream WebTools from which this work derives.
