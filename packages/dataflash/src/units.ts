/**
 * Units and multipliers. ArduPilot logs carry UNIT and MULT tables and a FMTU
 * record per message type linking each field to a unit id and multiplier id.
 * Built-in tables (from the upstream parser) are used as a fallback for logs
 * that lack them.
 */

/** Built-in unit labels by unit id. */
export const BUILTIN_UNITS: Readonly<Record<string, string>> = {
  '-': '',
  '?': 'UNKNOWN',
  A: 'A',
  d: '°',
  b: 'B',
  k: '°/s',
  D: '°',
  e: '°/s/s',
  E: 'rad/s',
  G: 'Gauss',
  h: '°',
  i: 'A.s',
  J: 'W.s',
  L: 'rad/s/s',
  m: 'm',
  n: 'm/s',
  o: 'm/s/s',
  O: '°C',
  '%': '%',
  S: 'satellites',
  s: 's',
  q: 'rpm',
  r: 'rad',
  U: '°',
  u: 'ppm',
  v: 'V',
  P: 'Pa',
  w: 'Ohm',
  Y: 'us',
  z: 'Hz',
  '#': 'instance'
}

/** Built-in multiplier values by multiplier id. */
export const BUILTIN_MULTIPLIERS: Readonly<Record<string, number>> = {
  '-': 0,
  '?': 1,
  '2': 1e2,
  '1': 1e1,
  '0': 1,
  A: 1e-1,
  B: 1e-2,
  C: 1e-3,
  D: 1e-4,
  E: 1e-5,
  F: 1e-6,
  G: 1e-7,
  '!': 3.6,
  '/': 3600
}

/** Unit id that marks a message's instance-number field. */
export const INSTANCE_UNIT_ID = '#'

/**
 * Prefix prepended to a unit label for a given multiplier: upstream `multipliersTable`, except that
 * 1e-6 is the SI prefix micro (`µ`), where upstream has `n` (nano). Proven upstream bug, fixed: see
 * docs/bug-proofs/js-dataflash-parser.md.
 */
const SI_PREFIXES: ReadonlyMap<number, string> = new Map([
  [0.000001, '\u00b5'],
  [1000, 'M'],
  [0.001, 'm']
])

/** Unit and scaling metadata for one field. */
export interface FieldUnits {
  /** Unit id character from FMTU, or `undefined` when the log has no FMTU for the message. */
  readonly unitId: string | undefined
  /** Human unit label, with upstream's prefix applied for multipliers 1e-6 (`µ`), 1e-3 (`m`) and 1e3 (`M`). `"?"` when unknown. */
  readonly unit: string
  /** Multiplier id character from FMTU, or `undefined` when unknown. */
  readonly multiplierId: string | undefined
  /** Scale factor from the raw value to the unit (1 when unknown or none). */
  readonly multiplier: number
  /** Whether this field numbers the message instance (unit id `#`). */
  readonly isInstance: boolean
}

/** Lookup tables used to resolve FMTU ids. */
export interface UnitTables {
  readonly units: ReadonlyMap<string, string>
  readonly multipliers: ReadonlyMap<string, number>
}

/** Tables containing only the built-in fallbacks. */
export function builtinTables(): UnitTables {
  return {
    units: new Map(Object.entries(BUILTIN_UNITS)),
    multipliers: new Map(Object.entries(BUILTIN_MULTIPLIERS))
  }
}

/**
 * Resolve the FMTU ids for one message type into per-field metadata.
 *
 * @param fieldCount Number of fields in the message format.
 * @param unitIds FMTU `UnitIds` string, or `undefined` when absent.
 * @param multIds FMTU `MultIds` string, or `undefined` when absent.
 */
export function resolveFieldUnits(
  fieldCount: number,
  unitIds: string | undefined,
  multIds: string | undefined,
  tables: UnitTables
): FieldUnits[] {
  const out: FieldUnits[] = []
  for (let i = 0; i < fieldCount; i++) {
    const unitId = unitIds?.charAt(i) || undefined
    const multiplierId = multIds?.charAt(i) || undefined
    if (unitId === undefined) {
      out.push({ unitId, unit: '?', multiplierId, multiplier: 1, isInstance: false })
      continue
    }
    const label = tables.units.get(unitId) ?? '?'
    const multiplier = multiplierId === undefined ? 1 : (tables.multipliers.get(multiplierId) ?? 1)
    const prefix = SI_PREFIXES.get(multiplier) ?? ''
    out.push({
      unitId,
      unit: prefix + label,
      multiplierId,
      multiplier,
      isInstance: unitId === INSTANCE_UNIT_ID
    })
  }
  return out
}
