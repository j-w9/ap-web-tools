import { describe, expect, it } from 'vitest'
import { fill, loadPage, timesUs, type Page } from './_harness'

// A copter system ID log reduced to the fields `load_vtol_time_history_data` reads.
function copterLog(n: number, attRateHz = 100): Record<string, Record<string, number[]>> {
  const nAtt = Math.round((n * attRateHz) / 100)
  return {
    RATE: { TimeUS: timesUs(n, 100), ROut: fill(n, 0.1), RDes: fill(n, 1), R: fill(n, 1) },
    ATT: { TimeUS: timesUs(nAtt, attRateHz), DesRoll: fill(nAtt, 1), Roll: fill(nAtt, 1) },
    SIDD: { TimeUS: timesUs(n, 100), Targ: fill(n, 1), Gx: fill(n, 1), Gy: fill(n, 1), Gz: fill(n, 1) }
  }
}

function useLog(page: Page, log: unknown): void {
  page.set('__log', log)
  page.run('log = new DataflashParser(); log.processData(__log); use_ANG_message = false')
}

describe('Analytic Tune: time history loading', () => {
  // Row: "Sample rate counts samples, not intervals".
  it('gives 101.01 Hz for RATE logged at exactly 100 Hz', async () => {
    const page = await loadPage()
    useLog(page, copterLog(101))
    const [data, rate] = page.run('load_vtol_time_history_data(0, 1, "Roll")') as [{ Rate: number[] }, number]
    // 100 samples (indices 0..99, 0.00 s to 0.99 s) are kept; 100 samples over 0.99 s.
    expect(data.Rate.length).toBe(100)
    expect(rate).toBe(100 / 0.99)
    // 100 samples spaced 10 ms apart span 99 intervals: (100 - 1) / 0.99 s = 100 Hz.
    expect(rate).not.toBe(100)
  })

  // Row: "Signals at different log rates analysed as one rate".
  it('treats 50 Hz ATT as if logged at the 100 Hz RATE rate', async () => {
    const page = await loadPage()
    useLog(page, copterLog(201, 50))
    page.run('[__data, __rate] = load_vtol_time_history_data(0, 2, "Roll")')
    expect(page.run('__rate')).toBe(200 / 1.99)
    expect(page.run('__data.PilotInput.length')).toBe(200)
    expect(page.run('__data.Att.length')).toBe(100)
    // run_fft windows follow the first key (PilotInput); Att windows past its end are NaN.
    page.run('__fft = run_fft(__data, Object.keys(__data), 64, 32, hanning(64), new FFTJS(64))')
    expect(page.run('__fft.center.length')).toBe(5)
    const attNaN = page.run('__fft.Att.map((w) => w[0].some((x) => Number.isNaN(x)))') as boolean[]
    expect(attNaN).toEqual([false, false, true, true, true])
    const pilotNaN = page.run('__fft.PilotInput.map((w) => w[0].some((x) => Number.isNaN(x)))') as boolean[]
    expect(pilotNaN).toEqual([false, false, false, false, false])
  })
})

// Row: "Loops run one past the end".
describe('Analytic Tune: calculate_predicted_TF loop bounds', () => {
  it('returns one extra trailing NaN element on two of the predictions', async () => {
    const page = await loadPage()
    // A 32-bin aircraft response (window 64, 400 Hz): what calculate_freq_resp passes in.
    page.run('__H = [new Array(32).fill(1), new Array(32).fill(0)]; __pred = calculate_predicted_TF(__H, 400, 64)')
    const lengths = page.run('__pred.map((p) => p[0].length)') as number[]
    // [Ret_rate, Ret_att_ff, Ret_pilot, Ret_DRB, Ret_att_nff, Ret_att_bl, Ret_rate_bl, Ret_sys_bl]
    expect(lengths).toEqual([32, 33, 32, 32, 32, 32, 32, 33])
    expect(page.run('[__pred[1][0][32], __pred[1][1][32], __pred[7][0][32], __pred[7][1][32]]')).toEqual([NaN, NaN, NaN, NaN])
    // Elements 0..31 are finite: the extra element is the only effect.
    expect(page.run('__pred.every((p) => p[0].slice(0, 32).every(Number.isFinite))')).toBe(true)
  })
})
