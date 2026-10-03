// Row: "Battery current resampled on compass 1's time base for every compass; crashes without compass 1".
import { describe, expect, it } from 'vitest'
import { createUpstreamMagfit, upstreamLoad } from './_harness.js'
import { buildMagLog } from './_log.js'

describe('MAGFit: battery current time base', () => {
  it('resamples the current for compass 2 at compass 1 sample times', async () => {
    const up = await createUpstreamMagfit()
    // Compass 2 samples 50 ms after compass 1.
    await upstreamLoad(up, await buildMagLog({ compasses: [0, 1], magOffsetUs: [0, 50_000] }))
    const value = up.evaluate<number[]>('MAG_Data[1].fits[1].value')
    expect(up.evaluate('MAG_Data[1].fits[1].name')).toBe('Battery 1 current')
    // motor_comp.data[0] holds the logged BAT time (x) and current (y).
    const onCompass1 = up.evaluate<number[]>('linear_interp(motor_comp.data[0].y, motor_comp.data[0].x, MAG_Data[0].time)')
    const onCompass2 = up.evaluate<number[]>('linear_interp(motor_comp.data[0].y, motor_comp.data[0].x, MAG_Data[1].time)')
    expect(value).toEqual(onCompass1)
    expect(value).not.toEqual(onCompass2)
    expect(up.evaluate('MAG_Data[0].time[10]')).toBe(2.1)
    expect(up.evaluate('MAG_Data[1].time[10]')).toBe(2.15)
  })

  it('gives NaN motor fits for a compass with more samples than compass 1', async () => {
    const up = await createUpstreamMagfit()
    // Compass 1 logs every second sample: 300 samples, compass 2 has 600.
    await upstreamLoad(up, await buildMagLog({ compasses: [0, 1], magEvery: [2, 1] }))
    expect(up.evaluate('MAG_Data[0].time.length')).toBe(300)
    expect(up.evaluate('MAG_Data[1].time.length')).toBe(600)
    expect(up.evaluate('MAG_Data[1].fits[1].value.length')).toBe(300)
    expect(up.evaluate('MAG_Data[1].fits[1].value[300]')).toBeUndefined()
    // Compass 2's current fits read fit.value[300..599] (undefined): every parameter is NaN, all invalid.
    const fit = up.evaluate<string>(
      'JSON.stringify(["offsets", "scale", "iron"].map((k) => [MAG_Data[1].fits[1][k].valid, MAG_Data[1].fits[1][k].params.offsets]))'
    )
    expect(JSON.parse(fit)).toEqual([
      [0, [null, null, null]],
      [0, [null, null, null]],
      [0, [null, null, null]]
    ])
    expect(up.evaluate('Number.isNaN(MAG_Data[1].fits[1].offsets.params.offsets[0])')).toBe(true)
    // Compass 1's own current fits, on matching time bases, are valid.
    expect(
      up.evaluate('[MAG_Data[0].fits[1].offsets.valid, MAG_Data[0].fits[1].scale.valid, MAG_Data[0].fits[1].iron.valid]')
    ).toEqual([1, 1, 1])
  })

  it('loads a log without compass 1 when there is no battery current', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, await buildMagLog({ compasses: [1], battery: false }))
    expect(up.evaluate('MAG_Data[0]')).toBeUndefined()
    expect(up.evaluate('MAG_Data[1].fits[0].offsets.valid')).toBe(1)
  })

  it('throws on the same log with battery current', async () => {
    const up = await createUpstreamMagfit()
    await expect(upstreamLoad(up, await buildMagLog({ compasses: [1] }))).rejects.toThrow(
      "Cannot read properties of undefined (reading 'time')"
    )
  })
})
