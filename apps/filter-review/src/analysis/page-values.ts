import type { DataflashLog } from '@apwt/dataflash'
import {
  NOTCH_PREFIXES,
  unsignedBitmask,
  type FilterParams,
  type NOTCH_PARAM_SUFFIXES,
  type NotchParams
} from './filter-params.js'

/**
 * Upstream keeps every filter setting in a page input and reads it back with `parseFloat` (or
 * `parameter_get_value` for bitmasks) whenever it rebuilds the filters. What the input holds
 * decides the result: an empty input reads as NaN, a drop-down set to a value it does not offer
 * reads as empty, and a parameter missing from the next log keeps the value the previous log
 * left. This module models those inputs as the strings the DOM holds, so the port reads the
 * same values, writes the same `.param` text and builds the same Filter Tool link.
 */

type NotchKey = keyof NotchParams

/** `NOTCH_PARAM_SUFFIXES` with literal types, for the parameter name union. */
const SUFFIXES = {
  enable: 'ENABLE',
  mode: 'MODE',
  freq: 'FREQ',
  bandwidth: 'BW',
  attenuation: 'ATT',
  ref: 'REF',
  minRatio: 'FM_RAT',
  harmonics: 'HMNCS',
  options: 'OPTS'
} as const satisfies typeof NOTCH_PARAM_SUFFIXES
type NotchParamName = `${(typeof NOTCH_PREFIXES)[number]}${(typeof SUFFIXES)[NotchKey]}`

/** Every filter parameter input on the page. */
export type FilterParamName = 'INS_GYRO_FILTER' | 'SCHED_LOOP_RATE' | NotchParamName

/** Value string of every filter parameter input, as the DOM holds it. */
export type PageValues = Readonly<Record<FilterParamName, string>>

const NOTCH_KEYS = Object.keys(SUFFIXES) as NotchKey[]

function notchName(index: number, key: NotchKey): FilterParamName {
  const prefix = NOTCH_PREFIXES[index]
  if (prefix === undefined) throw new RangeError(`No harmonic notch ${index}`)
  return `${prefix}${SUFFIXES[key]}`
}

/** Filter parameter names in page order (upstream `index.html` order of the inputs). */
export const FILTER_PARAM_NAMES: readonly FilterParamName[] = [
  'INS_GYRO_FILTER',
  'SCHED_LOOP_RATE',
  ...NOTCH_PREFIXES.flatMap((_, i) => NOTCH_KEYS.map((k) => notchName(i, k)))
]

const FILTER_PARAM_SET: ReadonlySet<string> = new Set(FILTER_PARAM_NAMES)

/** Whether `name` is the id of a filter parameter input. */
export function isFilterParamName(name: string): name is FilterParamName {
  return FILTER_PARAM_SET.has(name)
}

/**
 * Options of the parameters that upstream `load_param_inputs` turns into drop-downs (those with
 * `Values` in `params.json`: `_ENABLE` and `_MODE`).
 */
const SELECT_OPTIONS: Partial<Record<NotchKey, readonly string[]>> = {
  enable: ['0', '1'],
  mode: ['0', '1', '2', '3', '4', '5']
}

/** Drop-down options of a parameter, or undefined for a number input. */
export function selectOptions(name: FilterParamName): readonly string[] | undefined {
  for (const key of NOTCH_KEYS) {
    if (NOTCH_PREFIXES.some((_, i) => notchName(i, key) === name)) return SELECT_OPTIONS[key]
  }
  return undefined
}

/**
 * Value a Chromium `<input type="number">` keeps when assigned `value` (its value sanitization):
 * the string itself when it is a finite decimal number (an optional `-`, digits with an optional
 * fraction or a leading `.`, an optional exponent, no trailing `.`, no `+`, no whitespace),
 * otherwise the empty string.
 */
export function sanitizeNumberInput(value: string): string {
  if (value === '') return ''
  if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value) || value.endsWith('.')) return ''
  return Number.isFinite(Number(value)) ? value : ''
}

/**
 * Value the input of `name` holds after upstream `parameter_set_value(name, value)`: a
 * drop-down keeps only one of its option values (anything else selects nothing, value `""`), a
 * number input applies its sanitization.
 */
export function assignedValue(name: FilterParamName, value: string | number): string {
  const text = String(value)
  const options = selectOptions(name)
  if (options !== undefined) return options.includes(text) ? text : ''
  return sanitizeNumberInput(text)
}

/** Values the page starts with (`index.html` value attributes), before any `reset()`. */
export const INITIAL_PAGE_VALUES: PageValues = Object.fromEntries(
  FILTER_PARAM_NAMES.map((n) => [n, n === 'INS_GYRO_FILTER' ? '20.0' : n === 'SCHED_LOOP_RATE' ? '400' : '0'])
) as Record<FilterParamName, string>

