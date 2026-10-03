// Row: "NaN location / missing iron parameter / missing orientation parameter crash".
import { describe, expect, it } from 'vitest'
import { createUpstreamMagfit, upstreamLoad } from './_harness.js'
import { buildMagLog } from './_log.js'

describe('MAGFit: location', () => {
  it('reports a log with no location', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, await buildMagLog({ location: 'none' }))
    expect(up.alerts).toEqual(['Could not get earth field for Lat: undefined Lng: undefined'])
  })

  it('treats a POS format with no records as no location: the parser drops zero-record types', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, await buildMagLog({ location: 'empty-pos' }))
    expect(up.alerts).toEqual(['Could not get earth field for Lat: undefined Lng: undefined'])
  })

  it('throws only when get_mag_field_ef is called with NaN directly', async () => {
    const up = await createUpstreamMagfit()
    expect(() => up.evaluate('get_mag_field_ef(NaN, NaN)')).toThrow("Cannot read properties of undefined (reading 'NaN')")
    expect(up.evaluate('get_mag_field_ef(-91, 0)')).toBeUndefined()
  })
})

describe('MAGFit: missing iron parameters', () => {
  it('throws when the log has no COMPASS_DIA/ODI parameters for compass 1', async () => {
    const up = await createUpstreamMagfit()
    const omitParams = ['X', 'Y', 'Z'].flatMap((a) => [`COMPASS_DIA_${a}`, `COMPASS_ODI_${a}`])
    await expect(upstreamLoad(up, await buildMagLog({ omitParams }))).rejects.toThrow('Input data contains non-numeric values')
  })

  it('throws when one diagonal is missing', async () => {
    const up = await createUpstreamMagfit()
    await expect(upstreamLoad(up, await buildMagLog({ omitParams: ['COMPASS_DIA2_X'] }))).rejects.toThrow(
      'Input data contains non-numeric values'
    )
  })
})

describe('MAGFit: missing orientation parameter', () => {
  it('loads and fits, then save_parameters throws', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, await buildMagLog({ omitParams: ['COMPASS_ORIENT'] }))
    expect(up.evaluate('MAG_Data[0].fits[0].offsets.valid')).toBe(1)
    expect(up.evaluate('MAG_Data[0].fits[0].offsets.params.orientation')).toBeUndefined()
    expect(() => up.evaluate('save_parameters()')).toThrow("Cannot read properties of undefined (reading 'toString')")
    expect(up.saved).toEqual([])
  })
})
