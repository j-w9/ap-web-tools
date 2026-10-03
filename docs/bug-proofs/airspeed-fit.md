# AirspeedFit bug proofs

Verdicts for the AirspeedFit rows of [`../upstream-bugs.md`](../upstream-bugs.md), using the
standard in [`README.md`](README.md). The reproductions run the original `AirspeedFit/airspeedfit.js`,
`airspeedfit_core.js`, the shared Libraries, the vendored ml-matrix build and the JsDataflashParser in
`node:vm` (`proofs/airspeed-fit/_harness.ts`). They use the synthetic plane log of
`proofs/airspeed-fit/_log.ts`, which has options to drop columns or parameters.

| #   | Bug                                                                    | Verdict    | Reproduction                               |
| --- | ---------------------------------------------------------------------- | ---------- | ------------------------------------------ |
| 1   | BARO without instance field or missing EKF/STAT columns crash the load | **PROVEN** | `proofs/airspeed-fit/load-crashes.test.ts` |
| 2   | Bias bar is `Math.abs(null)` = 0 without a logged ratio                | NOT PROVEN | `proofs/airspeed-fit/bias-bar.test.ts`     |

## 1. BARO without instance field or missing EKF/STAT columns crash the load

**Row.** Bug: "BARO without instance field or missing EKF/STAT columns crash the load". Where:
`AirspeedFit/airspeedfit.js` `load`, `get_velocity_sources`. Effect: "Nothing loaded".

**Verdict.** PROVEN under "it fails": all three inputs make `load` throw. Only the BARO case can come
from a real ArduPilot log (older firmware). At the pinned commit, ArduPilot always logs the BARO
instance, the XKF1 velocities and `STAT.isFlying`, so the column cases only arise from logs ArduPilot
does not write.

**Reproduction.** `proofs/airspeed-fit/load-crashes.test.ts`:

- › "loads the complete synthetic log": no alerts, 2 sensors.
- › "throws on a BARO message without an instance field": `load` rejects with
  `TypeError: Cannot use 'in' operator to search for '0' in undefined`, with no alert.
- › "throws on XKF1 without velocity columns": rejects with `undefined is not iterable`, with no
  alert.
- › "throws on STAT without isFlying": rejects with
  `Cannot read properties of undefined (reading 'length')`, with no alert.

**Evidence.** It fails.

- The load accepts these logs: it checks for BARO by name only, at
  `upstream/AirspeedFit/airspeedfit.js:472` `if (!("BARO" in log.messageTypes)) {`. It then throws:
  - `upstream/AirspeedFit/airspeedfit.js:500` `const baro_inst = (0 in log.messageTypes.BARO.instances) ? 0 : …`
    (`instances` is undefined when BARO has no `#` field).
  - line 239 `vn: Array.from(log.get_instance(v.p1, core, "VN")),`
  - line 531 `const flying = log.get("STAT", "isFlying")` and line 533 `for (let i = 0; i < flying.length; i++) {`
- The same function handles missing instance fields for every other message with an alert or a skip:
  - line 464 `if (!("ARSP" in log.messageTypes) || !("instances" in log.messageTypes.ARSP)) {` → `alert("No airspeed (ARSP) data in log")`
  - line 224 `if (!(v.p1 in log.messageTypes) || !("instances" in log.messageTypes[v.p1])) {` → `continue`
- ArduPilot at the pinned commit:
  - BARO carries the instance field:
    `upstream/modules/ardupilot/libraries/AP_Baro/LogStructure.h:58-60`
    (`"TimeUS," "I," …` with units `"s"       "#" …`).
  - XKF1 has `VN,VE,VD`: `upstream/modules/ardupilot/libraries/AP_NavEKF3/LogStructure.h:436`.
  - Plane's STAT has `isFlying`: `upstream/modules/ardupilot/ArduPlane/Log.cpp:418`.

  A BARO without the instance field is therefore an older firmware's log. The column cases are not
  ArduPilot logs at all, so fixing them only adds robustness.

**Minimal correct behaviour.** `load` never throws on a parsed log. A BARO without instances is
read as a single barometer (`log.get("BARO", …)`), or the load stops with an alert like its other
"No … data in log" messages. Missing velocity or `isFlying` columns give such an alert, or the source
or flight span is skipped, as `get_velocity_sources` already does for a missing instance field.

**Smallest port change.** In the port's load step, read an un-instanced BARO as instance 0 (or
return the existing "BARO has no instance field" error as a user message rather than an exception).
Turn the missing-column cases into the same user-facing load errors.

## 2. Bias bar is `Math.abs(null)` = 0 without a logged ratio

**Row.** Bug: "Bias bar is `Math.abs(null)` = 0 without a logged ratio". Where: `redraw_rms_bar`.
Effect: "Cosmetic zero-height bar".

**Verdict.** NOT PROVEN.

**Reproduction.** `proofs/airspeed-fit/bias-bar.test.ts` › "draws an RMS gap but a zero bias bar for
"Existing"". This uses the synthetic log without `ARSPD2_RATIO`, so `ASP_Data[1].current_ratio` is
`undefined`. The test captures the `Plotly.react('rms_bar', …)` traces:

- Bar names: `['Sensor 1', 'Sensor 2', 'mean error', 'mean error']`.
- For sensor 2's "Existing" category, the RMS `y` is `null`, while the bias `y` is `0` with
  `customdata` `null`.
- Sensor 1 has a number for both.

**Evidence.**

- The behaviour is as described: `upstream/AirspeedFit/airspeedfit.js:1057`
  `pred_before: null, resid_before: null, rms_before: null, mean_before: null,` and line 1159
  `const bias = [Math.abs(s.mean_before), Math.abs(s.mean_after)]`.
- But a bar of height 0 draws nothing, just as the `null` RMS bar does. No output a user sees
  differs.
- The comment at lines 1149-1151 ("|mean| ≤ RMS … the dark bar collapsing to nothing after
  calibration = the bias was removed") describes the "Fitted" category, not a sensor without an
  existing calibration.
- No reference in upstream, ArduPilot or Plotly's specification states that the result is wrong.
