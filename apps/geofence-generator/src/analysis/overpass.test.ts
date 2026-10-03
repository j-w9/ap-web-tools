import { describe, expect, it } from 'vitest'
import { splitPolygons } from './features.js'
import { buildOverpassQuery, overpassRequestBody, parseOverpassResponse } from './overpass.js'
import { loadUpstream, type UpstreamFeature } from '../test-utils/upstream.js'
import { lakeRing, overpassJson, overpassXml, type OsmFixtureElement } from '../test-utils/fixtures.js'

const bounds = { south: 47.25, west: 8.45, north: 47.35, east: 8.6 }

const elements: OsmFixtureElement[] = [
  {
    kind: 'way',
    id: 101,
    tags: { natural: 'water', water: 'pond', name: 'Mill pond', 'name:de': 'Mühleweiher' },
    ring: lakeRing(40, 8.52, 47.31, 80, 1)
  },
  { kind: 'way', id: 102, tags: { landuse: 'reservoir' }, ring: lakeRing(25, 8.55, 47.28, 60, 2) },
  {
    kind: 'relation',
    id: 201,
    tags: { type: 'multipolygon', natural: 'water', water: 'lake', name: 'Lake & "Islands"' },
    members: [
      { ref: 301, role: 'outer', ring: lakeRing(120, 8.5, 47.3, 1500, 3) },
      { ref: 302, role: 'inner', ring: lakeRing(30, 8.5, 47.3, 200, 4) },
      { ref: 303, role: 'outer', ring: lakeRing(60, 8.58, 47.33, 300, 5) }
    ]
  }
]

function normalise(
  features: readonly {
    id: string
    polygons: readonly (readonly (readonly (readonly number[])[])[])[]
    tags: Record<string, string>
  }[]
) {
  return features.map((f) => ({
    id: f.id,
    tags: f.tags,
    polygons: f.polygons.map((p) => p.map((r) => r.map((q) => [q[0], q[1]])))
  }))
}

function upstreamPolygons(f: UpstreamFeature): number[][][][] {
  const coords = f.geometry.coordinates as number[][][] | number[][][][]
  return f.geometry.type === 'Polygon' ? [coords as number[][][]] : (coords as number[][][][])
}

function upstreamTags(f: UpstreamFeature): Record<string, string> {
  return Object.fromEntries(Object.entries(f.properties).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

describe('Overpass request matches upstream', async () => {
  const upstream = loadUpstream()
  const theirs = await upstream.request(bounds, 12, overpassXml(elements))

  it('queries the same endpoint with the same query, plus [out:json]', () => {
    expect(theirs.url).toBe('https://overpass-api.de/api/interpreter')
    const theirQuery = decodeURIComponent(theirs.body.replace(/^data=/, ''))
    expect(buildOverpassQuery(bounds)).toBe(`[out:json]${theirQuery}`)
    expect(overpassRequestBody(bounds)).toBe(`data=${encodeURIComponent(`[out:json]${theirQuery}`)}`)
  })

  it('parses the JSON response into the features upstream gets from XML', () => {
    const mine = parseOverpassResponse(overpassJson(elements))
    expect(mine.ok).toBe(true)
    if (!mine.ok) return
    const expected = theirs.features.map((f) => ({ id: f.id, tags: upstreamTags(f), polygons: upstreamPolygons(f) }))
    expect(normalise(mine.features)).toEqual(expected)
    expect(mine.features.map((f) => f.id)).toEqual(['relation/201', 'way/101', 'way/102'])
  })

  it('splits multipolygons into one map polygon per part, as upstream add_feature', () => {
    const mine = parseOverpassResponse(overpassJson(elements))
    if (!mine.ok) throw new Error(mine.error)
    const polygons = splitPolygons(mine.features)
    expect(polygons.map((p) => p.rings.map((r) => r.map((q) => [q[0], q[1]])))).toEqual(
      theirs.layers.map((l) => l.geometry.coordinates)
    )
    expect(polygons.map((p) => p.key)).toEqual(['relation/201#0', 'relation/201#1', 'way/101#0', 'way/102#0'])
    expect(polygons.map((p) => p.rings.length)).toEqual([1, 2, 1, 1])
  })
})

describe('parseOverpassResponse errors', () => {
  it('rejects responses without elements', () => {
    expect(parseOverpassResponse({ foo: 1 }).ok).toBe(false)
    expect(parseOverpassResponse('nope').ok).toBe(false)
  })

  it('reports Overpass runtime errors', () => {
    const result = parseOverpassResponse({
      elements: [],
      remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.'
    })
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('Query timed out') as string
    })
  })

  it('returns an empty list when nothing is found', () => {
    expect(parseOverpassResponse({ elements: [] })).toEqual({ ok: true, features: [] })
  })
})
