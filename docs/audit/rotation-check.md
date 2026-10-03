# Rotation Check audit

Upstream: `upstream/RotationCheck/` (`RotationCheck.js`, `Matrix3.js`, inline script in `index.html`).
Port: `apps/rotation-check/`. Oracle tests load `Matrix3.js` and the inline script in `node:vm`
(`src/analysis/test-utils/upstream.ts`).

## Inventory

| Upstream item                                                                                                                             | Port location                                                    | Status                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Rotations` list (values, labels, order)                                                                                                  | `analysis/rotations.ts` `STANDARD_ROTATIONS`, `CUSTOM_ROTATIONS` | identical (oracle)                                                                                                                                                      |
| Euler angles parsed from labels, rotation 38 special case, start-up check against `from_rotation`                                         | `rotations.ts` `eulerDeg` (written out)                          | identical (oracle checks every row against upstream's `euler` and the tolerance)                                                                                        |
| `Matrix3`: `from_rotation`, `rotate`, `from_euler`, `to_euler`, 312 variants                                                              | `analysis/matrix3.ts`                                            | identical (oracle, all rotations)                                                                                                                                       |
| `update()`: standard rotation disables boxes and writes its angles                                                                        | `App.tsx`, `ui/Rail.tsx`                                         | identical                                                                                                                                                               |
| `update()`: Custom 1/2 enables boxes, `from_euler(parseFloat(box) * deg2rad ...)`                                                         | `analysis/resolve.ts` `parseEulerDeg`, `resolveRotation`         | reverted in this audit: empty or non-numeric boxes were rejected with an error and no plot; now `parseFloat`, NaN carried into the matrix and plot as upstream (oracle) |
| Boxes keep the last standard rotation's angles when switching to custom                                                                   | `App.tsx` `select`                                               | identical                                                                                                                                                               |
| Plot: faded reference axes (length 0.2), rotated axes `rotate([0.3,0,0])` etc., cone `sizeref` 0.4, colours, scene ranges, aspect, camera | `ui/traces.ts`                                                   | identical (oracle for the vectors)                                                                                                                                      |
| `throw new Error("Invalid rotation")`                                                                                                     | none                                                             | unreachable (the list only offers known values)                                                                                                                         |
| Matching standard rotation lookup                                                                                                         | removed                                                          | reverted in this audit (new analysis)                                                                                                                                   |
| Euler angles recovered from the matrix (`to_euler`)                                                                                       | removed                                                          | reverted in this audit (new output)                                                                                                                                     |
| Rotation matrix table                                                                                                                     | `ui/MatrixPanel.tsx` `MatrixTable`                               | convenience: shows the matrix upstream computes and plots, no new computation                                                                                           |

## Remaining intentional differences

- Presentation: searchable list box instead of a drop-down (labels `value:name` as upstream);
  legend entries name the frames ("Reference frame", "X forward", ...) where upstream's legend is
  empty; colours of axes follow the theme; the help text.
- Conveniences: search filter over the list; wheel scrolling scrolls the page instead of zooming
  (`scrollZoom: false`) and `uirevision` keeps the camera when the rotation changes; angles update
  as typed (upstream on `change`): the final result for the same text is identical; parameter
  value with its enum name (`ROTATION_...`) and the angles as text.

## Upstream bugs reproduced

| Location                                      | Reproduction                 | Effect                                                                                              |
| --------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `update()` `parseFloat(roll_in.value)`        | Custom 1, empty the Roll box | Matrix NaN, rotated arrows disappear                                                                |
| `index.html` label `38: Yaw293Pitch68Roll180` | Select 38                    | Label says Roll180 though the rotation (and upstream's special-cased angles) is roll 90; label kept |
