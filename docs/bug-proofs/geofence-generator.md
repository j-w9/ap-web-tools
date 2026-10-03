# Geofence Generator: bug proofs

Verdicts for the Geofence Generator rows of [`../upstream-bugs.md`](../upstream-bugs.md) (the same
six bugs are listed under "Upstream bugs reproduced" in
[`../audit/geofence-generator.md`](../audit/geofence-generator.md)). Reproductions:
`proofs/geofence-generator/geofence-generator.test.ts`, which runs the original
`upstream/GeofenceGenerator/GeofenceGenerator.js` (with `upstream/Libraries/Array_Math.js`) in
`node:vm` through `proofs/geofence-generator/_harness.ts`, with the real osmtogeojson
3.0.0-beta.5 and Turf `@turf/intersect` 6.5.0 (the page loads `@turf/turf@6`,
`upstream/GeofenceGenerator/index.html:13`).

Line numbers below are `upstream/GeofenceGenerator/GeofenceGenerator.js` unless another file is
named.

| #   | Bug                                                | Verdict    | Reference                                                      |
| --- | -------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| 1   | `line_intersects` always returns false             | PROVEN     | Contradicts itself (comments and algorithm), geometry          |
| 2   | Every download edits the feature (pop, rotate 228) | NOT PROVEN | No failure; intent of the rotation not stated                  |
| 3   | Only the first `/` and `\` replaced in file names  | PROVEN     | Contradicts itself ("sanitize name for use in file")           |
| 4   | Crop stops at a non-polygon feature                | PROVEN     | It fails (throws); row mis-describes the effect                |
| 5   | Failed search keeps the previous features          | NOT PROVEN | Failure is reported; keeping the last results is a fair intent |
| 6   | `wrap_180` does not wrap below -180                | PROVEN     | Contradicts ArduPilot `wrap_180` and its documented range      |

## 1. `line_intersects` always returns false

**Row:** `GeofenceGenerator/GeofenceGenerator.js` `line_intersects` (`const r1 = (a, b)` comma
operator): `r1[0]` is `undefined`, the cross products are NaN, so the self-intersection guard in
`simplify_poly` never fires and simplified fences can cross themselves.

**Verdict: PROVEN**

**Tests:** "Geofence Generator: line_intersects always returns false" — "reports two crossing
segments as not intersecting", "builds its direction "vectors" with the comma operator, so they are
numbers", "lets simplify_poly create a self-intersecting fence from a simple polygon".

**Reproduction:** `line_intersects([0,0],[10,10],[0,10],[10,0])` returns `false`; the two segments
cross at (5, 5) (orientation test in the harness: each segment's endpoints lie strictly on opposite
sides of the other). Line 376 evaluated as written for (0,0)-(10,10) gives `r1 === 10` and
`r1[0] === undefined`. A 153-vertex comb polygon with no crossing edges comes out of `simplify_poly`
with 95 vertices and 24 crossing edge pairs (the bottom edge crosses both walls of 12 slots).

**Evidence:**

- `GeofenceGenerator.js:376-377`:
  `const r1 = (seg1_end[0] - seg1_start[0], seg1_end[1] - seg1_start[1])` /
  `const r2 = (seg2_end[0] - seg2_start[0], seg2_end[1] - seg2_start[1])`. A parenthesised comma
  expression evaluates to its last operand, so `r1` and `r2` are numbers and `r1[0]`, `r1[1]`,
  `r2[0]`, `r2[1]` are `undefined`.
- `GeofenceGenerator.js:378-379`: `const r1xr2 = r1[0]*r2[1] - r1[1]*r2[0]` is `NaN`, and
  `if (Math.abs(r1xr2) < 1e-09)` is false; `t` and `u` (`:387-388`) are `NaN`, so
  `if ((u >= 0) && (u <= 1) && (t >= 0) && (t <= 1))` (`:389`) is false and the function reaches
  `return false` (`:399`) for every pair that passes the bounding-box checks.
- The same code states the intent: `:347` `// detect intersection between two points`; `:375`
  `// implementation borrowed from http://stackoverflow.com/questions/563198/how-do-you-detect-where-two-line-segments-intersect`;
  `:390` `// lines intersect`; `:462` `// will not create self intersecting polygon`; `:563`
  `// test if removing this point will create a self intersections`; `:596`
  `// cant remove this point without creating intersection, set area inf so next smallest is selected`.
  The algorithm written at `:383-388` is the standard segment test with
  `t = (q - p) x s / (r x s)`, `u = (q - p) x r / (r x s)` (`:385-386`), which needs `r1`, `r2` and
  `ss2_ss1` to be 2-vectors.

**Minimal correct behaviour:** `line_intersects` returns true when the two segments cross
(`0 <= t <= 1` and `0 <= u <= 1` with the vectors computed as `[dx, dy]`), so `simplify_poly`
refuses a removal whose new edge crosses another edge of the ring, as `:462` and `:563` state.
Because the guard can then mark points `Infinity` (`:597`), the loop must also stop when no finite
candidate is left; the original never reaches that state today (no area is ever set to `Infinity`),
but with a working guard and more than 250 nodes it would reach `:602` with `min_poly_index`
undefined.

