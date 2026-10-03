/**
 * Small helpers for reading groups of parameters (upstream `get_param_array` and
 * `param_array_configured`).
 */
import type { ParamValues } from './params.js'
import type { Vector3Names } from './shared/param-helpers.js'

/** X/Y/Z parameter values; `undefined` where a parameter is missing. */
export type ParamVector3 = readonly [number | undefined, number | undefined, number | undefined]

/** Values of several parameters, `undefined` where missing (upstream `get_param_array`). */
export function paramArray(params: ParamValues, names: readonly string[]): (number | undefined)[] {
  return names.map((n) => params.get(n))
}

/** Values of a Vector3 parameter. */
export function paramVector3(params: ParamValues, names: Vector3Names): ParamVector3 {
  return [params.get(names[0]), params.get(names[1]), params.get(names[2])]
}

/**
 * Whether any value differs from its default (upstream `param_array_configured`). A missing
 * parameter counts as different, as in upstream (`undefined != 0` is true in JavaScript).
 */
export function paramArrayConfigured(values: readonly (number | undefined)[], defaultValue: number): boolean {
  return values.some((v) => v !== defaultValue)
}

/** Whether all three components are present (upstream `pos_valid`). */
export function isCompleteVector(v: ParamVector3): v is readonly [number, number, number] {
  return v[0] !== undefined && v[1] !== undefined && v[2] !== undefined
}
