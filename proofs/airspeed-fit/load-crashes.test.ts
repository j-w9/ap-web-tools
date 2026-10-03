// Row: "BARO without instance field or missing EKF/STAT columns crash the load".
import { describe, expect, it } from 'vitest'
import { createUpstreamTool, upstreamLoad } from './_harness.js'
import { buildSyntheticAirspeedLog } from './_log.js'

describe('AirspeedFit: load', () => {
  it('loads the complete synthetic log', async () => {
    const up = await createUpstreamTool()
    await upstreamLoad(up, buildSyntheticAirspeedLog({ flightSeconds: 120 }))
    expect(up.alerts).toEqual([])
    expect(up.evaluate('ASP_Data.length')).toBe(2)
  })

  it('throws on a BARO message without an instance field', async () => {
    const up = await createUpstreamTool()
    await expect(upstreamLoad(up, buildSyntheticAirspeedLog({ flightSeconds: 120, baroNoInstance: true }))).rejects.toThrow(
      "Cannot use 'in' operator to search for '0' in undefined"
    )
    expect(up.alerts).toEqual([])
  })

  it('throws on XKF1 without velocity columns', async () => {
    const up = await createUpstreamTool()
    await expect(upstreamLoad(up, buildSyntheticAirspeedLog({ flightSeconds: 120, xkfNoVelocity: true }))).rejects.toThrow(
      'undefined is not iterable'
    )
    expect(up.alerts).toEqual([])
  })

  it('throws on STAT without isFlying', async () => {
    const up = await createUpstreamTool()
    await expect(upstreamLoad(up, buildSyntheticAirspeedLog({ flightSeconds: 120, statNoFlying: true }))).rejects.toThrow(
      "Cannot read properties of undefined (reading 'length')"
    )
    expect(up.alerts).toEqual([])
  })
})
