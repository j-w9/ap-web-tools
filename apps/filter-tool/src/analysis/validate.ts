import type { Inputs } from './params.js'

/** Highest rates the tool will plot; far above any ArduPilot board, low enough to stay responsive. */
export const MAX_GYRO_RATE_HZ = 50000
export const MAX_LOOP_RATE_HZ = 10000

export type RateProblem = string | null

function rateProblem(name: string, value: number, max: number): RateProblem {
  if (!Number.isFinite(value) || value <= 0) return `${name} must be a positive number of Hz.`
  if (value > max) return `${name} above ${max} Hz is not supported.`
  return null
}

/** Why the gyro filter plot cannot be drawn, or null when it can. */
export function gyroRateProblem(inputs: Inputs): RateProblem {
  return rateProblem('Gyro sample rate', inputs.GyroSampleRate, MAX_GYRO_RATE_HZ)
}

/** Why the PID plot cannot be drawn, or null when it can. */
export function loopRateProblem(inputs: Inputs, includesGyro: boolean): RateProblem {
  return (
    rateProblem('SCHED_LOOP_RATE', inputs.SCHED_LOOP_RATE, MAX_LOOP_RATE_HZ) ?? (includesGyro ? gyroRateProblem(inputs) : null)
  )
}
