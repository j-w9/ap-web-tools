# WebAssembly in the Kinematic Tool

The tool runs ArduPilot's own shaping functions instead of re-writing them in TypeScript, and uses
Ruckig as the time-optimal reference. Both are prebuilt binaries kept in `src/wasm/`:

| File                       | Source                                                   | Loaded by                                 |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `control.wasm`             | upstream `KinematicTool/ardupilot/control.wasm`          | `control.ts` (direct `WebAssembly` API)   |
| `ruckig.wasm`, `ruckig.js` | upstream `KinematicTool/Ruckig/` (MIT, `RUCKIG_LICENSE`) | `ruckig-planner.ts` (via the embind glue) |

`load.ts` imports both `.wasm` files with Vite's `?url` suffix, so they are content-hashed and
emitted with the build. Tests read them with `node:fs` (`src/test-utils/wasm.ts`).

`control.wasm` has no imports, so the Emscripten glue upstream ships (`control.js`) is not needed:
`control.ts` instantiates it directly, runs `emscripten_stack_init` and `__wasm_call_ctors`, and
exposes typed functions. `ruckig.js` is kept verbatim (ignored by ESLint and Prettier) and
`ruckig.d.ts` describes the members the tool uses.

## Rebuilding `control.wasm`

You need [Emscripten](https://emscripten.org) and the ArduPilot sources. They are the
`upstream/modules/ardupilot` submodule, which is not initialised by default:

```sh
git -C upstream submodule update --init modules/ardupilot
source /path/to/emsdk/emsdk_env.sh
emcc -v
```

The helper bindings and header stubs live in upstream `KinematicTool/ardupilot/` (`bindings.cpp`,
`stubs.h`, `stubs/`). From the repository root:

```sh
emcc \
  -I upstream/KinematicTool/ardupilot/stubs \
  -I upstream/modules/ardupilot/libraries \
  -include upstream/KinematicTool/ardupilot/stubs.h \
  upstream/modules/ardupilot/libraries/AP_Math/AP_Math.cpp \
  upstream/modules/ardupilot/libraries/AP_Math/control.cpp \
  upstream/KinematicTool/ardupilot/bindings.cpp \
  -o /tmp/control.js \
  -s MODULARIZE=1 -s ENVIRONMENT='web' -s EXPORT_NAME='ControlModule' \
  -s EXPORTED_FUNCTIONS='["_shape_angle_vel_accel_wrapper", "_sqrt_controller_wrapper", "_shape_pos_vel_accel_wrapper"]'
cp /tmp/control.wasm apps/kinematic-tool/src/wasm/control.wasm
```

This is upstream's command (`KinematicTool/Readme.md`) with the new paths. Only the `.wasm` file is
used; throw away the generated `control.js`. `bindings.cpp` includes `control.h` by a relative path
(`../../modules/ardupilot/...`), which resolves when it is compiled from its upstream location.

If you change the exported functions, update `control.ts` to match. It checks that each export it
needs exists, and fails with a clear error if one is missing. If the new module has imports (for
example because it now uses libc I/O), you need to pass them to `WebAssembly.instantiate` or go back
to using the generated glue.

Then run `npx vitest run apps/kinematic-tool`: the oracle tests run upstream's JavaScript against
the same binary, and the unit tests check the functions behave sensibly.

## Updating Ruckig

Ruckig's web build comes from upstream as-is. To update it, replace `ruckig.js` and `ruckig.wasm`
together (the glue and binary are paired by minified import names), then check `ruckig.d.ts` still
matches the members `ruckig-planner.ts` uses.
