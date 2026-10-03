import { describe, expect, it } from 'vitest'
import { cropFeatures, featureName, geometryPolygons, osmUrl, pointCount, splitPolygons, type WaterFeature } from './features.js'
import type { Ring } from './geo.js'

const square = (x0: number, y0: number, size: number): Ring => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
  [x0, y0]
]

const features: WaterFeature[] = [
  { id: 'way/1', tags: { name: 'A' }, polygons: [[square(0, 0, 1)]] },
  { id: 'relation/2', tags: { name: 'B' }, polygons: [[square(2, 0, 1)], [square(4, 0, 1), square(4.25, 0.25, 0.5)]] },
  { id: 'way/3', tags: {}, polygons: [[square(10, 10, 1)]] }
]

describe('featureName', () => {
  it('prefers the name in the user language, then the local name', () => {
    expect(featureName({ name: 'Lac Léman', 'name:en': 'Lake Geneva' }, 'en-GB')).toEqual({
      label: 'Lake Geneva (Lac Léman)',
      fileName: 'Lake Geneva'
    })
    expect(featureName({ name: 'Lac Léman', 'name:en': 'Lake Geneva' }, 'fr')).toEqual({
      label: 'Lac Léman',
      fileName: 'Lac Léman'
    })
    expect(featureName({ 'name:de': 'See' }, 'de-CH')).toEqual({ label: 'See', fileName: 'See' })
    expect(featureName({}, 'en')).toEqual({ label: 'unknown', fileName: 'unknown' })
  })
})

describe('feature helpers', () => {
  it('counts points including closing duplicates', () => {
    expect(pointCount([square(0, 0, 1), square(0, 0, 0.5)])).toBe(10)
  })

  it('links to OpenStreetMap', () => {
    expect(osmUrl('way/1')).toBe('https://www.openstreetmap.org/way/1')
  })

  it('splits features into polygons', () => {
    expect(splitPolygons(features).map((p) => p.key)).toEqual(['way/1#0', 'relation/2#0', 'relation/2#1', 'way/3#0'])
  })

  it('narrows only polygon geometry', () => {
    expect(
      geometryPolygons({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1]
        ]
      })
    ).toBeNull()
    expect(
      geometryPolygons({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            ['x', 1],
            [0, 0]
          ]
        ]
      })
    ).toBeNull()
    expect(geometryPolygons({ type: 'Polygon', coordinates: [square(0, 0, 1)] })).toHaveLength(1)
  })
})

describe('cropFeatures', () => {
  it('clips to the crop polygon and drops features outside it', () => {
    const crop: Ring = [
      [0.5, -1],
      [4.5, -1],
      [4.5, 2],
      [0.5, 2]
    ]
    const cropped = cropFeatures(features, crop)
    expect(cropped.map((f) => f.id)).toEqual(['way/1', 'relation/2'])
    expect(cropped[0]?.tags).toEqual({ name: 'A' })
    const xs = cropped[0]?.polygons[0]?.[0]?.map((p) => p[0]) ?? []
    expect(Math.min(...xs)).toBeCloseTo(0.5)
    expect(Math.max(...xs)).toBeCloseTo(1)
    // The second part of B is cut through its hole, leaving a C shape.
    expect(cropped[1]?.polygons).toHaveLength(2)
  })
})
