import { describe, expect, it } from 'vitest'
import { toCartesian } from './cartesian.js'
import { openRing, type Ring } from './geo.js'
import {
  SIMPLIFY_LIMITS,
  polygonArea,
  lineIntersects,
  simplifyRings,
  triangleArea,
  type SimplifiedShape,
  type XYRing
} from './simplify.js'
import { loadUpstream, rng } from '../test-utils/upstream.js'
import { lakeRing } from '../test-utils/fixtures.js'

const upstream = loadUpstream()

/** Rings in metres about the first outer vertex, as `generateFence` builds them. */
function metres(rings: readonly Ring[]): XYRing[] {
  const origin = rings[0]![0]!
  return rings.map((r) => toCartesian(openRing(r), origin))
}

/** Upstream `simplify_poly` result in the port's shape. */
function upstreamShapes(rings: readonly XYRing[]): SimplifiedShape[] {
  const out = upstream.simplify_poly(
    rings.map((r) => [...r.x]),
    rings.map((r) => [...r.y])
  )
  return out.x.map((x, i) => {
    const radius = out.radius[i]
    return radius == null
      ? { kind: 'polygon', x: [...x], y: [...out.y[i]!] }
      : { kind: 'circle', x: x[0]!, y: out.y[i]![0]!, radiusM: radius }
  })
}

function totalPoints(shapes: readonly SimplifiedShape[]): number {
  return shapes.reduce((n, s) => n + (s.kind === 'polygon' ? s.x.length : 1), 0)
}

/** A correct segment test (what upstream's `line_intersects` was meant to be), to inspect results. */
function crosses(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean {
  const r1x = b[0]! - a[0]!
  const r1y = b[1]! - a[1]!
  const r2x = d[0]! - c[0]!
  const r2y = d[1]! - c[1]!
  const den = r1x * r2y - r1y * r2x
  if (Math.abs(den) < 1e-9) return false
  const qx = c[0]! - a[0]!
  const qy = c[1]! - a[1]!
  const t = (qx * r2y - qy * r2x) / den
  const u = (qx * r1y - qy * r1x) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

function selfIntersects(x: readonly number[], y: readonly number[]): boolean {
  const n = x.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      const a = [x[i]!, y[i]!] as const
      const b = [x[(i + 1) % n]!, y[(i + 1) % n]!] as const
      const c = [x[j]!, y[j]!] as const
      const d = [x[(j + 1) % n]!, y[(j + 1) % n]!] as const
      if (crosses(a, b, c, d)) return true
    }
  }
  return false
}

describe('areas match upstream', () => {
  it('polygonArea and triangleArea', () => {
    const next = rng(3)
    for (let k = 0; k < 50; k++) {
      const x = Array.from({ length: 12 }, () => (next() - 0.5) * 1000)
      const y = Array.from({ length: 12 }, () => (next() - 0.5) * 1000)
      expect(polygonArea(x, y)).toBe(upstream.polygon_area(x, y))
      expect(triangleArea([x[0]!, y[0]!], [x[1]!, y[1]!], [x[2]!, y[2]!])).toBe(
        upstream.triangle_area([x[0]!, x[1]!, x[2]!], [y[0]!, y[1]!, y[2]!])
      )
    }
    expect(polygonArea([0, 10, 10, 0], [0, 0, 10, 10])).toBe(100)
  })
})

describe('lineIntersects reproduces upstream line_intersects', () => {
  it('never reports a crossing, like upstream (comma-operator bug)', () => {
    expect(upstream.line_intersects([0, 0], [10, 10], [0, 10], [10, 0])).toBe(false)
    expect(lineIntersects([0, 0], [10, 10], [0, 10], [10, 0])).toBe(false)
    expect(crosses([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true)
  })

  it('agrees with upstream on random segments', () => {
    const next = rng(5)
    for (let k = 0; k < 500; k++) {
      const point = (): [number, number] => [(next() - 0.5) * 100, (next() - 0.5) * 100]
      const [a, b, c, d] = [point(), point(), point(), point()]
      expect(lineIntersects(a, b, c, d)).toBe(upstream.line_intersects(a, b, c, d))
    }
  })
})

describe('simplifyRings matches upstream simplify_poly', () => {
  const cases: [string, Ring[]][] = [
    ['a large lake', [lakeRing(1200, 8.5, 47.3, 1500, 11)]],
    [
      'a lake with islands',
      [lakeRing(600, 8.5, 47.3, 2000, 12), lakeRing(80, 8.5, 47.305, 150, 13), lakeRing(40, 8.51, 47.295, 100, 14)]
    ],
    ['a mid-sized pond', [lakeRing(120, -1.2, 52.1, 120, 15, 2)]],
    ['a tiny ring', [lakeRing(30, -1.2, 52.1, 60, 16)]],
    ['a near-circular pond', [lakeRing(80, -1.2, 52.1, 3, 17, 0)]],
    ['a lake with a round island', [lakeRing(400, 8.5, 47.3, 2000, 18), lakeRing(60, 8.5, 47.3, 3, 19, 0)]]
  ]

  it.each(cases)('%s', (_, rings) => {
    const input = metres(rings)
    expect(simplifyRings(input)).toEqual(upstreamShapes(input))
  })

  it('does not mutate its input', () => {
    const input = metres([lakeRing(300, 8.5, 47.3, 1500, 20)])
    const copy = input.map((r) => ({ x: [...r.x], y: [...r.y] }))
    simplifyRings(input)
    expect(input).toEqual(copy)
  })
})

describe('simplifyRings behaviour', () => {
  it('respects the point budget', () => {
    const shapes = simplifyRings(metres([lakeRing(3000, 8.5, 47.3, 5000, 21)]))
    const total = totalPoints(shapes)
    expect(total).toBeLessThanOrEqual(SIMPLIFY_LIMITS.maxNodes)
    expect(total).toBeGreaterThanOrEqual(SIMPLIFY_LIMITS.minNodes)
  })

  it('replaces round ponds with circles', () => {
    const [shape] = simplifyRings(metres([lakeRing(80, -1.2, 52.1, 3, 17, 0)]))
    expect(shape?.kind).toBe('circle')
    if (shape?.kind === 'circle') expect(shape.radiusM).toBeCloseTo(3, 0)
  })

  it('can create a self-intersection, exactly as upstream does', () => {
    // A comb of narrow slots cut down from the top edge. Under each slot tip the bottom edge dips
    // slightly; the dip vertex has the smallest triangle, and removing it puts the bottom edge
    // straight across the slot. Upstream's guard never fires, so it removes it anyway.
    const x: number[] = []
    const y: number[] = []
    const teeth = 30
    for (let k = 0; k < teeth; k++) {
      x.push(k * 200, k * 200 + 100)
      y.push(0, -0.5)
    }
    x.push(teeth * 200, teeth * 200)
    y.push(0, 100)
    for (let k = teeth - 1; k >= 0; k--) {
      x.push(k * 200 + 101, k * 200 + 100, k * 200 + 99)
      y.push(100, -0.2, 100)
    }
    x.push(0)
    y.push(100)
    expect(selfIntersects(x, y)).toBe(false)
    const shapes = simplifyRings([{ x, y }])
    expect(shapes).toEqual(upstreamShapes([{ x, y }]))
    const shape = shapes[0]
    expect(shape?.kind).toBe('polygon')
    if (shape?.kind === 'polygon') expect(selfIntersects(shape.x, shape.y)).toBe(true)
  })
})
