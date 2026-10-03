/**
 * Polygon simplification for fences, ported from upstream `simplify_poly` (Visvalingam–Whyatt,
 * https://en.wikipedia.org/wiki/Visvalingam%E2%80%93Whyatt_algorithm). Works on rings in metres
 * (see `cartesian.ts`), open (no closing duplicate). Inputs are never mutated.
 */

/** Tuning, as upstream hard-codes it. */
export const SIMPLIFY_LIMITS = {
  /** Points whose triangle is smaller than this are removed; also the circle-fit tolerance (m²). */
  areaThresholdM2: 100,
  /** Never simplify below this many points in total. */
  minNodes: 50,
  /** Keep removing points, whatever their area, until the total is at most this. */
  maxNodes: 250
} as const

/** One input ring in metres. */
export interface XYRing {
  readonly x: readonly number[]
  readonly y: readonly number[]
}

/** A simplified ring: still a polygon, or replaced by a circle that fits it within the area tolerance. */
export type SimplifiedShape =
  | { readonly kind: 'polygon'; readonly x: readonly number[]; readonly y: readonly number[] }
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly radiusM: number }

type Point = readonly [x: number, y: number]

/** Shoelace area of a closed polygon given as open vertex arrays (upstream `polygon_area`). */
export function polygonArea(x: readonly number[], y: readonly number[]): number {
  const len = x.length - 1
  let sum1 = x[len]! * y[0]!
  let sum2 = x[0]! * y[len]!
  for (let i = 0; i < len; i++) {
    sum1 += x[i]! * y[i + 1]!
    sum2 += y[i]! * x[i + 1]!
  }
  return Math.abs(sum1 - sum2) * 0.5
}

/**
 * Area of the triangle formed by a vertex and its neighbours (upstream `triangle_area`, called
 * with `[x[j], x[prev], x[next]]`; the operand order is kept so results match bit for bit).
 */
export function triangleArea(vertex: Point, prev: Point, next: Point): number {
  const sum1 = next[0] * vertex[1] + vertex[0] * prev[1] + prev[0] * next[1]
  const sum2 = vertex[0] * next[1] + vertex[1] * prev[0] + prev[1] * next[0]
  return Math.abs(sum1 - sum2) * 0.5
}

/**
 * Upstream `line_intersects`, which is meant to say whether two segments cross. Its bounding-box
 * early outs work, but it then builds its direction vectors with the comma operator
 * (`(a, b)` evaluates to `b`, a number), so `r1[0]` is `undefined`, every cross product is `NaN`
 * and every remaining comparison is false: it never reports a crossing. The port reproduces that
 * result (see docs/upstream-bugs.md), so simplification can create self-intersecting fences just
 * as upstream does.
 */
export function lineIntersects(seg1Start: Point, seg1End: Point, seg2Start: Point, seg2End: Point): boolean {
  if (Math.min(seg1Start[1], seg1End[1]) > Math.max(seg2Start[1], seg2End[1])) return false
  if (Math.max(seg1Start[1], seg1End[1]) < Math.min(seg2Start[1], seg2End[1])) return false
  if (Math.min(seg1Start[0], seg1End[0]) > Math.max(seg2Start[0], seg2End[0])) return false
  if (Math.max(seg1Start[0], seg1End[0]) < Math.min(seg2Start[0], seg2End[0])) return false
  // Upstream's cross-product test runs on NaN here and always falls through to `return false`.
  return false
}

interface WorkRing {
  x: number[]
  y: number[]
  /** Triangle area per vertex; `Infinity` marks a vertex whose removal would cross an edge. */
  area: number[]
  /** At three points (or a circle) the ring cannot shrink further. */
  minimum: boolean
  radiusM: number | null
}

