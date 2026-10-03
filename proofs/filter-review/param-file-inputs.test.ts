import { describe, expect, it } from 'vitest'
import { loadPage } from './_harness.js'

// Row: "Parameter files can set non-parameter inputs and can abort part way".
describe('FilterReview load_parameters', () => {
  it('sets any input named in the file, e.g. the analysis start time', async () => {
    const page = loadPage()
    page.run('re_calc = function () {}')
    await page.loadParameters('TimeStart,12\n')
    expect(page.element('TimeStart').value).toBe('12')
  })

  it('stops at a line naming the file input: later lines are not applied and nothing is recalculated', async () => {
    const page = loadPage()
    page.set('__recalc', 0)
    page.run('re_calc = function () { __recalc++ }')
    await expect(page.loadParameters('INS_HNTCH_BW,30\nfileItem,x\nINS_HNTCH_FREQ,90\n')).rejects.toThrow(
      'InvalidStateError: fileItem'
    )
    expect(page.element('INS_HNTCH_BW').value).toBe('30')
    expect(page.element('INS_HNTCH_FREQ').value).toBe('80')
    expect(page.run('__recalc')).toBe(0)
  })
})
