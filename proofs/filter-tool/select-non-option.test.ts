// Row: "`_ENABLE`/`_MODE` drop-downs read NaN for any text that is not an option (e.g. MAVProxy
// `1.000000`)". Verdict: docs/bug-proofs/filter-tool.md.
import { describe, expect, it } from 'vitest'
import { freshPage, gyroFilters, loadParamFile, type UpstreamPage } from './_harness.js'

const NOTCH = 'INS_HNTCH_FREQ 80\nINS_HNTCH_BW 40\nINS_HNTCH_ATT 40\nINS_HNTCH_REF 0.1\nINS_HNTCH_FM_RAT 1\nINS_HNTCH_HMNCS 1\n'

/** The page once `params.json` has arrived, so `_ENABLE` and `_MODE` are drop-downs. */
function pageWithMetadata(): UpstreamPage {
  const page = freshPage()
  page.finishMetadata()
  return page
}

describe('drop-down parameters loaded from a file', () => {
  it('INS_HNTCH_ENABLE 0.000000 reads NaN and the notch is applied', async () => {
    const page = pageWithMetadata()
    await loadParamFile(page, `${NOTCH}INS_HNTCH_ENABLE 0.000000\n`)
    expect(page.el('INS_HNTCH_ENABLE').value).toBe('')
    expect(page.read('INS_HNTCH_ENABLE')).toBeNaN()
    const notch = gyroFilters(page, 2000)[0]!
    expect(notch.enabled).toBe(true)
    expect(notch.notches!.map((n) => n.center_freq_hz)).toEqual([80])
  })

  it('INS_HNTCH_ENABLE 0 (same value, option text) disables the notch', async () => {
    const page = pageWithMetadata()
    await loadParamFile(page, `${NOTCH}INS_HNTCH_ENABLE 0\n`)
    expect(gyroFilters(page, 2000)[0]!.enabled).toBe(false)
  })

  it('INS_HNTCH_MODE 1.000000 reads NaN: a fixed notch at FREQ', async () => {
    const page = pageWithMetadata()
    await loadParamFile(page, `${NOTCH}INS_HNTCH_ENABLE 1\nINS_HNTCH_MODE 1.000000\n`)
    expect(page.el('INS_HNTCH_MODE').value).toBe('')
    expect(gyroFilters(page, 2000)[0]!.notches!.map((n) => n.center_freq_hz)).toEqual([80])
  })

  it('INS_HNTCH_MODE 1 (same value, option text) tracks throttle: FREQ * sqrt(Throttle / REF)', async () => {
    const page = pageWithMetadata()
    await loadParamFile(page, `${NOTCH}INS_HNTCH_ENABLE 1\nINS_HNTCH_MODE 1\n`)
    expect(page.read('Throttle')).toBe(0.3)
    expect(gyroFilters(page, 2000)[0]!.notches!.map((n) => n.center_freq_hz)).toEqual([80 * Math.sqrt(0.3 / 0.1)])
  })

  it('number inputs accept the same MAVProxy text', async () => {
    const page = pageWithMetadata()
    await loadParamFile(page, 'INS_HNTCH_FREQ 80.000000\n')
    expect(page.read('INS_HNTCH_FREQ')).toBe(80)
  })
})
