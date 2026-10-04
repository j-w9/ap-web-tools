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
      // Upstream leaves angles below -180 unwrapped (proven bug); elsewhere identical.
      if (angle >= -180) expect(wrap180(angle)).toBe(upstream.wrap_180(angle))
      else {
        expect(wrap180(angle)).toBeGreaterThanOrEqual(-180)
        expect(wrap180(angle)).toBeLessThan(180)
      }
      expect(longitudeScale(lat)).toBe(upstream.longitude_scale(lat))
    }
    expect(longitudeScale(90)).toBe(0.01)
  })

  it('wraps angles below -180 (proven bug fixed): -200 is 160, upstream -200', () => {
    expect(upstream.wrap_180(-200)).toBe(-200)
    expect(wrap180(-200)).toBe(160)
    expect(upstream.wrap_180(-600)).toBe(-240)
    expect(wrap180(-600)).toBe(120)
    for (const a of [-180, -179.999, 0, 179.999, 180, 200, 540, 1e6]) expect(wrap180(a)).toBe(upstream.wrap_180(a))
  })

  it('converts across the antimeridian symmetrically; upstream does not (proven bug fixed)', () => {
    const theirs = upstream.convertToCartesian([[-179.999, 0]], 1, [179.999, 0])
    expect(theirs.y[0]).toBe(-40074561.570032075)
    const mine = toCartesian([[-179.999, 0]], [179.999, 0])
    const mirror = toCartesian([[179.999, 0]], [-179.999, 0])
    expect(mirror.y[0]).toBe(upstream.convertToCartesian([[179.999, 0]], 1, [-179.999, 0]).y[0])
    expect(mirror.y[0]).toBeCloseTo(-222.637690037636, 6)
    expect(mine.y[0]).toBeCloseTo(222.637690037636, 6)
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
