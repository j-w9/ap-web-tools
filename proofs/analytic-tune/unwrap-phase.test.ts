import { describe, expect, it } from 'vitest'
import { loadPage } from './_harness'

// Row: "Un-wrapped phase option has no effect".
// A response whose phase falls steadily in 30 deg steps from -100 deg to -430 deg, set as the calculated and predicted
// rate controller responses, drawn with the "un-wrapped" radio selected and with "±180" selected.
const phaseDeg = [-100, -130, -160, -190, -220, -250, -280, -310, -340, -370, -400, -430]
const ones = phaseDeg.map(() => 1)
const response = (): [number[], number[]] => [
  phaseDeg.map((p) => Math.cos((p * Math.PI) / 180)),
  phaseDeg.map((p) => Math.sin((p * Math.PI) / 180))
]

async function draw(unwrapped: boolean): Promise<{ calc: number[]; pred: number[]; unwrap: number[] }> {
  const page = await loadPage()
  page.set('__H', response())
  page.set(
    '__freq',
    phaseDeg.map((_, i) => i + 1)
  )
  page.set('__ones', ones)
  page.run(`
    calc_freq_resp = { ratectrl_H: __H, ratectrl_coh: __ones, bareAC_coh: __ones, freq: __freq }
    pred_freq_resp = { ratectrl_H: __H }
  `)
  page.setChecked('PID_ScaleUnWrap', unwrapped)
  page.setChecked('PID_ScaleWrap', !unwrapped)
  page.run('setup_FFT_data(); redraw_freq_resp()')
  const round = (a: number[]) => a.map((x) => Math.round(x * 1e9) / 1e9)
  return {
    calc: round(page.run('fft_plot_Phase.data[0].y') as number[]),
    pred: round(page.run('fft_plot_Phase.data[1].y') as number[]),
    // The page's own unwrap() applied to the wrapped phase: what the option would plot if honoured.
    unwrap: round(page.run('unwrap(array_scale(complex_phase(__H), 180 / Math.PI))') as number[])
  }
}

describe('Analytic Tune: un-wrapped phase option', () => {
  it('plots the wrapped phase whichever option is selected', async () => {
    const wrapped = [-100, -130, -160, 170, 140, 110, 80, 50, 20, -10, -40, -70]
    const on = await draw(true)
    const off = await draw(false)
    expect(on.calc).toEqual(wrapped)
    expect(on.pred).toEqual(wrapped)
    expect(off.calc).toEqual(wrapped)
    expect(off.pred).toEqual(wrapped)
    // The un-wrapped trace the option names, from the page's own unwrap().
    expect(on.unwrap).toEqual(phaseDeg)
  })
})
