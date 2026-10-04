import { describe, expect, it } from 'vitest'
import {
  FENCE_COMMANDS,
  fenceFileName,
  fencePointCount,
  formatWaypoints,
  generateFence,
  previewFence,
  type Fence
} from './fence.js'
import type { PolygonRings, Ring } from './geo.js'
import { loadUpstream, type UpstreamFeature } from '../test-utils/upstream.js'
import { lakeRing, plainRings } from '../test-utils/fixtures.js'

const upstream = loadUpstream()

function feature(rings: readonly Ring[], name: string): UpstreamFeature {
  return { id: 'way/1', type: 'Feature', properties: { name }, geometry: { type: 'Polygon', coordinates: plainRings(rings) } }
}

/** The port's own copy of the rings, in the mutable form a feature from osmtogeojson has. */
function portRings(rings: readonly Ring[]): PolygonRings {
  return rings.map((ring) => ring.map(([lon, lat]): [number, number] => [lon, lat]))
}

const cases: [string, Ring[]][] = [
  ['a lake', [lakeRing(500, 8.5, 47.3, 1500, 31)]],
  [
    'a lake with islands',
    [lakeRing(400, 8.5, 47.3, 2000, 32), lakeRing(170, 8.5, 47.305, 300, 33), lakeRing(35, 8.51, 47.295, 90, 34)]
  ],
  ['a small pond', [lakeRing(19, -1.2, 52.1, 40, 35)]],
  ['a round pond', [lakeRing(76, -1.2, 52.1, 3, 36, 0)]],
  [
    'a lake with a round island',
    [lakeRing(114, 8.5, 47.3, 2000, 37), lakeRing(60, 8.5, 47.3, 3, 38, 0), lakeRing(301, 8.49, 47.3, 300, 39)]
  ],
  ['a lake near the antimeridian', [lakeRing(228, 179.98, -16.5, 1200, 39), lakeRing(250, 179.98, -16.5, 400, 40)]],
  ['a ring longer than 228 that does not divide it', [lakeRing(1001, 18.1, 69.6, 3000, 41)]]
]

describe('fence file matches upstream generate_fence', () => {
  it.each(cases)('%s', async (_, rings) => {
    const theirs = await upstream.generateFence(feature(rings, 'Lake'), 'Lake')
    expect(formatWaypoints(generateFence(portRings(rings)))).toBe(theirs.text)
  })

  it.each(cases)('repeated downloads rotate the rings in place, as upstream: %s', async (_, rings) => {
    const theirFeature = feature(rings, 'Lake')
    const mine = portRings(rings)
    for (let download = 0; download < 3; download++) {
      const preview = formatWaypoints(previewFence(mine))
      const theirs = await upstream.generateFence(theirFeature, 'Lake')
      const text = formatWaypoints(generateFence(mine))
      expect(text).toBe(theirs.text)
      // The preview is exactly the next download.
      expect(preview).toBe(text)
      expect(mine).toEqual(theirFeature.geometry.coordinates)
    }
  })
})

describe('generateFence', () => {
  it('makes the outer ring an inclusion and holes exclusions', () => {
    const fence = generateFence(portRings([lakeRing(400, 8.5, 47.3, 2000, 40), lakeRing(60, 8.5, 47.305, 200, 41)]))
    expect(fence.map((f) => f.role)).toEqual(['inclusion', 'exclusion'])
  })

  it('drops the closing point once, then rotates by 228 on every call', () => {
    const rings = portRings([lakeRing(300, 8.5, 47.3, 1500, 42)])
    const open = rings[0]!.slice(0, -1)
    generateFence(rings)
    expect(rings[0]).toEqual([...open.slice(228), ...open.slice(0, 228)])
    generateFence(rings)
    const k = 456 % open.length
    expect(rings[0]).toEqual([...open.slice(k), ...open.slice(0, k)])
  })

  it('previewFence leaves its input alone', () => {
    const rings = portRings([lakeRing(300, 8.5, 47.3, 1500, 43)])
    const copy = plainRings(rings)
    previewFence(rings)
    expect(plainRings(rings)).toEqual(copy)
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
  it.each(['A/B', 'plain', 'A\\B', 'A/B\\C'])('matches upstream with at most one / and one \\: %s', async (name) => {
    const theirs = await upstream.generateFence(feature([lakeRing(19, 0, 0, 40, 1)], name), name)
    expect(fenceFileName(name)).toBe(theirs.fileName)
  })

  it.each([
    ['A/B/C\\D\\E', 'A_B/C_D\\E.waypoints', 'A_B_C_D_E.waypoints'],
    ['\\/x/', '__x/.waypoints', '__x_.waypoints']
  ])('replaces every / and \\ (proven bug fixed; upstream only the first): %s', async (name, upstreamName, portName) => {
    const theirs = await upstream.generateFence(feature([lakeRing(19, 0, 0, 40, 1)], name), name)
    expect(theirs.fileName).toBe(upstreamName)
    expect(fenceFileName(name)).toBe(portName)
  })
})
