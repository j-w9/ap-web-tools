import { describe, expect, it } from 'vitest'
import { fakeLog, loadPage, ramp } from './_harness.js'

// Row: "Throttle at index 0 ignored for auto-zoom".
async function loadWithThrottle(throttle: number[]): Promise<{ start: string; end: string }> {
  const page = loadPage()
  // Stop load() after the analysis window is set; the FFT and plots are not needed here.
  page.run('calculate = function () {}; calculate_transfer_function = function () {}; redraw = function () {}')
  const gyro = { SampleUS: ramp(1001, 0, 10_000), GyrX: ramp(1001, 0, 0), GyrY: ramp(1001, 0, 0), GyrZ: ramp(1001, 0, 0) }
  const log = fakeLog({
    params: {},
    messages: { RATE: { TimeUS: ramp(throttle.length, 0, 100_000), AOut: throttle } },
    instances: { GYR: { '0': gyro } }
  })
  await page.load(log)
  return { start: page.element('TimeStart').value, end: page.element('TimeEnd').value }
}

describe('FilterReview load(): auto zoom to non-zero throttle (gyro data 0 s to 10 s, RATE every 0.1 s)', () => {
  it('crops the window when throttle first rises after the first RATE sample', async () => {
    const throttle = ramp(101, 0, 0).map((_, i) => (i === 0 || i === 100 ? 0 : 0.5))
    expect(await loadWithThrottle(throttle)).toEqual({ start: '2', end: '8' })
  })

  it('does not crop at all when throttle is already positive at the first RATE sample', async () => {
    const throttle = ramp(101, 0, 0).map((_, i) => (i === 100 ? 0 : 0.5))
    expect(await loadWithThrottle(throttle)).toEqual({ start: '0', end: '10' })
  })
})
