import { NOTCH_PARAM_SUFFIXES, notchParamNames, unsignedBitmask, type FilterParams, type NotchParams } from './filter-params.js'

/**
 * Shortest decimal string that round-trips through a 32-bit float (upstream `param_to_string`).
 * Throws if no 7 to 9 significant digit form round-trips, as upstream does.
 */
export function paramToString(value: number): string {
  // Make sure number can be represented by 32 bit float
  const floatVal = Math.fround(value)
  for (const figures of [7, 8, 9]) {
    const numberVal = Number(floatVal.toPrecision(figures))
    // Did not get original value, try more digits
    if (floatVal !== Math.fround(numberVal)) continue
    // Convert number back to string with no trailing zeros
    return numberVal.toString()
  }
  throw new Error(`Could not convert ${value} to float string`)
}

/** Value of a bitmask as the page shows it: narrow (8-bit) masks are signed, as logged. */
export function signedBitmask(value: number, bits: number): number {
  if (bits >= 32) return value
  const masked = value & (0xffffffff >>> (32 - bits))
  return (masked & (1 << (bits - 1))) !== 0 ? masked - (1 << bits) : masked
}

/** Choices upstream offers for the notch parameters it shows as drop-downs. */
const SELECT_VALUES: Partial<Record<keyof NotchParams, readonly number[]>> = {
  enable: [0, 1],
  mode: [0, 1, 2, 3, 4, 5]
}

/** Notch fields upstream renders as number inputs, in page order (the rest are drop-downs). */
const INPUT_FIELDS = (Object.keys(NOTCH_PARAM_SUFFIXES) as (keyof NotchParams)[]).filter((k) => !(k in SELECT_VALUES))
const SELECT_FIELDS = (Object.keys(NOTCH_PARAM_SUFFIXES) as (keyof NotchParams)[]).filter((k) => k in SELECT_VALUES)

/** One `INS_*` parameter as upstream reads it from the page: name and the field's value. */
export interface PageParam {
  readonly name: string
  readonly value: number
}

/**
 * The `INS_*` parameters in the order upstream finds them on the page: the number inputs
 * (low-pass, then each notch's numeric fields), then the drop-downs (each notch's enable and
 * mode). A drop-down whose value is not one of its options reads as empty, i.e. 0.
 */
export function pageParams(params: FilterParams, sixteenHarmonics: boolean): PageParam[] {
  const harmonicBits = sixteenHarmonics ? 32 : 8
  const field = (notch: NotchParams, key: keyof NotchParams): number => {
    if (key === 'harmonics') return signedBitmask(notch.harmonics, harmonicBits)
    const options = SELECT_VALUES[key]
    if (options !== undefined && !options.includes(notch[key])) return 0
    return notch[key]
  }
  const out: PageParam[] = [{ name: 'INS_GYRO_FILTER', value: params.gyroFilter }]
  for (const keys of [INPUT_FIELDS, SELECT_FIELDS]) {
    params.notches.forEach((notch, i) => {
      const names = notchParamNames(i)
      for (const key of keys) out.push({ name: names[key], value: field(notch, key) })
    })
  }
  return out
}

/** Text of the `.param` file upstream's "Save Parameters" downloads. */
export function filterParamFileText(params: FilterParams, sixteenHarmonics: boolean): string {
  return pageParams(params, sixteenHarmonics)
    .map((p) => `${p.name},${paramToString(p.value)}\n`)
    .join('')
}

/** Result of reading a parameter file into the filter settings. */
export interface ParamFileResult {
  readonly params: FilterParams
  /** Names that were recognised and applied. */
  readonly applied: readonly string[]
}

/**
 * Apply a `.param` / `.parm` file to the filter settings (upstream `load_parameters`): every
 * line is split on whitespace, commas or `=`, and recognised names overwrite their field.
 */
export function applyParamFile(text: string, params: FilterParams, sixteenHarmonics: boolean): ParamFileResult {
  const next: FilterParams = {
    gyroFilter: params.gyroFilter,
    loopRate: params.loopRate,
    notches: [{ ...params.notches[0] }, { ...params.notches[1] }]
  }
  const lookup = new Map<string, (value: number) => void>([
    ['INS_GYRO_FILTER', (v) => (next.gyroFilter = v)],
    ['SCHED_LOOP_RATE', (v) => (next.loopRate = v)]
  ])
  next.notches.forEach((notch, i) => {
    const names = notchParamNames(i)
    for (const key of Object.keys(names) as (keyof NotchParams)[]) {
      lookup.set(names[key], (v) => {
        notch[key] = key === 'harmonics' ? unsignedBitmask(v, sixteenHarmonics ? 32 : 8) : v
      })
    }
  })
  const applied: string[] = []
  for (const line of text.split('\n')) {
    const parts = line.split(/[\s,=\t]+/)
    const name = parts[0]
    const raw = parts[1]
    if (name === undefined || raw === undefined) continue
    const set = lookup.get(name)
    const value = parseFloat(raw)
    if (set === undefined || Number.isNaN(value)) continue
    set(value)
    applied.push(name)
  }
  return { params: next, applied }
}