function mean(values: readonly number[]): number {
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

function vertexArea(ring: WorkRing, j: number): number {
  const len = ring.x.length
  const prev = j - 1 < 0 ? len - 1 : j - 1
  const next = j + 1 >= len ? 0 : j + 1
  return triangleArea([ring.x[j]!, ring.y[j]!], [ring.x[prev]!, ring.y[prev]!], [ring.x[next]!, ring.y[next]!])
}

function totalNodes(rings: readonly WorkRing[]): number {
  let sum = 0
  for (const r of rings) sum += r.x.length
  return sum
}

function cannotSimplify(rings: readonly WorkRing[]): boolean {
  return rings.every((r) => r.minimum) || totalNodes(rings) <= SIMPLIFY_LIMITS.minNodes
}

function toShapes(rings: readonly WorkRing[]): SimplifiedShape[] {
  return rings.map((r) =>
    r.radiusM === null
      ? { kind: 'polygon', x: r.x, y: r.y }
      : { kind: 'circle', x: r.x[0] ?? 0, y: r.y[0] ?? 0, radiusM: r.radiusM }
  )
}

/**
 * Simplify a set of rings (outer boundary first, then holes) together, so the point budget is
 * shared between them. Rings that a circle fits to within `areaThresholdM2` become circles; then
 * the vertex with the smallest triangle across all rings is removed repeatedly until every
 * remaining triangle is above the threshold and the total is at most `maxNodes`, never going
 * below `minNodes` in total or three points per ring.
 */
export function simplifyRings(input: readonly XYRing[]): SimplifiedShape[] {
  const { areaThresholdM2, maxNodes } = SIMPLIFY_LIMITS
  const rings: WorkRing[] = input.map((r) => ({
    x: [...r.x],
    y: [...r.y],
    area: [],
    minimum: r.x.length <= 3,
    radiusM: null
  }))

  if (cannotSimplify(rings)) return toShapes(rings)

  // Try replacing each ring with a circle of its mean radius about its centroid.
  for (const ring of rings) {
    const len = ring.x.length
    const centerX = mean(ring.x)
    const centerY = mean(ring.y)
    let radiusSum = 0
    for (let j = 0; j < len; j++) {
      radiusSum += Math.sqrt((ring.x[j]! - centerX) ** 2 + (ring.y[j]! - centerY) ** 2)
    }
    const radiusMean = radiusSum / len
    const circleArea = Math.PI * radiusMean ** 2
    if (Math.abs(circleArea - polygonArea(ring.x, ring.y)) < areaThresholdM2) {
      ring.x = [centerX]
      ring.y = [centerY]
      ring.radiusM = radiusMean
      ring.minimum = true
    }
  }

  if (cannotSimplify(rings)) return toShapes(rings)

  for (const ring of rings) {
    if (ring.minimum) continue
    ring.area = ring.x.map((_, j) => vertexArea(ring, j))
  }

  for (;;) {
    // Smallest triangle over all rings.
    let minValue = Number.POSITIVE_INFINITY
    let target: WorkRing | null = null
    let indexMin = 0
    for (const ring of rings) {
      if (ring.minimum) continue
      for (let j = 0; j < ring.area.length; j++) {
        if (ring.area[j]! < minValue) {
          minValue = ring.area[j]!
          target = ring
          indexMin = j
        }
      }
    }

    if (minValue > areaThresholdM2 && totalNodes(rings) <= maxNodes) {
      // Every remaining point is significant: done.
      break
    }
    if (target === null) {
      // Unreachable: a ring that is not at its minimum has finite areas, and nothing is ever
      // marked infinite because `lineIntersects` never fires. Upstream would throw here too.
      throw new Error('simplifyRings: no point left to remove')
    }

    const len = target.x.length
    const prev = indexMin - 1 < 0 ? len - 1 : indexMin - 1
    const prevPrev = prev - 1 < 0 ? len - 1 : prev - 1
    const next = indexMin + 1 >= len ? 0 : indexMin + 1

    // Would the shortcut prev -> next cross any other edge of this ring?
    const shortcutStart: Point = [target.x[prev]!, target.y[prev]!]
    const shortcutEnd: Point = [target.x[next]!, target.y[next]!]
    let crosses = false
    for (let i = 0; i < len; i++) {
      if (i === prevPrev || i === prev || i === indexMin || i === next) continue
      const iNext = i + 1 >= len ? 0 : i + 1
      if (lineIntersects([target.x[i]!, target.y[i]!], [target.x[iNext]!, target.y[iNext]!], shortcutStart, shortcutEnd)) {
        crosses = true
        break
      }
    }
    if (crosses) {
      // Keep this point; the next smallest is tried instead.
      target.area[indexMin] = Number.POSITIVE_INFINITY
      continue
    }

    target.x.splice(indexMin, 1)
    target.y.splice(indexMin, 1)
    target.area.splice(indexMin, 1)
    const newLen = target.x.length
    if (newLen === 3) target.minimum = true

    if (cannotSimplify(rings)) break

    // Recompute the two neighbours of the removed point.
    for (const k of [indexMin - 1, indexMin]) {
      const j = k >= newLen ? 0 : k < 0 ? newLen - 1 : k
      target.area[j] = vertexArea(target, j)
    }
    // Points blocked earlier may be removable now.
    for (let j = 0; j < newLen; j++) {
      if (Number.isFinite(target.area[j]!)) continue
      target.area[j] = vertexArea(target, j)
    }
  }

  return toShapes(rings)
}
