// Row: "Bias bar is Math.abs(null) = 0 without a logged ratio".
import { describe, expect, it } from 'vitest'
import { createUpstreamTool, upstreamLoad } from './_harness.js'
import { buildSyntheticAirspeedLog } from './_log.js'

interface Bar {
  name: string
  x: string[]
  y: (number | null)[]
  customdata?: (number | null)[]
}

describe('AirspeedFit: RMS / bias bar without a logged ratio', () => {
  it('draws an RMS gap but a zero bias bar for "Existing"', async () => {
    const up = await createUpstreamTool()
    // Sensor 2 has no ARSPD2_RATIO in the log.
    await upstreamLoad(up, buildSyntheticAirspeedLog({ flightSeconds: 300, omitRatio: [1] }))
    expect(up.evaluate('ASP_Data[1].current_ratio')).toBeUndefined()
    up.evaluate(`Plotly.react = function (id, data) { if (id == 'rms_bar') __rms = data }`)
    up.evaluate('redraw_rms_bar()')
    const bars = up.evaluate('__rms') as Bar[]
    expect(bars.map((b) => b.name)).toEqual(['Sensor 1', 'Sensor 2', 'mean error', 'mean error'])
    const rms2 = bars[1]!
    const bias2 = bars[3]!
    expect(rms2.x).toEqual(['Existing', 'Fitted'])
    // RMS before: null (no bar). Bias before: Math.abs(null) = 0 (a zero-height bar); its hover value is null.
    expect(rms2.y[0]).toBeNull()
    expect(bias2.y[0]).toBe(0)
    expect(bias2.customdata?.[0]).toBeNull()
    // Sensor 1, with a logged ratio, has both.
    expect(typeof bars[0]!.y[0]).toBe('number')
    expect(bars[2]!.y[0]).toBeGreaterThan(0)
  })
})
