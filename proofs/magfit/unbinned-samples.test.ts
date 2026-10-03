// Row: "Samples with no attitude bin get NaN weight but are counted".
import { describe, expect, it } from 'vitest'
import { createUpstreamMagfit, upstreamLoad } from './_harness.js'
import { buildMagLog } from './_log.js'

const allFits = `JSON.stringify(MAG_Data.map((m) => m.fits.map((f) => [f.offsets.valid, f.scale.valid, f.iron.valid])))`

describe('MAGFit: samples without an attitude bin', () => {
  it('get_weights counts an undefined bin in the total and gives it a NaN weight', async () => {
    const up = await createUpstreamMagfit()
    const result = up.evaluate<{ weights: number[]; coverage: number }>('get_weights([0, 0, 1, undefined])')
    // count = {0: 2, 1: 1, undefined: NaN}; total 4, unique 2, mean bin size 2.
    expect(result.weights).toEqual([1, 1, 2, NaN])
    expect(result.coverage).toBe(2 / 80)
    // Without the unbinned sample the weights average 1, as the comment in get_weights says.
    expect(up.evaluate<{ weights: number[] }>('get_weights([0, 0, 1])').weights).toEqual([0.75, 0.75, 1.5])
  })

  it('a NaN attitude sample makes every fit invalid (NaN)', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, await buildMagLog({ nanAttitude: [200] }))
    expect(up.evaluate('Array.from(MAG_Data[0].expected.bins).filter((b) => b === undefined).length')).toBe(2)
    expect(up.evaluate('Number.isNaN(MAG_Data[0].fits[0].offsets.params.offsets[0])')).toBe(true)
    expect(JSON.parse(up.evaluate<string>(allFits))).toEqual([
      [
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0]
      ]
    ])
  })

  it('the fits stay NaN when the unbinned sample is given weight 0: the NaN comes from the expected field', async () => {
    const up = await createUpstreamMagfit()
    const buffer = await buildMagLog({ nanAttitude: [200] })
    await upstreamLoad(up, buffer)
    // Replace get_weights with one that skips undefined bins entirely (weight 0, not counted).
    up.evaluate(`get_weights = function (bins) {
      const count = new Array(num_bins).fill(0)
      let unique = 0, total = 0
      for (const b of bins) { if (b === undefined) continue; if (count[b] == 0) unique++; count[b]++; total++ }
      const mean = total / unique
      return { weights: bins.map((b) => (b === undefined ? 0 : mean / count[b])), coverage: unique / num_bins }
    }`)
    up.evaluate('calculate()')
    expect(up.evaluate('[MAG_Data[0].expected.x[199], MAG_Data[0].expected.x[200]]')).toEqual([NaN, NaN])
    expect(up.evaluate('Number.isNaN(MAG_Data[0].fits[0].offsets.params.offsets[0])')).toBe(true)
    expect(JSON.parse(up.evaluate<string>(allFits))).toEqual([
      [
        [0, 0, 0],
        [0, 0, 0]
      ],
      [
        [0, 0, 0],
        [0, 0, 0]
      ]
    ])
  })
})
