import { describe, expect, it } from 'vitest'
import { fakeLog, loadPage } from './_harness.js'

// Row: "No FFT frequencies without FTN2, even for the FTN1 peak".
const FTN1 = { TimeUS: [0, 1_000_000], PkAvg: [100, 100] }
const FTN2 = { TimeUS: [0, 1_000_000], PkX: [100, 100], PkY: [100, 100], EnX: [1, 1], EnY: [1, 1] }
// Centre-peak tracking (INS_HNTCH_OPTS bit 1 clear), REF 1, FREQ 80, filter version 1.
const config = '{ options: 0, ref: 1, freq: 80 }'

function target(withFtn2: boolean): { have_data: boolean; spectrogram: unknown; estimate: unknown } {
  const page = loadPage()
  page.set('__log', fakeLog({ messages: { FTN1 }, ...(withFtn2 ? { instances: { FTN2: { '0': FTN2 } } } : {}) }))
  return page.run(`(() => {
    const t = new FFTTarget(__log)
    t.interpolate(0, [0.5])
    return { have_data: t.have_data(), spectrogram: t.get_target_freq(${config}).freq, estimate: t.get_interpolated_target_freq(0, 0, ${config}) }
  })()`) as { have_data: boolean; spectrogram: unknown; estimate: unknown }
}

describe('FilterReview FFTTarget: centre-peak target from FTN1.PkAvg', () => {
  it('with FTN2 logged, the estimate uses the FTN1 centre peak', () => {
    expect(target(true)).toEqual({ have_data: true, spectrogram: [100, 100], estimate: [100] })
  })

  it('with only FTN1 logged, the spectrogram line uses it but the estimate gets no frequency', () => {
    expect(target(false)).toEqual({ have_data: true, spectrogram: [100, 100], estimate: null })
  })
})
