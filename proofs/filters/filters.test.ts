// Reproductions for the Filters rows of docs/upstream-bugs.md. Verdicts: docs/bug-proofs/filters.md.
import { describe, expect, it } from 'vitest'
import { loadFilterScript, type FilterScriptTool } from './_harness.js'

describe('FilterTool LPF_1P never sets sample_rate', () => {
  it('leaves sample_rate undefined for both branches; AnalyticTune sets it', () => {
    const ft = loadFilterScript('FilterTool')
    expect(ft.run('new LPF_1P(400, 0).sample_rate')).toBeUndefined()
    expect(ft.run('new LPF_1P(400, 20).sample_rate')).toBeUndefined()
    const at = loadFilterScript('AnalyticTune')
    expect(at.run('new LPF_1P(400, 20).sample_rate')).toBe(400)
  })

  it('has no effect on FilterTool PID, whose transfer reads only its own sample_rate', () => {
    const ft = loadFilterScript('FilterTool')
    const res = ft.run('evaluate_transfer_functions([[new PID(400, 0.1, 0.1, 0.002, 10, 20)]], 200, 50, false, false)') as {
      attenuation: number[]
    }
    expect(res.attenuation.every((v) => Number.isFinite(v))).toBe(true)
  })
})

describe('Harmonic notch spread computed before the centre is clamped', () => {
  // ESC tracking (mode 3), double notch with per-motor notches (opts 1 | 2), two motors at the same
  // ESC_RPM (0, so the centre is FREQ * REF = 10 Hz), first harmonic only, 40 Hz bandwidth at 2 kHz.
  // The 10 Hz centre is below the bandwidth limit 0.52 * 40 = 20.8 Hz and is clamped to it.
  const construct = 'new HarmonicNotchFilter(2000, 1, 3, 10, 40, 40, 1, 1, 1, 3)'

  for (const tool of ['FilterTool', 'AnalyticTune'] satisfies FilterScriptTool[]) {
    it(`${tool}: the second motor's notches differ from the first motor's`, () => {
      const up = loadFilterScript(tool)
      up.setForm('NUM_MOTORS', '2')
      up.setForm('ESC_RPM', '0')
      const centres = up.run(`${construct}.notches.map((n) => n.center_freq_hz)`) as number[]
      // Motor 1: spread 40 / (32 * 10) = 0.125 from the unclamped centre, applied to 20.8.
      // Motor 2: spread 40 / (32 * 20.8) from the clamped centre, applied to 20.8.
      expect(centres).toEqual([
        20.8 * (1 - 0.125),
        20.8 * (1 + 0.125),
        20.8 * (1 - 40 / (32 * 20.8)),
        20.8 * (1 + 40 / (32 * 20.8))
      ])
      expect(centres).toEqual([18.2, 23.400000000000002, 19.55, 22.049999999999997])
    })
  }

  it('with one motor (no chaining) only the first-motor notches exist', () => {
    const up = loadFilterScript('FilterTool')
    up.setForm('NUM_MOTORS', '2')
    up.setForm('ESC_RPM', '0')
    // opts 1: double notch without per-motor chaining.
    const centres = up.run('new HarmonicNotchFilter(2000, 1, 3, 10, 40, 40, 1, 1, 1, 1).notches.map((n) => n.center_freq_hz)')
    expect(centres).toEqual([18.2, 23.400000000000002])
  })
})
