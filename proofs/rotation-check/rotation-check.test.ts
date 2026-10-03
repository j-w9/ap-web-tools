// Reproductions of the Rotation Check rows of docs/upstream-bugs.md and docs/audit/rotation-check.md
// against the original page logic. Verdicts and evidence: docs/bug-proofs/rotation-check.md.
import { describe, expect, it } from 'vitest'
import { loadRotationPage } from './_harness.js'

describe('Rotation Check: empty custom angle plotted as NaN', () => {
  it('Custom 1 with an empty Roll box gives NaN rotated arrows', () => {
    const page = loadRotationPage()
    page.update('101', '0', '0', '90')
    // Rotated X arrow (trace 6) points along +Y for yaw 90.
    const x = page.traces()[6]
    expect(x?.x[0]).toBeCloseTo(0, 12)
    expect(x?.y[0]).toBeCloseTo(0.3, 12)

    page.update('101', '', '0', '90')
    for (const i of [6, 7, 8, 9, 10, 11]) {
      const t = page.traces()[i]
      expect([...(t?.x ?? []), ...(t?.y ?? []), ...(t?.z ?? [])].some(Number.isNaN)).toBe(true)
    }
    expect(page.traces()[6]?.x).toEqual([NaN])
  })
})

describe('Rotation Check: label of rotation 38 (audit only)', () => {
  it('labels 38 Roll180 while the angles used are roll 90, pitch 68.8, yaw 293.3', () => {
    const page = loadRotationPage()
    expect(page.rotations['38']).toBe('Yaw293Pitch68Roll180')
    expect(page.euler[38]).toEqual([90, 68.8, 293.3])
  })
})