**Smallest port change:** in `apps/geofence-generator/src/analysis/simplify.ts` `lineIntersects`,
build `r1 = [e1x - s1x, e1y - s1y]`, `r2 = [e2x - s2x, e2y - s2y]` and `ss2_ss1` likewise and keep
the rest of upstream's test; in `simplifyRings`, `break` instead of throwing when `target === null`
(no finite candidate).

## 2. Every download edits the feature: closing point dropped, rings rotated 228 places

**Row:** `generate_fence` (`points.pop()`, `points.push(points.shift())` x228): downloading the same
water body twice gives two different files; the popup point count drops after the first download;
later crops start from the edited rings.

**Verdict: NOT PROVEN** (behaviour confirmed as described; no hard reference that it is wrong)

**Tests:** "Geofence Generator: every download edits the feature" — "drops the closing point once
and rotates the ring by 228 places per download", "still crops the edited (unclosed) ring without
failing".

**Reproduction:** an 11-vertex closed way (12 positions). After the first download the feature's
ring has 11 positions starting at original vertex 8 (228 mod 11); after the second it starts at
vertex 5. The two files differ, but they hold the same 11 vertices in the same cyclic order (the
second is the first rotated by 8). Cropping the edited feature afterwards still returns its polygon.

**Evidence:**

- `GeofenceGenerator.js:235-239`: the pop is intended (`// Drop last point if it is the same as the first`);
  doing it on the feature's own array is a side effect no comment or text speaks to.
- `GeofenceGenerator.js:242-244`: `for (let i = 0; i < 228; i++) { points.push(points.shift()); }`
  is deliberate code with no stated purpose. Rotating a ring does not change the polygon it
  describes, so each file is still a fence of the same water body.
- No failure: the files are well-formed, and Turf `intersect` accepts the unclosed ring (test above).
  The popup's `Points:` count (`:203-209`) is not defined anywhere as counting the closing
  duplicate or not.

Two different simplifications of the same polygon are both fences of it; which start vertex is
"right" is not stated in the original, so the behaviour stays reproduced.

## 3. Only the first `/` and `\` replaced in file names

**Row:** `generate_fence` (`name.replace('/', '_')`): `A/B/C` is offered as `A_B/C.waypoints`.

**Verdict: PROVEN**

**Test:** "Geofence Generator: only the first / and \ replaced in file names" — "offers A/B/C\D\E as
A_B/C_D\E.waypoints".

**Reproduction:** `generate_fence(feature, 'A/B/C\\D\\E')` calls `saveAs` with
`A_B/C_D\E.waypoints`.

**Evidence:**

