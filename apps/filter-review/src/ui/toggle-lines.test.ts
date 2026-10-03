import { describe, expect, it } from 'vitest'
import { spectrumTraceKey, type SpectrumTraceKey } from '../analysis/selections.js'
import { toggleLines } from './toggle-lines.js'

describe('line group toggle (upstream legend double-click)', () => {
  const [x, y, z] = (['x', 'y', 'z'] as const).map((axis) => spectrumTraceKey(0, 'pre', axis)) as [
    SpectrumTraceKey,
    SpectrumTraceKey,
    SpectrumTraceKey
  ]
  const other = spectrumTraceKey(1, 'post', 'x')

  it('shows every available line when fewer than half are shown', () => {
    const next = toggleLines([x, y, z], new Set([x, y]), new Set([other]))
    expect(next).toEqual(new Set([other, x, y]))
  })

  it('hides the available lines otherwise and leaves unavailable ones alone', () => {
    const next = toggleLines([x, y, z], new Set([x, y]), new Set([x, z, other]))
    expect(next).toEqual(new Set([z, other]))
  })
})
