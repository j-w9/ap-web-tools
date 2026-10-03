/**
 * The decisions and texts of the parameter editor (upstream `modules/MAVLink/mavparam-ui.js`,
 * class `MAVParamUI`), as pure functions so they can be compared with the original
 * (`editor.test.ts`). `ui/ParameterEditor.tsx` renders them.
 */
import { jsonEntries, jsonHasOwn, jsonText, type DefinitionsResult, type ParamDefinition } from './definitions.js'
import type { MavParam, ParamChange } from './model.js'
import type { Param, ParamType, ParamVehicle } from './packed.js'

export const PAGE_SIZE = 50

/** Upstream `setClient`'s message for the new client, and the constructor's before any client. */
export function clientStatus(hasClient: boolean, everCleared: boolean): string {
  if (hasClient) return 'Fetch parameters to begin.'
  return everCleared ? 'Disconnected. Reconnect to fetch current parameters.' : 'Connect to a vehicle to fetch parameters.'
}

export function metaStatusText(vehicle: ParamVehicle, result: Pick<DefinitionsResult, 'cached' | 'stale'>): string {
  return `${vehicle} descriptions${result.stale ? ' (offline cached copy)' : result.cached ? ' (cached)' : ''}.`
}

export interface PageView {
  /** The page shown; upstream stores this clamped value back into its page. */
  readonly page: number
  readonly pages: number
  readonly start: number
  readonly countText: string
}

export function pageView(page: number, matches: number, total: number): PageView {
  const pages = Math.max(1, Math.ceil(matches / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const start = current * PAGE_SIZE
  return {
    page: current,
    pages,
    start,
    countText: `${matches ? start + 1 : 0}–${Math.min(start + PAGE_SIZE, matches)} of ${matches} matches · ${total} parameters`
  }
}

/** The hint line under a description. */
export function rowHints(d: ParamDefinition | undefined): string {
  const hints: string[] = []
  if (d === undefined) return ''
  if (d.units) hints.push(`Units: ${jsonText(d.units)}`)
  if (d.range) hints.push(`Range: ${describeRange(d.range)}`)
  if (d.increment) hints.push(`Increment: ${jsonText(d.increment)}`)
  if (d.rebootRequired) hints.push('Reboot required')
  return hints.join(' · ')
}

function describeRange(range: unknown): string {
  if (typeof range !== 'object' || range === null) return jsonText(range)
  // Upstream reads `.low`/`.high` of any object, so an array range shows "undefined to undefined".
  const low: unknown = Reflect.get(range, 'low')
  const high: unknown = Reflect.get(range, 'high')
  return `${jsonText(low)} to ${jsonText(high)}`
}

export const rowLabel = (d: ParamDefinition | undefined): string | null => (d?.label ? jsonText(d.label) : null)

export const rowDescription = (d: ParamDefinition | undefined): string =>
  d?.description ? jsonText(d.description) : 'No description available.'

export const defaultText = (p: Param, format: (p: Param, value: number) => string): string =>
  `Default: ${p.defaultValue === undefined ? 'unavailable' : format(p, p.defaultValue)}`

/** Enum choices as `[value, "value: text"]`; empty when the select is not shown. */
export function rowOptions(d: ParamDefinition | undefined): [string, string][] {
  return jsonEntries(d?.values ?? {}).map(([value, text]) => [value, `${value}: ${jsonText(text)}`])
}

/** The option selected when the row is drawn: the current value if it is one of the choices. */
export const selectedOption = (d: ParamDefinition | undefined, p: Param): string =>
  jsonHasOwn(d?.values ?? {}, String(p.value)) ? String(p.value) : ''

/** Bitmask choices as `[bit, "bit: text"]`, bits 0–31 with decimal keys only. */
export function rowBits(d: ParamDefinition | undefined): [string, string][] {
  return jsonEntries(d?.bitmask ?? {})
    .filter(([bit]) => /^\d+$/.test(bit) && Number(bit) <= 31)
    .map(([bit, text]) => [bit, `${bit}: ${jsonText(text)}`])
}

/** Whether a bit's checkbox is ticked for the value text in the input. */
export function bitChecked(valueText: string, bit: string): boolean {
  return Number.isFinite(Number(valueText)) && (BigInt(Math.trunc(Number(valueText))) & (1n << BigInt(bit))) !== 0n
}

/**
 * The value text after ticking or clearing a bit; throws (as `BigInt` does) when the text is not
 * an integer, which upstream reports as "Enter an integer before changing bitmask options.".
 */
export function toggleBit(valueText: string, bit: string, checked: boolean, type: ParamType): string {
  let value = BigInt(valueText)
  const mask = 1n << BigInt(bit)
  value = checked ? value | mask : value & ~mask
  // Packed int32 bitmasks retain bit 31 without float rounding.
  if (type === 3) value = BigInt.asIntN(32, value)
  return String(value)
}

export const BITMASK_ERROR = 'Enter an integer before changing bitmask options.'

/** Parameters written by "Save to file" (search never limits the export). */
export function saveSelection(params: Iterable<Param>, scope: 'all' | 'changed'): Param[] {
  return [...params].filter((p) => scope === 'all' || (p.defaultValue !== undefined && p.value !== p.defaultValue))
}

export const saveFileName = (vehicle: ParamVehicle, scope: 'all' | 'changed'): string => `${vehicle.toLowerCase()}-${scope}.parm`

export const savedMessage = (count: number): string => `Saved ${count} parameters. Search does not limit file exports.`

export const MAX_FILE_BYTES = 4 * 1024 * 1024

export interface ImportPlan {
  readonly changes: ParamChange[]
  readonly skipped: string[]
}

/**
 * Removes known read-only parameters from `values` (in place, as upstream) and computes the
 * changes; throws as `MavParam.changes` does.
 */
export function importPlan(
  client: Pick<MavParam, 'params' | 'definitions' | 'changes'>,
  values: Map<string, number>
): ImportPlan {
  const skipped: string[] = []
  for (const name of [...values.keys()]) {
    if (client.params.has(name) && client.definitions.get(name)?.readOnly === true) {
      skipped.push(name)
      values.delete(name)
    }
  }
  return { changes: client.changes(values), skipped }
}

export const importHeading = (fileName: string, changes: number): string => `${fileName}: ${changes} changes`
export const skippedText = (skipped: readonly string[]): string => `Skipped read-only parameters: ${skipped.join(', ')}`
