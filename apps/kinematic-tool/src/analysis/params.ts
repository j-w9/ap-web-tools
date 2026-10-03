/**
 * The ArduPilot parameters that define each vehicle's input shaping model, with their defaults
 * (upstream `index.html` values) and documentation from the vendored `params.json` files.
 */
import copterParamsJson from './copter-params.json'
import planeParamsJson from './plane-params.json'
import type { CopterAxis, CopterMode, PlaneAxis } from './scenario.js'

// ---------- Parameter documentation ----------

/** What the rail shows for one parameter, from the ArduPilot parameter metadata. */
export interface ParamDoc {
  displayName: string
  description: string
  units: string | null
  increment: number | null
  range: { low: number; high: number } | null
  /** Named values, e.g. `0.15: 'Medium'`. Upstream shows a plain number input for these tools. */
  values: ReadonlyMap<number, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function optionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Validate one parameter's metadata object. */
export function parseParamDoc(value: unknown): ParamDoc | null {
  if (!isRecord(value)) return null
  const description = optionalString(value, 'Description')
  if (description === null) return null
  const rangeValue = value.Range
  let range: ParamDoc['range'] = null
  if (isRecord(rangeValue)) {
    const low = optionalNumber(rangeValue, 'low')
    const high = optionalNumber(rangeValue, 'high')
    if (low !== null && high !== null) range = { low, high }
  }
  const values = new Map<number, string>()
  if (isRecord(value.Values)) {
    for (const [key, label] of Object.entries(value.Values)) {
      const n = Number(key)
      if (typeof label === 'string' && Number.isFinite(n)) values.set(n, label)
    }
  }
  return {
    displayName: optionalString(value, 'DisplayName') ?? '',
    description,
    units: optionalString(value, 'Units'),
    increment: optionalNumber(value, 'Increment'),
    range,
    values
  }
}

/**
 * Find a parameter in an ArduPilot `params.json` tree, whose keys are name prefixes
 * (upstream `recursive_search` in `Libraries/ParameterMetadata.js`).
 */
export function findParamDoc(tree: unknown, name: string): ParamDoc | null {
  if (!isRecord(tree)) return null
  for (const [key, value] of Object.entries(tree)) {
    if (!name.startsWith(key)) continue
    if (name === key) return parseParamDoc(value)
    const found = findParamDoc(value, name)
    if (found) return found
  }
  return null
}

function docsFor<N extends string>(tree: unknown, names: readonly N[]): ReadonlyMap<N, ParamDoc> {
  const docs = new Map<N, ParamDoc>()
  for (const name of names) {
    const doc = findParamDoc(tree, name)
    if (doc) docs.set(name, doc)
  }
  return docs
}

// ---------- Copter ----------

export const COPTER_PARAM_NAMES = [
  'ATC_RATE_R_MAX',
  'ATC_ACC_R_MAX',
  'ATC_RATE_P_MAX',
  'ATC_ACC_P_MAX',
  'ATC_RATE_Y_MAX',
  'ATC_ACC_Y_MAX',
  'ACRO_RP_RATE_TC',
  'PILOT_Y_RATE_TC',
  'ATC_INPUT_TC'
] as const
export type CopterParamName = (typeof COPTER_PARAM_NAMES)[number]
export type CopterParams = Readonly<Record<CopterParamName, number>>

export const COPTER_DEFAULTS: CopterParams = {
  ATC_RATE_R_MAX: 0,
  ATC_ACC_R_MAX: 1100,
  ATC_RATE_P_MAX: 0,
  ATC_ACC_P_MAX: 1100,
  ATC_RATE_Y_MAX: 0,
  ATC_ACC_Y_MAX: 270,
  ACRO_RP_RATE_TC: 0,
  PILOT_Y_RATE_TC: 0,
  ATC_INPUT_TC: 0.15
}

interface CopterAxisParams {
  rateMax: CopterParamName
  accelMax: CopterParamName
  /** Rate time constant used in rate (acro) modes. */
  rateTc: CopterParamName
}

/** Upstream `get_param_names_for_axi`. */
export const COPTER_AXIS_PARAMS = {
  R: { rateMax: 'ATC_RATE_R_MAX', accelMax: 'ATC_ACC_R_MAX', rateTc: 'ACRO_RP_RATE_TC' },
  P: { rateMax: 'ATC_RATE_P_MAX', accelMax: 'ATC_ACC_P_MAX', rateTc: 'ACRO_RP_RATE_TC' },
  Y: { rateMax: 'ATC_RATE_Y_MAX', accelMax: 'ATC_ACC_Y_MAX', rateTc: 'PILOT_Y_RATE_TC' }
} as const satisfies Record<CopterAxis, CopterAxisParams>

export interface ParamField<N extends string> {
  name: N
  /** False when the parameter has no effect in the selected mode (upstream disables the input). */
  enabled: boolean
}

/** The copter parameters shown for an axis, in upstream order, and which apply in `mode`. */
export function copterParamFields(axis: CopterAxis, mode: CopterMode): readonly ParamField<CopterParamName>[] {
  const names = COPTER_AXIS_PARAMS[axis]
  return [
    { name: names.rateMax, enabled: true },
    { name: names.accelMax, enabled: true },
    { name: names.rateTc, enabled: mode === 'rate' },
    { name: 'ATC_INPUT_TC', enabled: mode !== 'rate' }
  ]
}

export const COPTER_PARAM_DOCS: ReadonlyMap<CopterParamName, ParamDoc> = docsFor(copterParamsJson, COPTER_PARAM_NAMES)

// ---------- Plane ----------

export const PLANE_PARAM_NAMES = [
  'RLL2SRV_RMAX',
  'RLL2SRV_ACCEL',
  'RLL2SRV_TCONST',
  'RLL_ANGLE_P',
  'PTCH2SRV_RMAX_UP',
  'PTCH2SRV_RMAX_DN',
  'PTCH2SRV_ACCEL',
  'PTCH2SRV_TCONST',
  'PTCH_ANGLE_P'
] as const
export type PlaneParamName = (typeof PLANE_PARAM_NAMES)[number]
export type PlaneParams = Readonly<Record<PlaneParamName, number>>

export const PLANE_DEFAULTS: PlaneParams = {
  RLL2SRV_RMAX: 0,
  RLL2SRV_ACCEL: 500,
  RLL2SRV_TCONST: 0.5,
  RLL_ANGLE_P: 0,
  PTCH2SRV_RMAX_UP: 0,
  PTCH2SRV_RMAX_DN: 0,
  PTCH2SRV_ACCEL: 500,
  PTCH2SRV_TCONST: 0.5,
  PTCH_ANGLE_P: 0
}

/** The plane parameters shown for an axis, in upstream order. All apply in every mode. */
export const PLANE_AXIS_PARAMS = {
  R: ['RLL2SRV_RMAX', 'RLL2SRV_ACCEL', 'RLL2SRV_TCONST', 'RLL_ANGLE_P'],
  P: ['PTCH2SRV_RMAX_UP', 'PTCH2SRV_RMAX_DN', 'PTCH2SRV_ACCEL', 'PTCH2SRV_TCONST', 'PTCH_ANGLE_P']
} as const satisfies Record<PlaneAxis, readonly PlaneParamName[]>

export const PLANE_PARAM_DOCS: ReadonlyMap<PlaneParamName, ParamDoc> = docsFor(planeParamsJson, PLANE_PARAM_NAMES)
