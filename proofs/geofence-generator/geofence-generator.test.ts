import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { crossingEdges, loadUpstream, overpassWays, segmentsCross, type UpstreamFeature } from './_harness.js'

const bounds = { south: 0, west: 0, north: 1, east: 1 }
const wholeView = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0]
]

/** A closed ring of `n` distinct vertices on a small circle (fewer than 50 nodes: no simplification). */
function closedRing(n: number): number[][] {
  const ring: number[][] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    ring.push([Number((0.5 + 0.001 * Math.cos(a)).toFixed(7)), Number((0.5 + 0.001 * Math.sin(a)).toFixed(7))])
  }
  ring.push([...ring[0]!])
  return ring
}

function polygonFeature(ring: number[][]): UpstreamFeature {
  return { type: 'Feature', id: 'way/1', properties: {}, geometry: { type: 'Polygon', coordinates: [ring.map((p) => [...p])] } }
}

describe('Geofence Generator: line_intersects always returns false', () => {
  it('reports two crossing segments as not intersecting', () => {
    const up = loadUpstream()
    // (0,0)-(10,10) and (0,10)-(10,0) cross at (5,5).
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true)
    expect(up.line_intersects([0, 0], [10, 10], [0, 10], [10, 0])).toBe(false)
  })

  it('builds its direction "vectors" with the comma operator, so they are numbers', () => {
    // Line 376 of the original, evaluated as written for the segment (0,0)-(10,10).
    const line376 = readFileSync(resolve(__dirname, '../../upstream/GeofenceGenerator/GeofenceGenerator.js'), 'utf8').split(
      '\n'
    )[375]!
    expect(line376.trim()).toBe('const r1 = (seg1_end[0] - seg1_start[0], seg1_end[1] - seg1_start[1])')
    const r1: unknown = runInNewContext(`${line376}; r1`, { seg1_start: [0, 0], seg1_end: [10, 10] })
    expect(r1).toBe(10)
    expect((r1 as number[])[0]).toBeUndefined()
    expect(Math.abs(NaN) < 1e-9).toBe(false) // so the parallel test is skipped and t, u are NaN
  })

  it('lets simplify_poly create a self-intersecting fence from a simple polygon', () => {
    const up = loadUpstream()
    // A comb of narrow slots cut down from the top edge; under each slot tip the bottom edge dips
    // slightly. Removing a dip vertex (the smallest triangle) puts the bottom edge across the slot.
    const x: number[] = []
    const y: number[] = []
    for (let k = 0; k < 30; k++) {
      x.push(k * 200, k * 200 + 100)
      y.push(0, -0.5)
    }
    x.push(6000, 6000)
    y.push(0, 100)
    for (let k = 29; k >= 0; k--) {
      x.push(k * 200 + 101, k * 200 + 100, k * 200 + 99)
      y.push(100, -0.2, 100)
    }
    x.push(0)
    y.push(100)
    expect(crossingEdges(x, y)).toEqual([])
    const out = up.simplify_poly([[...x]], [[...y]])
    expect(out.radius[0]).toBeUndefined()
    expect(x).toHaveLength(153)
    expect(out.x[0]).toHaveLength(95)
    // The bottom edge (edge 0) now crosses both walls of 12 slots.
    const crossings = crossingEdges(out.x[0]!, out.y[0]!)
    expect(crossings).toHaveLength(24)
    expect(crossings.every(([a]) => a === 0)).toBe(true)
    expect(crossings[0]).toEqual([0, 58])
  })
})