- `GeofenceGenerator.js:261-263`: `// sanitize name for use in file` /
  `name = name.replace('/', '_')` / `name = name.replace('\\', '_')`. The comment and the two calls
  state the intent: `/` and `\` must not reach the file name. `String.prototype.replace` with a
  string pattern replaces only the first occurrence, so the name handed to `saveAs` (`:292`) still
  contains both characters whenever the name has two or more of either.

**Minimal correct behaviour:** every `/` and every `\` in the name becomes `_` (e.g.
`A_B_C_D_E.waypoints`); names with at most one of each are unchanged.

**Smallest port change:** `apps/geofence-generator/src/analysis/fence.ts` `fenceFileName`:
`name.replaceAll('/', '_').replaceAll('\\', '_')`.

## 4. Crop stops at a non-polygon feature

**Row:** `apply_crop` (`turf.intersect` on every feature): an unclosed `natural=water` way (a
LineString) makes `intersect` throw; only features before it are shown.

**Verdict: PROVEN** (it fails). **The row's effect is mis-described**: no water body is lost.

**Test:** "Geofence Generator: crop stops at a non-polygon feature" — "throws on an unclosed
natural=water way after cropping every polygon".

**Reproduction:** an Overpass response with an unclosed `natural=water` way listed first and a
closed one second. osmtogeojson returns `[way/2 Polygon, way/1 LineString]`; `add_crop` throws
`Input geometry is not a valid Polygon or MultiPolygon`, after the polygon `way/2` has already been
cropped and added to the map.

**Evidence:**

- It fails: `GeofenceGenerator.js:156-157` `for (const feature of features) {` /
  `const cropped = turf.intersect(feature, crop_JSON)` throws for the LineString; the exception
  escapes `add_crop` (`:139`) and the `editable:vertex:dragend` handler
  (`upstream/GeofenceGenerator/index.html:142-144`), and the page's `window.onerror`
  (`index.html:92-101`) shows `Sorry, something went wrong.` on every crop and every vertex drag.
- The input is one the page requests itself: `:53` `way[natural=water][!water];` with `out geom`
  (`:59`) returns unclosed ways too, and the page's own `add_feature` (`:91-109`) only handles
  `"Polygon"` and `"MultiPolygon"`, silently skipping anything else, so the LineString is never shown.
- Why nothing is lost: osmtogeojson emits every polygon before any line
  (`node_modules/osmtogeojson/index.js:968-970`: `geojson.features.concat(geojsonpolygons)`, then
  `geojsonlines`, then `geojsonnodes`), so the throw happens only after all polygons were cropped.
  The visible effect is the error alert, not missing water bodies.

**Minimal correct behaviour:** Crop (and each crop-vertex drag) clips every Polygon/MultiPolygon
feature and ignores other geometry types, as `add_feature` does, with no error. The cropped
polygons are exactly the ones the original shows before it throws.

**Smallest port change:** `apps/geofence-generator/src/analysis/features.ts` `cropFeatures`:
`if (!isPolygonal(feature)) continue` instead of returning the error.

## 5. Failed search keeps the previous features

**Row:** `request`: the map and crop are cleared before the fetch fails, but Crop then brings the
previous search's water bodies back.

**Verdict: NOT PROVEN** (behaviour confirmed as described)

**Test:** "Geofence Generator: failed search keeps the previous features" — "clears the map,
rejects, and Crop brings the previous search back".

**Reproduction:** a successful search (one polygon), then a search whose fetch rejects with
`TypeError`: no layers are left, `features` still holds `way/2`, and `add_crop` shows `way/2` again.

**Evidence:**

- `GeofenceGenerator.js:23-34` clears the polygons and crop and enables Crop before `:65`
  `const data = await fetch(uri, {method:'POST', body:request,})`; `features` is only assigned
  after a successful parse (`:75`).
- The failure is reported: the rejection reaches `index.html:102-104`
  (`window.addEventListener('unhandledrejection', ...)` rethrows) and `window.onerror` alerts.
- Nothing in the page states that a failed search must discard the previous results; keeping the
  last successful search's data is a reasonable reading, so this stays reproduced.

## 6. `wrap_180` does not wrap below -180

**Row:** `wrap_180`: `wrap_180(-200)` is `-200` (`%` keeps the sign); harmless at lake scale.

**Verdict: PROVEN**. The row understates the effect: across the antimeridian it is not harmless.

**Tests:** "Geofence Generator: wrap_180 does not wrap below -180" — "returns -200 for -200 (160
expected) and wraps +200 correctly", "makes convertToCartesian asymmetric across the antimeridian".

**Reproduction:** `wrap_180(-200) === -200`, while `wrap_180(200) === -160`. With
`convertToCartesian`, a point at longitude -179.999 relative to an origin at 179.999 (0.002° apart
on the equator) gets `y = -40074561.570032075` m; the mirror case (point 179.999, origin -179.999)
gets `y = -222.637690037636` m.

**Evidence:**

- `GeofenceGenerator.js:296-298`: `return ((angle + 180) % 360) - 180;`. For `angle < -180`,
  `angle + 180` is negative, `%` returns a negative remainder and the result is below -180.
- The function mirrors ArduPilot's location maths, as the neighbouring code does
  (`:300-303` `longitude_scale` with `Math.max(scale, 0.01)` matches
  `upstream/modules/ardupilot/libraries/AP_Common/Location.cpp:528-532`
  `ftype scale = cosF(lat * (1.0e-7 * DEG_TO_RAD)); return MAX(scale, 0.01);`; `:310-311` match
  `Location::get_distance_NE`, `Location.cpp:419-423`). ArduPilot at f3836cf documents the range:
  `libraries/AP_Math/AP_Math.h:124-130`
  `Constrain an angle to be within the range: -180 to 180 degrees.` and implements it as
  `AP_Math.cpp:150-157` `auto res = wrap_360(angle); if (res > T(180)) { res -= T(360); }`, with
  `wrap_360` (`AP_Math.cpp:184-191`) `float res = fmodf(angle, 360.0f); if (res < 0) { res += 360.0f; }`.
  So ArduPilot's `wrap_180(-200)` is 160. The name and the firmware both say the result lies in
  [-180, 180]; -200 does not.
- Reachable: `convertToCartesian` (`:311`) wraps `points[i][0] - origin[0]`, which is below -180
  for a vertex just west of the antimeridian when the origin (`:228`, the first vertex) is just east
  of it, and `convertFromCartesian` (`:322`) can write a longitude below -180 to the file.

**Minimal correct behaviour:** angles below -180 are wrapped into range (`wrap_180(-200) = 160`);
every angle at or above -180 gives exactly the value the original gives today, so all results away
from the antimeridian are unchanged bit for bit.

**Smallest port change:** `apps/geofence-generator/src/analysis/cartesian.ts` `wrap180`:
`let r = (angle + 180) % 360; if (r < 0) r += 360; return r - 180`. (Adding 360 unconditionally,
`((a + 180) % 360 + 360) % 360`, would round non-negative remainders and change normal outputs.)
