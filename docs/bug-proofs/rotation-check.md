# Rotation Check: bug proofs

Reproductions: `proofs/rotation-check/rotation-check.test.ts` (original `RotationCheck/Matrix3.js`,
`RotationCheck/RotationCheck.js` and the inline script of `RotationCheck/index.html` in `node:vm`,
harness `proofs/rotation-check/_harness.ts`). Paths below are relative to `upstream/`; firmware
paths are relative to `upstream/modules/ardupilot/` (f3836cf).

| #   | Row                                                        | Verdict    |
| --- | ---------------------------------------------------------- | ---------- |
| 1   | Empty custom angle plotted as NaN                          | NOT PROVEN |
| A1  | Label `38: Yaw293Pitch68Roll180` (audit only, no bugs row) | NOT PROVEN |

## 1. Empty custom angle plotted as NaN

Row: `RotationCheck/RotationCheck.js` `update` (`parseFloat(roll_in.value)`): an empty Roll/Pitch/Yaw
box makes the matrix NaN and the rotated arrows vanish.

**Verdict: NOT PROVEN.**

Test: `Rotation Check: empty custom angle plotted as NaN` › `Custom 1 with an empty Roll box gives
NaN rotated arrows`. Custom 1 with roll `0`, pitch `0`, yaw `90` puts the rotated X arrow at
(0, 0.3, 0); with roll `""` every rotated trace (6 to 11) contains NaN and the rotated X cone is
`x: [NaN]`.

Evidence: `RotationCheck/RotationCheck.js:20`:
`mat.from_euler(parseFloat(roll_in.value) * deg2rad, parseFloat(pitch_in.value) * deg2rad, parseFloat(yaw_in.value) * deg2rad)`.
The original computes NaN for an empty box, but nothing in the page or the firmware says an empty
custom angle means 0 (the boxes are plain `type="number"` inputs with no default,
`RotationCheck/index.html:42,45,48`). Showing no rotated frame for an input that is not a number is
a reasonable reading, the page does not throw, and an empty box is not an output the UI offers. It
stays reproduced.

## A1. Label of rotation 38 (audit only)

Audit row (`docs/audit/rotation-check.md`, not in `upstream-bugs.md`): label
`38: Yaw293Pitch68Roll180` says Roll180 though the rotation (and upstream's special-cased angles)
is roll 90.

**Verdict: NOT PROVEN.**

Test: `Rotation Check: label of rotation 38 (audit only)`: the label is `Yaw293Pitch68Roll180` and
the recorded angles are `[90, 68.8, 293.3]`.

Evidence: the enum name and comment disagree with the label,
`libraries/AP_Math/rotations.h:66`:
`ROTATION_ROLL_90_PITCH_68_YAW_293 = 38, // this is actually, roll 90, pitch 68.8, yaw 293.3`,
and the page itself uses roll 90 (`RotationCheck/index.html:161-165`). But the label is the
firmware's own published value label: `libraries/AP_Math/rotations.h:93` `@Values: … 38:Yaw293Pitch68Roll180 …`,
repeated in `libraries/AP_AHRS/AP_AHRS.cpp:146` and `libraries/AP_Compass/AP_Compass.cpp:185`.
The page matches the name a ground station shows for that value, so it does not contradict
ArduPilot; the inconsistency is inside the firmware. The label is kept.
