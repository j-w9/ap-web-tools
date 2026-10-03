import { beforeAll, describe, expect, it } from 'vitest'
import { expectSameArray, expectSameNumber } from '../test-utils/compare.js'
import { rng } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, type UpstreamMagfit } from '../test-utils/upstream.js'
import { earthFieldAngles, expectedEarthField, interpolateTable } from './wmm.js'
import { DECLINATION_TABLE, INCLINATION_TABLE, INTENSITY_TABLE } from './wmm-tables.js'

interface UpField {
  declination: number
  inclination: number
  intensity: number
  vector: number[]
}

describe('wmm', () => {
  let up: UpstreamMagfit
  beforeAll(async () => {
    up = await createUpstreamMagfit()
  })

  it('ships the upstream tables unchanged', () => {
    for (const [mine, name] of [
      [DECLINATION_TABLE, 'declination_table'],
      [INCLINATION_TABLE, 'inclination_table'],
      [INTENSITY_TABLE, 'intensity_table']
    ] as const) {
      const theirs = up.evaluate<number[][]>(name)
      expect(mine.length).toBe(19)
      expect(mine.map((r) => [...r])).toEqual(theirs.map((r) => [...r]))
    }
  })

  it('matches upstream expected_earth_field_lat_lon over the globe', () => {
    const next = rng(7)
    const points: [number, number][] = [
      [-35.3632621, 149.1652374],
      [0, 0],
      [-90, -180],
      [89.999, 179.999],
      [51.5, -0.12],
      [-10, 10]
    ]
    for (let i = 0; i < 500; i++) points.push([-90 + 180 * next(), -180 + 360 * next()])
    for (const [lat, lon] of points) {
      const theirs = up.evaluate<UpField>(`expected_earth_field_lat_lon(${lat}, ${lon})`)
      const mine = expectedEarthField(lat, lon)!
      const label = `${lat},${lon}`
      expectSameNumber(mine.declination, theirs.declination, `${label} declination`)
      expectSameNumber(mine.inclination, theirs.inclination, `${label} inclination`)
      expectSameNumber(mine.intensity, theirs.intensity, `${label} intensity`)
      expectSameArray(mine.vector, theirs.vector, `${label} vector`)
    }
  })

  it('returns undefined off the table or without a location', () => {
    for (const [lat, lon] of [
      [90, 0],
      [-90.1, 0],
      [0, 180],
      [0, -180.5]
    ]) {
      expect(expectedEarthField(lat, lon)).toBeUndefined()
      expect(up.evaluate(`expected_earth_field_lat_lon(${lat}, ${lon})`)).toBeUndefined()
    }
    expect(expectedEarthField(undefined, 10)).toBeUndefined()
    expect(earthFieldAngles(NaN, 0)).toBeUndefined()
  })

  it('interpolates exactly on grid points', () => {
    expect(interpolateTable(INTENSITY_TABLE, -30, 150)).toBe(INTENSITY_TABLE[6]![33])
    // The field at Canberra is roughly 58 uT pointing north-east and steeply up.
    const f = expectedEarthField(-35.36, 149.17)!
    expect(f.intensity).toBeCloseTo(0.58, 2)
    expect(f.vector[2]).toBeLessThan(0)
  })
})
