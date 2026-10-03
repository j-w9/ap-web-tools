/**
 * Rangefinders, optical flow and visual odometry: type and position offset only
 * (upstream `load_rangefinder()`, `load_flow()`, `load_viso()`).
 */
import { paramVector3, type ParamVector3 } from './param-arrays.js'
import type { ParamValues } from './params.js'
import { paramNameVector3 } from './shared/param-helpers.js'

/** Number of rangefinder slots (`RNGFND1_` .. `RNGFND9_`, `RNGFNDA_`). */
export const MAX_NUM_RANGEFINDER = 10

/** A sensor that only reports its type and mounting position. */
export interface PositionedSensor {
  /** 1-based number. */
  readonly number: number
  /** `*_TYPE` value (non-zero). */
  readonly type: number
  /** `*_POS_X/Y/Z`. */
  readonly pos: ParamVector3
}

function readTyped(params: ParamValues, prefix: string, number: number): PositionedSensor | undefined {
  const type = params.get(prefix + 'TYPE')
  if (type === undefined || type === 0) return undefined
  return { number, type, pos: paramVector3(params, paramNameVector3(prefix + 'POS_')) }
}

/** Rangefinder slots 0..9; `undefined` where not configured. */
export function readRangefinders(params: ParamValues): (PositionedSensor | undefined)[] {
  const out: (PositionedSensor | undefined)[] = []
  for (let i = 0; i < MAX_NUM_RANGEFINDER; i++) {
    const index = i === 9 ? 'A' : String(i + 1)
    out.push(readTyped(params, 'RNGFND' + index + '_', i + 1))
  }
  return out
}

/** Optical flow sensor (`FLOW_TYPE`), if configured. */
export function readFlow(params: ParamValues): PositionedSensor | undefined {
  return readTyped(params, 'FLOW_', 1)
}

/** Visual odometry (`VISO_TYPE`), if configured. */
export function readViso(params: ParamValues): PositionedSensor | undefined {
  return readTyped(params, 'VISO_', 1)
}
