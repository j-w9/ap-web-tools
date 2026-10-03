import { describe, expect, it } from 'vitest'
import { fromCartesian, longitudeScale, toCartesian, wrap180 } from './cartesian.js'
import { openRing } from './geo.js'
import { loadUpstream, rng } from '../test-utils/upstream.js'
import { lakeRing, plainRings } from '../test-utils/fixtures.js'

const upstream = loadUpstream()

describe('cartesian conversion matches upstream', () => {
  it('wrap180 and longitudeScale', () => {
    const next = rng(1)
    for (let i = 0; i < 200; i++) {
      const angle = (next() - 0.5) * 800
      const lat = (next() - 0.5) * 180
      expect(wrap180(angle)).toBe(upstream.wrap_180(angle))
      expect(longitudeScale(lat)).toBe(upstream.longitude_scale(lat))
    }
    expect(longitudeScale(90)).toBe(0.01)
  })

  it.each([
    [0.5, 51.5],
    [-122.4, 37.8],
    [179.99, -45],
    [18.1, 69.6]
  ])('round trip near (%f, %f)', (lon, lat) => {
    const ring = openRing(lakeRing(300, lon, lat, 2000, 7))
    const origin = ring[0]!
    const mine = toCartesian(ring, origin)
    const theirs = upstream.convertToCartesian(plainRings([ring])[0]!, ring.length, [origin[0], origin[1]])
    expect(mine.x).toEqual(theirs.x)
    expect(mine.y).toEqual(theirs.y)

    const back = fromCartesian(mine.x, mine.y, origin)
    const theirsBack = upstream.convertFromCartesian(theirs.x, theirs.y, [origin[0], origin[1]])
    expect(back.map((p) => p.lat)).toEqual(theirsBack.lat)
    expect(back.map((p) => p.lon)).toEqual(theirsBack.lon)
    // The flat-earth round trip is accurate to well under a centimetre at lake scale.
    back.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(ring[i]![1], 7)
      expect(wrap180(p.lon - ring[i]![0] + 360)).toBeCloseTo(0, 6)
    })
  })
})
