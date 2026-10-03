import { describe, expect, it } from 'vitest'
import { loadPage } from './_harness.js'

// Row: "Drop-down values it does not offer read as NaN".
describe('FilterReview parameter drop-downs (options from FilterReview/params.json)', () => {
  it('INS_HNTCH_ENABLE 2 from a log reads as NaN and the notch is disabled', () => {
    const page = loadPage()
    page.run('parameter_set_value("INS_HNTCH_ENABLE", 2)')
    expect(page.element('INS_HNTCH_ENABLE').value).toBe('')
    expect(page.run('parameter_get_value("INS_HNTCH_ENABLE")')).toBeNaN()
    const enabled = page.run(`(() => {
      tracking_methods = [new StaticTarget()]
      return new HarmonicNotchFilter({ enable: parameter_get_value("INS_HNTCH_ENABLE"), mode: 0 }).enabled()
    })()`)
    expect(enabled).toBe(false)
  })

  it('INS_HNTCH_MODE "1.0" from a parameter file reads as NaN: "Unsupported notch mode NaN"', async () => {
    const page = loadPage()
    page.run('re_calc = function () {}')
    await page.loadParameters('INS_HNTCH_MODE,1.0\n')
    expect(page.element('INS_HNTCH_MODE').value).toBe('')
    page.run(`tracking_methods = [new StaticTarget()]
              new HarmonicNotchFilter({ enable: 1, mode: parameter_get_value("INS_HNTCH_MODE") })`)
    expect(page.alerts).toEqual(['Unsupported notch mode NaN'])
  })

  it('INS_HNTCH_ENABLE "1.0" from a parameter file reads as NaN (disabled)', async () => {
    const page = loadPage()
    page.run('re_calc = function () {}')
    await page.loadParameters('INS_HNTCH_ENABLE,1.0\n')
    expect(page.run('parameter_get_value("INS_HNTCH_ENABLE") > 0')).toBe(false)
  })
})
