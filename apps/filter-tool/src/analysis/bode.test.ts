import { describe, expect, it } from 'vitest'
import { gyroBode, pidBode, type BodeScale, type PidFiltering } from './bode.js'
import { DEFAULT_INPUTS, PID_AXES, pidParam, type Inputs } from './params.js'
import { randomInputs } from './test-utils/inputs.js'
import { loadFilterToolUpstream, type UpstreamFilterTool } from './test-utils/upstream.js'
import { rng } from './test-utils/random.js'

const SCALES: readonly BodeScale[] = [
  { magnitude: 'dB', phase: 'unwrapped' },
  { magnitude: 'linear', phase: 'wrapped' }
]

function setAll(up: UpstreamFilterTool, inputs: Inputs): void {
  for (const [name, value] of Object.entries(inputs)) up.setForm(name, value)
}

describe('gyroBode matches upstream calculate_filter', () => {
  const next = rng(42)
  const cases = [DEFAULT_INPUTS, ...Array.from({ length: 24 }, () => randomInputs(next))]
  cases.forEach((inputs, n) => {
    it(`case ${n}`, () => {
      const up = loadFilterToolUpstream()
      setAll(up, inputs)
      for (const scale of SCALES) {
        const dB = scale.magnitude === 'dB'
        const unwrap = scale.phase === 'unwrapped'
        const rate = inputs.GyroSampleRate
        const filters = up.get_filters(rate)
        const expected = up.evaluate_transfer_functions([filters], rate * 0.5, 0.1, dB, unwrap)
        const actual = gyroBode(inputs, scale)

        expect(Array.from(actual.freq)).toEqual(expected.freq)
        expect(Array.from(actual.total.magnitude)).toEqual(expected.attenuation)
        expect(Array.from(actual.total.phase)).toEqual(expected.phase)
        actual.components.forEach((c, i) => {
          const f = filters[i]!
          expect(c.enabled).toBe(f.enabled)
          if (!c.enabled) return
          expect(Array.from(c.bode.magnitude)).toEqual(f.attenuation)
          expect(Array.from(c.bode.phase)).toEqual(f.phase)
          if (c.filter.kind === 'harmonic-notch') {
            expect(c.filter.notches.map((x) => [x.centerHz, x.bandwidthHz, x.biquad !== null])).toEqual(
              f.notches!.map((x) => [x.center_freq_hz, x.bandwidth_hz, x.initialised])
            )
          }
        })
      }
    })
  })
})

describe('pidBode matches upstream calculate_pid', () => {
  const next = rng(7)
  const cases = [DEFAULT_INPUTS, ...Array.from({ length: 10 }, () => randomInputs(next))]
  const filterings: readonly PidFiltering[] = ['pre', 'post']
  cases.forEach((inputs, n) => {
    it(`case ${n}`, () => {
      const up = loadFilterToolUpstream()
      setAll(up, inputs)
      const rate = inputs.SCHED_LOOP_RATE
      for (const axis of PID_AXES) {
        for (const filtering of filterings) {
          const scale = SCALES[(n + PID_AXES.indexOf(axis)) % 2]!
          const dB = scale.magnitude === 'dB'
          const unwrap = scale.phase === 'unwrapped'
          const g = (term: 'P' | 'I' | 'D' | 'FLTE' | 'FLTD') => inputs[pidParam(axis, term)]
          const pid = up.PID(rate, g('P'), g('I'), g('D'), g('FLTE'), g('FLTD'))
          const groups = [[pid]]
          let gyro: { attenuation: number[]; phase: number[] } | null = null
          if (filtering === 'post') {
            const gyroFilters = up.get_filters(inputs.GyroSampleRate)
            gyro = up.evaluate_transfer_functions([gyroFilters], rate * 0.5, 0.05, dB, unwrap)
            groups.push(gyroFilters)
          }
          const expected = up.evaluate_transfer_functions(groups, rate * 0.5, 0.05, dB, unwrap)
          const actual = pidBode(inputs, axis, filtering, scale)

          expect(Array.from(actual.freq)).toEqual(expected.freq)
          expect(Array.from(actual.total.magnitude)).toEqual(expected.attenuation)
          expect(Array.from(actual.total.phase)).toEqual(expected.phase)
          expect(Array.from(actual.p.magnitude)).toEqual(pid.P_attenuation)
          expect(Array.from(actual.p.phase)).toEqual(pid.P_phase)
          expect(Array.from(actual.i.magnitude)).toEqual(pid.I_attenuation)
          expect(Array.from(actual.i.phase)).toEqual(pid.I_phase)
          expect(Array.from(actual.d.magnitude)).toEqual(pid.D_attenuation)
          expect(Array.from(actual.d.phase)).toEqual(pid.D_phase)
          if (gyro === null) {
            expect(actual.gyro).toBeNull()
          } else {
            expect(Array.from(actual.gyro!.magnitude)).toEqual(gyro.attenuation)
            expect(Array.from(actual.gyro!.phase)).toEqual(gyro.phase)
          }
        }
      }
    })
  })
})
