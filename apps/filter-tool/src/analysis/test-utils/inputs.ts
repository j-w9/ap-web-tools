// Test-only: random but plausible filter tool inputs for oracle comparisons.
import {
  DEFAULT_INPUTS,
  NOTCH_PREFIXES,
  PID_AXES,
  notchParam,
  pidParam,
  type InputName,
  type Inputs,
  type NotchField
} from '../params.js'

/** A random but plausible configuration exercising every mode and option. */
export function randomInputs(next: () => number): Inputs {
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
