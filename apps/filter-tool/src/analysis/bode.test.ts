import { describe, expect, it } from 'vitest'
import { gyroBode, pidBode, type BodeScale, type PidFiltering } from './bode.js'
import {
  DEFAULT_INPUTS,
  NOTCH_PREFIXES,
  PID_AXES,
  notchParam,
  pidParam,
  type InputName,
  type Inputs,
  type NotchField
} from './params.js'
import { loadFilterToolUpstream, type UpstreamFilterTool } from './test-utils/upstream.js'
import { rng } from './test-utils/random.js'

const SCALES: readonly BodeScale[] = [
  { magnitude: 'dB', phase: 'unwrapped' },
  { magnitude: 'linear', phase: 'wrapped' }
]

function setAll(up: UpstreamFilterTool, inputs: Inputs): void {
  for (const [name, value] of Object.entries(inputs)) up.setForm(name, value)
}

/** A random but plausible configuration exercising every mode and option. */
function randomInputs(next: () => number): Inputs {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!
  const inputs: Record<InputName, number> = { ...DEFAULT_INPUTS }
  inputs.GyroSampleRate = pick([400, 1000, 2000])
  inputs.INS_GYRO_FILTER = pick([0, 20, 45.5, 120])
  inputs.Throttle = pick([-0.1, 0, 0.2, 0.35, 0.8])
  inputs.NUM_MOTORS = pick([1, 2, 4, 2.5])
  inputs.ESC_RPM = pick([0, 1800, 2500, 6000])
  inputs.RPM1 = pick([0, 2500, 4000])
  inputs.RPM2 = pick([1000, 3000])
  for (const prefix of NOTCH_PREFIXES) {
    const set = (field: NotchField, value: number) => (inputs[notchParam(prefix, field)] = value)
    set('ENABLE', pick([0, 1, 1, 1]))
    set('MODE', pick([0, 1, 2, 3, 4, 5, 1.5]))
    set('FREQ', pick([0, 40, 80, 150.5, 300]))
    set('BW', pick([0, 20, 40, 75]))
    set('ATT', pick([0, 15, 40]))
    set('REF', pick([0, 0.2, 0.35, 1]))
    set('FM_RAT', pick([0.5, 0.7, 1]))
    set('HMNCS', pick([0, 1, 3, 5, 15, 255, 129]))
    set('OPTS', pick([0, 1, 2, 3, 16, 17, 18]))
  }
  for (const axis of PID_AXES) {
    inputs[pidParam(axis, 'P')] = next() * 0.3
    inputs[pidParam(axis, 'I')] = next() * 0.3
    inputs[pidParam(axis, 'D')] = next() * 0.01
    inputs[pidParam(axis, 'FLTE')] = pick([0, 2.5, 10])
    inputs[pidParam(axis, 'FLTD')] = pick([0, 20, 40])
  }
  inputs.SCHED_LOOP_RATE = pick([50, 400])
  return inputs
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
