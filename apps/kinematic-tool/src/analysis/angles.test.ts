import { describe, expect, it } from 'vitest'
import { constrain, isPositive, wrap180, wrapPi } from './angles.js'

describe('angle helpers', () => {
  it('wraps to the half-open ranges', () => {
    expect(wrap180(190)).toBe(-170)
    expect(wrap180(-180)).toBe(180)
    expect(wrap180(540)).toBe(180)
    expect(wrapPi(-Math.PI)).toBeCloseTo(Math.PI)
    expect(wrapPi(3 * Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5)
  })

  it('treats NaN as not positive and constrains', () => {
    expect(isPositive(NaN)).toBe(false)
    expect(isPositive(0)).toBe(false)
    expect(constrain(5, -1, 1)).toBe(1)
    expect(constrain(-5, -1, 1)).toBe(-1)
  })
})
