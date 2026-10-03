import { describe, expect, it } from 'vitest'
import {
  cropFeatures,
  featureName,
  osmUrl,
  pointCount,
  splitPolygons,
  tagsOf,
  type OsmFeature,
  type WaterPolygon
} from './features.js'
import { fenceFileName, formatWaypoints, generateFence } from './fence.js'
import type { Ring } from './geo.js'
import { featuresFromXml } from './overpass.js'
import { loadUpstream, type Upstream } from '../test-utils/upstream.js'
import { bounds, elements, lakeRing, overpassXml, parseXml, type OsmFixtureElement } from '../test-utils/fixtures.js'

/** A projection stand-in: any monotonic map works, as the crop ring itself is given. */
const project = (ll: { lat: number; lng: number }) => ({ x: ll.lng * 1000, y: -ll.lat * 1000 })

const cropA: Ring = [
  [8.51, 47.27],
  [8.56, 47.27],
  [8.56, 47.32],
  [8.51, 47.32],
  [8.51, 47.27]
]
const cropB: Ring = [
  [8.49, 47.29],
  [8.6, 47.25],
  [8.6, 47.34],
  [8.53, 47.34],
  [8.49, 47.29]
]

/** Popup lines as upstream builds them, from the port's name and point count. */
function popupLines(polygon: WaterPolygon): string[] {
  return [`Name: ${featureName(polygon.tags, 'en-GB').label}`, `Points: ${String(pointCount(polygon.rings))}`]
}

async function searched(xml: string): Promise<{ upstream: Upstream; features: OsmFeature[] }> {
  const upstream = loadUpstream()
  await upstream.request(bounds, 12, xml)
  return { upstream, features: featuresFromXml(parseXml(xml)) }
}

describe('map polygons and popups match upstream', () => {
  it('after a search', async () => {
    const { upstream, features } = await searched(overpassXml(elements))
    const mine = splitPolygons(features)
    const theirs = upstream.layers()
    expect(mine.map((p) => p.rings)).toEqual(theirs.map((l) => l.feature.geometry.coordinates))
    expect(mine.map(popupLines)).toEqual(theirs.map((l) => l.popup().lines))
  })

  it('downloads from popups: same files, same in-place edits, same point counts afterwards', async () => {
    const { upstream, features } = await searched(overpassXml(elements))
    const mine = splitPolygons(features)
    for (const round of [0, 1]) {
      for (const [i, layer] of upstream.layers().entries()) {
        const polygon = mine[i]!
        const theirs = await layer.popup().download()
        const text = formatWaypoints(generateFence(polygon.rings))
        expect(text, `round ${String(round)} layer ${String(i)}`).toBe(theirs.text)
        expect(fenceFileName(featureName(polygon.tags, 'en-GB').fileName)).toBe(theirs.fileName)
      }
      // The edits reach the stored features too (the layers share their arrays).
      expect(features).toEqual(upstream.features())
      expect(mine.map(popupLines)).toEqual(upstream.layers().map((l) => l.popup().lines))
    }
  })
})

describe('cropping matches upstream add_crop / apply_crop', () => {
  it('crops every feature, keeping ids and properties', async () => {
    const { upstream, features } = await searched(overpassXml(elements))
    upstream.addCrop(bounds, project, cropA)
    const result = cropFeatures(features, cropA)
    expect(result.error).toBeNull()
    const mine = splitPolygons(result.features)
    const theirs = upstream.layers()
    expect(mine.map((p) => p.rings)).toEqual(theirs.map((l) => l.feature.geometry.coordinates))
    expect(mine.map((p) => p.featureId)).toEqual(theirs.map((l) => String(l.feature.id)))
    expect(mine.map(popupLines)).toEqual(theirs.map((l) => l.popup().lines))
    for (const [i, layer] of theirs.entries()) {
      expect(formatWaypoints(generateFence(mine[i]!.rings))).toBe((await layer.popup().download()).text)
    }
  })

  it('re-crops from the stored features when the crop is dragged, after downloads edited them', async () => {
    const { upstream, features } = await searched(overpassXml(elements))
    const mine = splitPolygons(features)
    for (const [i, layer] of upstream.layers().entries()) {
      await layer.popup().download()
      generateFence(mine[i]!.rings)
    }
    upstream.addCrop(bounds, project, cropA)
    upstream.dragCrop(cropB)
    const result = cropFeatures(features, cropB)
    const cropped = splitPolygons(result.features)
    const theirs = upstream.layers()
    expect(cropped.map((p) => p.rings)).toEqual(theirs.map((l) => l.feature.geometry.coordinates))
    for (const [i, layer] of theirs.entries()) {
      expect(formatWaypoints(generateFence(cropped[i]!.rings))).toBe((await layer.popup().download()).text)
    }
  })

  it('stops at a feature that is not a polygon, as upstream throws there', async () => {
    const withLine: OsmFixtureElement[] = [
      { kind: 'way', id: 102, tags: { landuse: 'reservoir' }, ring: lakeRing(25, 8.55, 47.28, 60, 2) },
      // An unclosed natural=water way: osmtogeojson makes it a LineString.
      { kind: 'way', id: 103, tags: { natural: 'water' }, ring: lakeRing(25, 8.53, 47.29, 60, 6).slice(0, 10) },
      { kind: 'way', id: 104, tags: { natural: 'water' }, ring: lakeRing(25, 8.54, 47.3, 60, 7) }
    ]
    const { upstream, features } = await searched(overpassXml(withLine))
    expect(features.map((f) => f.geometry.type).sort()).toEqual(['LineString', 'Polygon', 'Polygon'])
    expect(() => upstream.addCrop(bounds, project, cropA)).toThrow()
    const result = cropFeatures(features, cropA)
    expect(result.error).not.toBeNull()
    expect(splitPolygons(result.features).map((p) => p.rings)).toEqual(
      upstream.layers().map((l) => l.feature.geometry.coordinates)
    )
  })
})

describe('feature helpers', () => {
  it('names a feature like upstream create_popup', () => {
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

  it('keeps string properties as tags', () => {
    expect(tagsOf({ name: 'A', n: 1 })).toEqual({ name: 'A' })
    expect(tagsOf(null)).toEqual({})
  })

  it('links to OpenStreetMap', () => {
    expect(osmUrl('way/1')).toBe('https://www.openstreetmap.org/way/1')
  })
})
