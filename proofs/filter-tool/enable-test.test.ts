// Row: "UI enable test `> 0` differs from the filter's `!(<= 0)`". Verdict: docs/bug-proofs/filter-tool.md.
import { describe, expect, it } from 'vitest'
import { freshPage, gyroFilters, loadParamFile } from './_harness.js'

describe('empty _ENABLE', () => {
  it('greys out the notch settings while the notch is applied', async () => {
    const page = freshPage()
    await loadParamFile(page, 'INS_HNTCH_FREQ 80\nINS_HNTCH_BW 40\nINS_HNTCH_ATT 40\nINS_HNTCH_HMNCS 1\n')
    page.el('INS_HNTCH_ENABLE').value = ''
    page.call('update_hidden', 'INS_HNTCH_ENABLE')
    expect(page.el('INS_HNTCH_FREQ').disabled).toBe(true)
    expect(page.el('INS_HNTCH_MODE').disabled).toBe(true)
    const notch = gyroFilters(page, 2000)[0]!
    expect(notch.enabled).toBe(true)
    expect(notch.notches!.map((n) => n.center_freq_hz)).toEqual([80])
  })

  it('the two tests agree for every number', () => {
    for (const v of [-1, 0, 0.5, 1, 2]) expect(v > 0).toBe(!(v <= 0))
    const empty = parseFloat('')
    expect(empty > 0).toBe(false)
    expect(!(empty <= 0)).toBe(true)
  })
})
