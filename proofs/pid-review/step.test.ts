// PID Review `redraw_step`: noise-estimate length and the stale mean trace.
import { describe, expect, it } from 'vitest'
import { loadPidReview, type PidReviewPage } from './_harness'

interface Trace {
  x?: number[]
  y?: number[]
  visible?: boolean
}

/**
 * Set up one PID controller with one parameter set holding one batch, as `load` + `calculate` leave
 * it, with the FFT window size and average rate given.
 */
function setup(page: PidReviewPage, rate: number, windowSize: number, tar: number[]): void {
  page.set('__rate', rate)
  page.set('__window', windowSize)
  page.set('__tar', tar)
  page.run(`
    const n = __tar.length
    const batch = { time: __tar.map((_, i) => i / __rate), Tar: __tar, Act: __tar.map((v) => 0.8 * v) }
    const set = [batch]
    set.FFT = {}
    const sets = [set]
    sets.FFT = { window_size: __window, average_sample_rate: __rate, bins: rfft_freq(__window, 1 / __rate) }
    PID_log_messages = [{ sets }]
    PID_log_messages.have_data = true
    get_axis_index = () => 0
    step_plot = { data: [{ x: [], y: [] }, { x: [], y: [] }], layout: { yaxis: {} } }
  `)
}

const sine = (n: number, rate: number, amplitude: (i: number) => number): number[] =>
  Array.from({ length: n }, (_, i) => amplitude(i) * Math.sin(2 * Math.PI * 5 * (i / rate)))

describe('redraw_step noise estimate', () => {
  /** The regularisation array added to Pxx (the `array_add` call whose first argument is a full spectrum). */
  function noiseEstimate(rate: number, windowSize: number): number[] {
    const page = loadPidReview()
    setup(
      page,
      rate,
      windowSize,
      sine(4 * windowSize, rate, () => 100)
    )
    page.element('TimeStart').value = '0'
    page.element('TimeEnd').value = '1000'
    page.set('__window', windowSize)
    page.run(`
      const __array_add = array_add
      var __sn = null
      array_add = (a, b) => {
        if (__sn === null && a.length === __window) __sn = b
        return __array_add(a, b)
      }
      redraw_step()
    `)
    return page.run('__sn') as number[]
  }

  it('is a symmetric full spectrum at 400 Hz, 64 points (25 Hz below half Nyquist)', () => {
    const sn = noiseEstimate(400, 64)
    expect(sn).toHaveLength(64)
    for (let k = 1; k < 64; k++) expect(sn[k]).toBe(sn[64 - k])
  })

  it('is 83 long and not symmetric at 60 Hz, 64 points (len_lpf 52 > real_len 33)', () => {
    const sn = noiseEstimate(60, 64)
    expect(sn).toHaveLength(52 + 31)
    const asymmetric = []
    for (let k = 1; k < 64; k++) if (sn[k] !== sn[64 - k]) asymmetric.push(k)
    expect(asymmetric.length).toBeGreaterThan(0)
    // e.g. bin 1 and bin 63, which are conjugate bins of the same real-signal frequency
    expect(sn[1]).not.toBe(sn[63])
  })
})

describe('redraw_step mean trace', () => {
  it('keeps the previous range mean when the new range has no window above 20 deg/s', () => {
    const page = loadPidReview()
    // 1024 samples at 400 Hz: the first 256 at amplitude 100, the rest at amplitude 1.
    setup(
      page,
      400,
      64,
      sine(1024, 400, (i) => (i < 256 ? 100 : 1))
    )
    page.element('TimeStart').value = '0'
    page.element('TimeEnd').value = '100'
    page.run('redraw_step()')
    const first = page.run('step_plot.data') as Trace[]
    const firstMean = first[1]?.y?.slice() ?? []
    expect(first[0]?.x?.length).toBeGreaterThan(0)
    expect(firstMean.length).toBeGreaterThan(0)

    // Analysis time 2 to 2.5 s: only amplitude-1 windows.
    page.element('TimeStart').value = '2'
    page.element('TimeEnd').value = '2.5'
    page.run('redraw_step()')
    const second = page.run('step_plot.data') as Trace[]
    expect(second[0]?.x).toEqual([])
    expect(second[0]?.y).toEqual([])
    expect(second[1]?.y).toEqual(firstMean)
    expect(second[1]?.visible).toBe(true)
  })
})
