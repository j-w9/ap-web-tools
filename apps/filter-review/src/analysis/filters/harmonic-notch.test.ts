import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { defaultNotchParams } from '../filter-params.js'
import { fixture } from '../test-utils/logs.js'
import { createTrackingTargets } from '../tracking/targets.js'
import { buildFilters, transferFunctions } from './filter-set.js'
import { HarmonicNotchFilter } from './harmonic-notch.js'
import { zGrid } from '@apwt/filters'
import { interpolateTargets } from '../analyse.js'

const targets = createTrackingTargets(DataflashLog.parse(fixture('copter-files.bin')))

describe('HarmonicNotchFilter', () => {
  it('flags an unsupported mode and stays disabled', () => {
    const notch = new HarmonicNotchFilter({ ...defaultNotchParams(), enable: 1, mode: 9 }, targets.all, 4)
    expect(notch.enabled).toBe(false)
    expect(notch.warnings).toEqual(['Unsupported notch mode 9'])
  })

  it('reports a missing tracking source', () => {
    const notch = new HarmonicNotchFilter({ ...defaultNotchParams(), enable: 1, mode: 3 }, targets.all, 4)
    expect(notch.enabled).toBe(false)
    expect(notch.warnings).toEqual(['No tracking data available for ESC notch'])
  })

  it('computes the minimum frequency per filter version and option', () => {
    const p = { ...defaultNotchParams(), enable: 1, mode: 0, freq: 100, minRatio: 0.5 }
    expect(new HarmonicNotchFilter(p, targets.all, 1).minFreq(3)).toBe(0)
    expect(new HarmonicNotchFilter(p, targets.all, 2).minFreq(3)).toBe(50)
    expect(new HarmonicNotchFilter({ ...p, options: 32 }, targets.all, 2).minFreq(3)).toBe(150)
  })

  it('applies a static notch and the low-pass to every window', () => {
    const params = {
      gyroFilter: 50,
      loopRate: 400,
      notches: [{ ...defaultNotchParams(), enable: 1, mode: 0, freq: 100, harmonics: 1 }, defaultNotchParams()] as [
        ReturnType<typeof defaultNotchParams>,
        ReturnType<typeof defaultNotchParams>
      ]
    }
    const filters = buildFilters(params, targets.all, 4)
    const freq = Float64Array.of(1, 100, 250)
    const h = transferFunctions(filters, interpolateTargets(targets.all, [0, 1]), 2, 1000, zGrid(freq, 1000))
    expect(h.length).toBe(2)
    const mag = (i: number) => Math.hypot(h[1]!.re[i]!, h[1]!.im[i]!)
    expect(mag(0)).toBeCloseTo(1, 3)
    expect(mag(1)).toBeLessThan(0.05)
    expect(mag(2)).toBeLessThan(0.5)
  })
})
