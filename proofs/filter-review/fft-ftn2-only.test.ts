import { describe, expect, it } from 'vitest'
import { fakeLog, loadPage } from './_harness.js'

// Row: "FTN2 without FTN1 stops the calculation".
describe('FilterReview FFTTarget.interpolate with FTN2 but no FTN1', () => {
  it('throws, which stops calculate() for any log containing FTN2 without FTN1', () => {
    const page = loadPage()
    const FTN2 = { TimeUS: [0, 1_000_000], PkX: [100, 100], PkY: [100, 100], EnX: [1, 1], EnY: [1, 1] }
    page.set('__log', fakeLog({ instances: { FTN2: { '0': FTN2 } } }))
    page.run('__t = new FFTTarget(__log)')
    expect(page.run('__t.have_data()')).toBe(true)
    expect(() => page.run('__t.interpolate(0, [0.5])')).toThrow("Cannot read properties of undefined (reading 'length')")
  })
})
