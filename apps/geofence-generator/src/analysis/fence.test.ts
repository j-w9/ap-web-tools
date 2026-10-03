import { describe, expect, it } from 'vitest'
import { FENCE_COMMANDS, fenceFileName, fencePointCount, formatWaypoints, generateFence, type Fence } from './fence.js'
import { openRing, type PolygonRings, type Ring } from './geo.js'
import { segmentsIntersect } from './simplify.js'
import { loadUpstream } from '../test-utils/upstream.js'
import { lakeRing, plainRings } from '../test-utils/fixtures.js'

const upstream = loadUpstream()

/**
 * Upstream drops the closing point then rotates each ring left by 228 places before simplifying
 * (a debugging leftover the port omits). Feeding the port pre-rotated rings makes the two match.
 */
function rotatedLikeUpstream(rings: PolygonRings): Ring[] {
  return rings.map((ring) => {
    const open = openRing(ring)
    const k = 228 % open.length
    return [...open.slice(k), ...open.slice(0, k)]
  })
}

async function upstreamFile(rings: PolygonRings, name: string) {
  return upstream.generateFence(
    { id: 'way/1', type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: plainRings(rings) } },
    name
  )
}

// Upstream converts about the first vertex of the original outer ring, so the outer rings here
// have a vertex count that divides 228 (the rotation is then a no-op on them); holes can be any size.
const cases: [string, Ring[]][] = [
  ['a lake', [lakeRing(228, 8.5, 47.3, 1500, 31)]],
  [
    'a lake with islands',
    [lakeRing(228, 8.5, 47.3, 2000, 32), lakeRing(170, 8.5, 47.305, 300, 33), lakeRing(35, 8.51, 47.295, 90, 34)]
  ],
  ['a small pond', [lakeRing(19, -1.2, 52.1, 40, 35)]],
  ['a round pond', [lakeRing(76, -1.2, 52.1, 3, 36, 0)]],
  [
    'a lake with a round island',
    [lakeRing(114, 8.5, 47.3, 2000, 37), lakeRing(60, 8.5, 47.3, 3, 38, 0), lakeRing(301, 8.49, 47.3, 300, 39)]
  ],
  ['a lake near the antimeridian', [lakeRing(228, 179.98, -16.5, 1200, 39), lakeRing(250, 179.98, -16.5, 400, 40)]]
]

describe('fence file matches upstream generate_fence', () => {
  it.each(cases)('with the corrected segment test: %s', async (_, rings) => {
    upstream.setLineIntersects((a, b, c, d) => segmentsIntersect([a[0]!, a[1]!], [b[0]!, b[1]!], [c[0]!, c[1]!], [d[0]!, d[1]!]))
    const theirs = await upstreamFile(rings, 'Lake')
    expect(formatWaypoints(generateFence(rotatedLikeUpstream(rings)))).toBe(theirs.text)
  })

  it.each(cases)('with upstream’s always-false segment test: %s', async (_, rings) => {
    upstream.setLineIntersects(() => false)
    const theirs = await upstreamFile(rings, 'Lake')
    expect(formatWaypoints(generateFence(rotatedLikeUpstream(rings), () => false))).toBe(theirs.text)
  })
})

describe('generateFence', () => {
  it('makes the outer ring an inclusion and holes exclusions', () => {
    const fence = generateFence([lakeRing(400, 8.5, 47.3, 2000, 40), lakeRing(60, 8.5, 47.305, 200, 41)])
    expect(fence.map((f) => f.role)).toEqual(['inclusion', 'exclusion'])
  })

  it('does not mutate its input', () => {
    const rings = [lakeRing(300, 8.5, 47.3, 1500, 42)]
    const copy = plainRings(rings)
    generateFence(rings)
    expect(plainRings(rings)).toEqual(copy)
  })

  it('returns no items for an empty polygon', () => {
    expect(generateFence([])).toEqual([])
  })
})

describe('formatWaypoints', () => {
  it('writes polygon vertices and circles with the fence commands', () => {
    const fence: Fence = [
      {
        kind: 'polygon',
        role: 'inclusion',
        vertices: [
          { lat: 1, lon: 2 },
          { lat: 1.5, lon: 2 },
          { lat: 1.5, lon: 2.5 }
        ]
      },
      { kind: 'circle', role: 'exclusion', center: { lat: 1.2, lon: 2.1 }, radiusM: 12.5 }
    ]
    expect(formatWaypoints(fence)).toBe(
      [
        'QGC WPL 110',
        '1 0 3 5001 3 0 0 0 1.000000 2.000000 0 1',
        '2 0 3 5001 3 0 0 0 1.500000 2.000000 1 1',
        '3 0 3 5001 3 0 0 0 1.500000 2.500000 2 1',
        '4 0 3 5004 12.5 0 0 0 1.200000 2.100000 0 1',
        ''
      ].join('\n')
    )
    expect(fencePointCount(fence)).toBe(4)
    expect(FENCE_COMMANDS.circle.inclusion).toBe(5003)
  })
})

describe('fenceFileName', () => {
  it('replaces every path separator', async () => {
    expect(fenceFileName('A/B/C\\D')).toBe('A_B_C_D.waypoints')
    // Upstream only replaces the first of each.
    const theirs = await upstreamFile([lakeRing(19, 0, 0, 40, 1)], 'A/B')
    expect(theirs.fileName).toBe('A_B.waypoints')
    expect(fenceFileName('A/B')).toBe(theirs.fileName)
  })
})
