// Row: "Input visibility floors `_MODE`, the maths does not". Verdict: docs/bug-proofs/filter-tool.md.
import { describe, expect, it } from 'vitest'
import { freshPage, gyroFilters, loadParamFile } from './_harness.js'

describe('_MODE 1.5 before params.json has turned it into a drop-down', () => {
  it('shows the throttle input while the notch stays fixed at FREQ', async () => {
    const page = freshPage()
    await loadParamFile(
      page,
      'INS_HNTCH_ENABLE 1\nINS_HNTCH_FREQ 80\nINS_HNTCH_BW 40\nINS_HNTCH_ATT 40\nINS_HNTCH_REF 0.1\nINS_HNTCH_FM_RAT 1\nINS_HNTCH_HMNCS 1\nINS_HNTCH_MODE 1.5\n'
    )
    expect(page.el('INS_HNTCH_MODE').value).toBe('1.5')
    expect(page.el('Throttle_input').hidden).toBe(false)
    expect(page.el('ESC_input').hidden).toBe(true)
    expect(page.el('RPM_input').hidden).toBe(true)
    expect(gyroFilters(page, 2000)[0]!.notches!.map((n) => n.center_freq_hz)).toEqual([80])
  })
})
