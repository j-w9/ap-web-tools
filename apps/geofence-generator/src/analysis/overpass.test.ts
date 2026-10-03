import { describe, expect, it } from 'vitest'
import { splitPolygons } from './features.js'
import { buildOverpassQuery, featuresFromXml, overpassRemark, overpassRequestBody } from './overpass.js'
import { loadUpstream } from '../test-utils/upstream.js'
import { bounds, elements, overpassXml, parseXml } from '../test-utils/fixtures.js'

describe('Overpass request matches upstream', async () => {
  const upstream = loadUpstream()
  const theirs = await upstream.request(bounds, 12, overpassXml(elements))

  it('posts the same body to the same endpoint, with no extra options', () => {
    expect(theirs.url).toBe('https://overpass-api.de/api/interpreter')
    expect(overpassRequestBody(bounds)).toBe(theirs.body)
    expect(decodeURIComponent(theirs.body.replace(/^data=/, ''))).toBe(buildOverpassQuery(bounds))
    expect(Object.keys(theirs.init).sort()).toEqual(['body', 'method'])
  })

  it('parses the XML response into the features upstream gets', () => {
    const mine = featuresFromXml(parseXml(overpassXml(elements)))
    expect(mine).toEqual(upstream.features())
    expect(mine.map((f) => f.id)).toEqual(['relation/201', 'way/101', 'way/102'])
  })

  it('splits multipolygons into one map polygon per part, as upstream add_feature', () => {
    const polygons = splitPolygons(featuresFromXml(parseXml(overpassXml(elements))))
    expect(polygons.map((p) => p.rings)).toEqual(upstream.layers().map((l) => l.feature.geometry.coordinates))
    expect(polygons.map((p) => p.key)).toEqual(['relation/201#0', 'relation/201#1', 'way/101#0', 'way/102#0'])
    expect(polygons.map((p) => p.rings.length)).toEqual([1, 2, 1, 1])
  })
})

describe('Overpass responses upstream accepts without complaint', () => {
  it.each([
    ['an HTML error page', '<html><body><p>429 Too Many Requests</p></body></html>'],
    ['a runtime-error remark', '<?xml version="1.0"?><osm><remark> runtime error: Query timed out </remark></osm>'],
    ['an empty result', '<?xml version="1.0"?><osm></osm>']
  ])('%s gives the same (empty) features', async (_, text) => {
    const upstream = loadUpstream()
    await upstream.request(bounds, 12, text)
    expect(featuresFromXml(parseXml(text))).toEqual(upstream.features())
    expect(upstream.features()).toEqual([])
  })

  it('reads the remark for the notice', () => {
    expect(overpassRemark(parseXml('<osm><remark> runtime error: x </remark></osm>'))).toBe('runtime error: x')
    expect(overpassRemark(parseXml('<osm></osm>'))).toBeNull()
  })
})

describe('a failed request', () => {
  it('leaves upstream with its old features, no polygons on the map and no crop', async () => {
    const upstream = loadUpstream()
    await upstream.request(bounds, 12, overpassXml(elements))
    const before = upstream.features()
    upstream.addCrop(bounds, (ll) => ({ x: ll.lng, y: -ll.lat }), [
      [8.4, 47.2],
      [8.7, 47.2],
      [8.7, 47.4],
      [8.4, 47.4],
      [8.4, 47.2]
    ])
    expect(upstream.hasCrop()).toBe(true)
    const error = await upstream.requestFailing(bounds, 12)
    expect(error).toBeInstanceOf(Error)
    expect(upstream.features()).toBe(before)
    expect(upstream.layers()).toEqual([])
    expect(upstream.hasCrop()).toBe(false)
  })
})