/** Non-zero notch defaults upstream `reset()` writes before each log is read. */
const RESET_DEFAULTS: readonly { readonly suffix: string; readonly value: number }[] = [
  { suffix: '_FREQ', value: 80 },
  { suffix: '_BW', value: 40 },
  { suffix: '_ATT', value: 40 },
  { suffix: '_HMNCS', value: 3 },
  { suffix: '_MODE', value: 1 },
  { suffix: '_FM_RAT', value: 1 }
]

/**
 * Upstream `reset()`: writes the six non-zero notch defaults and leaves every other input
 * (`_ENABLE`, `_REF`, `_OPTS`, `INS_GYRO_FILTER`, `SCHED_LOOP_RATE`) as it was.
 */
export function resetPageValues(values: PageValues): PageValues {
  const out: Record<FilterParamName, string> = { ...values }
  for (const name of FILTER_PARAM_NAMES) {
    for (const d of RESET_DEFAULTS) {
      if (name.endsWith(d.suffix)) out[name] = assignedValue(name, d.value)
    }
  }
  return out
}

/** Values the page shows before the first log: `index.html` values after the page-load `reset()`. */
export function defaultPageValues(): PageValues {
  return resetPageValues(INITIAL_PAGE_VALUES)
}

/** Return `values` with one input assigned as upstream `parameter_set_value` does. */
export function withPageValue(values: PageValues, name: FilterParamName, value: string | number): PageValues {
  return { ...values, [name]: assignedValue(name, value) }
}

/**
 * Inputs after loading a log (upstream `load()`): `reset()` defaults, then every filter
 * parameter the log has (last logged value). A parameter the log lacks keeps its previous
 * value, which for `_ENABLE`, `_REF`, `_OPTS`, `INS_GYRO_FILTER` and `SCHED_LOOP_RATE` is
 * whatever the previous log (or the user) left there.
 */
export function pageValuesFromLog(previous: PageValues, log: DataflashLog): PageValues {
  let out = resetPageValues(previous)
  for (const name of FILTER_PARAM_NAMES) {
    const value = log.param(name)
    if (value !== undefined) out = withPageValue(out, name, value)
  }
  return out
}

/** Bit width of a bitmask input (`data-type`): `_HMNCS` follows the firmware, `_OPTS` is 32-bit. */
export function bitmaskBits(name: FilterParamName, sixteenHarmonics: boolean): number | undefined {
  if (name.endsWith('_HMNCS')) return sixteenHarmonics ? 32 : 8
  if (name.endsWith('_OPTS')) return 32
  return undefined
}

/** Upstream `parameter_get_value`: `parseFloat` of the input, narrow bitmasks made unsigned. */
export function pageNumber(values: PageValues, name: FilterParamName, sixteenHarmonics: boolean): number {
  const value = parseFloat(values[name])
  const bits = bitmaskBits(name, sixteenHarmonics)
  return bits === undefined ? value : unsignedBitmask(value, bits)
}

/**
 * Filter parameters as upstream `load_filters` reads them. `INS_GYRO_FILTER` and
 * `SCHED_LOOP_RATE` are read with plain `parseFloat`, as upstream does.
 */
export function filterParamsFromPage(values: PageValues, sixteenHarmonics: boolean): FilterParams {
  const notch = (index: number): NotchParams => {
    const out: Record<NotchKey, number> = {
      enable: 0,
      mode: 0,
      freq: 0,
      bandwidth: 0,
      attenuation: 0,
      ref: 0,
      minRatio: 0,
      harmonics: 0,
      options: 0
    }
    for (const key of NOTCH_KEYS) out[key] = pageNumber(values, notchName(index, key), sixteenHarmonics)
    return out
  }
  return {
    gyroFilter: parseFloat(values.INS_GYRO_FILTER),
    loopRate: parseFloat(values.SCHED_LOOP_RATE),
    notches: [notch(0), notch(1)]
  }
}

/** Name of notch `index`'s input for `key`. */
export function notchInputName(index: number, key: NotchKey): FilterParamName {
  return notchName(index, key)
}

/**
 * Value upstream's bitmask checkboxes write (`read_bits`): the OR of the ticked bits, masked to
 * the input's width and shown signed when narrower than 32 bits.
 */
export function bitmaskFromBits(bits: Iterable<number>, width: number): number {
  let value = 0
  for (const bit of bits) value |= 1 << bit
  if (width < 32) {
    value &= 0xffffffff >>> (32 - width)
    const signMask = 1 << (width - 1)
    if ((value & signMask) !== 0) value -= 1 << width
  }
  return value
}
