# Rebuilding the WPNav WebAssembly module

The S-Curve Tool runs ArduPilot's real `AC_WPNav` / `SCurve` / `SplineCurve` code, compiled to
WebAssembly with [Emscripten](https://emscripten.org/). The prebuilt output is committed:

- `src/wasm/wpnav.wasm`: the compiled module.
- `src/wasm/wpnav-glue.js`: Emscripten's JavaScript glue, verbatim. Emscripten names it `wpnav.js`;
  it is renamed here so Vite does not resolve imports of `./wpnav.js` (which mean `wpnav.ts`) to it.

The C++ sources that are not part of ArduPilot (the embind bindings and the stubs that replace
the rest of the flight stack) are not copied into this app. They live in the vendored upstream
tool at `upstream/SCurveTool/ardupilot/` (`bindings.cpp`, `stubs.h`, `stubs/`).

## Prerequisites

- An Emscripten SDK, activated in the shell (`emsdk activate latest`, then `source emsdk_env.sh`).
  Check with `emcc -v`.
- An ArduPilot source tree. Upstream WebTools uses its `modules/ardupilot` submodule; any checkout
  at a matching revision works. Set `ARDUPILOT` to its path below.

## Build

From the repository root:

```sh
ARDUPILOT=path/to/ardupilot
STUBS=upstream/SCurveTool/ardupilot

emcc \
  -I "$STUBS/stubs" \
  -I "$ARDUPILOT/libraries" \
  -include "$STUBS/stubs.h" \
  "$ARDUPILOT/libraries/AC_WPNav/AC_WPNav.cpp" \
  "$ARDUPILOT/libraries/AP_Math/SCurve.cpp" \
  "$ARDUPILOT/libraries/AP_Math/vector3.cpp" \
  "$ARDUPILOT/libraries/AP_Math/vector2.cpp" \
  "$ARDUPILOT/libraries/AP_Math/control.cpp" \
  "$ARDUPILOT/libraries/AP_Math/AP_Math.cpp" \
  "$ARDUPILOT/libraries/AP_Math/SplineCurve.cpp" \
  "$ARDUPILOT/libraries/AP_Math/location.cpp" \
  "$STUBS/stubs/AC_AttitudeControl/AC_PosControl.cpp" \
  "$STUBS/stubs/AP_AHRS/AP_AHRS.cpp" \
  "$STUBS/bindings.cpp" \
  -o apps/scurve-tool/src/wasm/wpnav.js \
  -s MODULARIZE=1 \
  -s ENVIRONMENT='web' \
  -s EXPORT_NAME='WPNavModule' \
  -Wno-gnu-designator \
  --bind
mv apps/scurve-tool/src/wasm/wpnav.js apps/scurve-tool/src/wasm/wpnav-glue.js
```

`bindings.cpp` includes `AC_WPNav.h` through the relative path
`../../modules/ardupilot/libraries/...`; if your ArduPilot tree is elsewhere, adjust that include
(or place a copy of the bindings where the path resolves).

This is the command from upstream `SCurveTool/build.bat`, with paths adapted to this repository.

## After rebuilding

- Keep `MODULARIZE`, `EXPORT_NAME='WPNavModule'` and `--bind`: `src/wasm/wpnav.ts` loads the glue
  as a classic script and reads the global `WPNavModule` factory.
- If the bindings change, update `src/wasm/wpnav-glue.d.ts` (the bound class and its methods) and
  the adapter in `src/wasm/wpnav-engine.ts`.
- Run `npx vitest run apps/scurve-tool`: the oracle tests run upstream `SCurveTool.js` and the port
  against the same wasm and expect identical output, and `wpnav-engine.test.ts` exercises the
  bindings directly.