describe('Geofence Generator: every download edits the feature', () => {
  it('drops the closing point once and rotates the ring by 228 places per download', async () => {
    const up = loadUpstream()
    const ring = closedRing(11)
    await up.request(bounds, 12, overpassWays([{ id: 1, tags: { natural: 'water' }, ring }]))
    const feature = up.features()[0]!
    const coords = () => (feature.geometry.coordinates as number[][][])[0]!
    expect(coords()).toHaveLength(12)

    const first = await up.generateFence(feature, 'Lake')
    // 228 mod 11 = 8: the ring now starts at original vertex 8 and has no closing point.
    expect(coords()).toHaveLength(11)
    expect(coords()[0]).toEqual(ring[8])
    const second = await up.generateFence(feature, 'Lake')
    // 8 + 8 = 16, mod 11 = 5.
    expect(coords()).toHaveLength(11)
    expect(coords()[0]).toEqual(ring[5])
    expect(second.text).not.toBe(first.text)
    // Same vertices, same cyclic order, different start point.
    const lines = (t: string) => t.trim().split('\n').slice(1)
    expect(lines(first.text)).toHaveLength(11)
    expect(lines(second.text)).toHaveLength(11)
    const latLon = (t: string) => lines(t).map((l) => l.split(' ').slice(8, 10).join(' '))
    const rotate = (a: string[], k: number) => [...a.slice(k), ...a.slice(0, k)]
    expect(rotate(latLon(first.text), 8)).toEqual(latLon(second.text))
    expect(new Set(latLon(first.text))).toEqual(new Set(latLon(second.text)))
  })

  it('still crops the edited (unclosed) ring without failing', async () => {
    const up = loadUpstream()
    await up.request(bounds, 12, overpassWays([{ id: 1, tags: { natural: 'water' }, ring: closedRing(11) }]))
    await up.generateFence(up.features()[0]!, 'Lake')
    up.addCrop(bounds, wholeView)
    const layers = up.layers()
    expect(layers).toHaveLength(1)
    expect(layers[0]!.feature.geometry.type).toBe('Polygon')
  })
})

describe('Geofence Generator: only the first / and \\ replaced in file names', () => {
  it('offers A/B/C\\D\\E as A_B/C_D\\E.waypoints', async () => {
    const up = loadUpstream()
    const file = await up.generateFence(polygonFeature(closedRing(11)), 'A/B/C\\D\\E')
    expect(file.fileName).toBe('A_B/C_D\\E.waypoints')
  })
})

describe('Geofence Generator: crop stops at a non-polygon feature', () => {
  it('throws on an unclosed natural=water way after cropping every polygon', async () => {
    const up = loadUpstream()
    const line = [
      [0.3, 0.3],
      [0.4, 0.3],
      [0.4, 0.4]
    ]
    // The line is listed first in the response; osmtogeojson still emits polygons before lines.
    await up.request(
      bounds,
      12,
      overpassWays([
        { id: 1, tags: { natural: 'water' }, ring: line },
        { id: 2, tags: { natural: 'water' }, ring: closedRing(11) }
      ])
    )
    expect(up.features().map((f) => [f.id, f.geometry.type])).toEqual([
      ['way/2', 'Polygon'],
      ['way/1', 'LineString']
    ])
    expect(() => up.addCrop(bounds, wholeView)).toThrow('Input geometry is not a valid Polygon or MultiPolygon')
    // Every polygon was cropped and shown before the throw.
    expect(up.layers().map((l) => l.feature.id)).toEqual(['way/2'])
  })
})

describe('Geofence Generator: failed search keeps the previous features', () => {
  it('clears the map, rejects, and Crop brings the previous search back', async () => {
    const up = loadUpstream()
    await up.request(bounds, 12, overpassWays([{ id: 2, tags: { natural: 'water' }, ring: closedRing(11) }]))
    expect(up.layers()).toHaveLength(1)
    const reason = await up.requestFailing(bounds, 12)
    expect(reason).toBeInstanceOf(TypeError)
    expect(up.layers()).toHaveLength(0)
    expect(up.features().map((f) => f.id)).toEqual(['way/2'])
    up.addCrop(bounds, wholeView)
    expect(up.layers().map((l) => l.feature.id)).toEqual(['way/2'])
  })
})

describe('Geofence Generator: wrap_180 does not wrap below -180', () => {
  it('returns -200 for -200 (160 expected) and wraps +200 correctly', () => {
    const up = loadUpstream()
    expect(up.wrap_180(-200)).toBe(-200)
    expect(up.wrap_180(200)).toBe(-160)
    expect(up.wrap_180(180)).toBe(-180)
  })

  it('makes convertToCartesian asymmetric across the antimeridian', () => {
    const up = loadUpstream()
    // 0.002 deg of longitude apart on the equator in both cases.
    expect(up.convertToCartesian([[-179.999, 0]], 1, [179.999, 0]).y[0]).toBe(-40074561.570032075)
    expect(up.convertToCartesian([[179.999, 0]], 1, [-179.999, 0]).y[0]).toBe(-222.637690037636)
  })
})
