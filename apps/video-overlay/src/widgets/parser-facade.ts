/**
 * The log object widget scripts receive. Upstream's widget documents import
 * `modules/JsDataflashParser/parser.js`, build a `DataflashParser` from the log buffer and hand it
 * to the user script's `loadLog(log)`. This port serves a module at that path which exports this
 * facade instead (see `documents.ts`): the parser's public surface (`processData`, `get`,
 * `get_instance`, `extractStartTime`, `messageTypes`, `messages`, `stats`, `buffer`) backed by
 * `@apwt/dataflash`, returning what upstream returned (`parser-facade.test.ts` compares them):
 *
 * - numeric columns as `Float64Array`, text as arrays of strings, `int16[32]` as arrays of plain
 *   arrays, a fresh copy on every call (scripts may modify what they get);
 * - `messageTypes` with upstream's `expressions`, `units`, `multipliers` and `complexFields`
 *   (unit labels built with upstream's tables and formula, with the parser's proven fixes: `µ` for
 *   1e-6, and an FMTU for an undefined type skipped), instances in order of appearance;
 * - instance numbers matched as property keys (`instance in InstancesOffsetArray`);
 * - an instanced message read without an instance returns `undefined` (upstream threw a TypeError
 *   there, a proven bug: see docs/bug-proofs/video-overlay.md #119);
 * - every array, object and date created in the calling document's realm, as a module imported by
 *   that document would create them (`forRealm`).
 *
 * The parser's internals (`FMT`, `data`, `offset`, `parse_type`, `parseAtOffset`, `loadType`, ...)
 * are not provided.
 *
 * Candidate to share with telemetry-dashboard.
 */
import { BUILTIN_MULTIPLIERS, BUILTIN_UNITS, DataflashLog, type Column, type MessageTypeInfo } from '@apwt/dataflash'

/** Upstream column: numbers as `Float64Array`, text as strings, `int16[32]` as arrays of numbers. */
export type UpstreamColumn = Float64Array | string[] | number[][]

/** Upstream `messageTypes[name].complexFields[field]`. */
export interface UpstreamComplexField {
  readonly name: string
  readonly units: string
  readonly multiplier: number | undefined
}

/** Upstream `messageTypes[name]`. */
export interface UpstreamMessageType {
  readonly expressions: readonly string[]
  /** Unit label per FMTU unit id (undefined for ids upstream's table lacks); undefined without FMTU. */
  readonly units: readonly (string | undefined)[] | undefined
  readonly multipliers: readonly (number | undefined)[] | undefined
  readonly complexFields: Readonly<Record<string, UpstreamComplexField>>
  /** Instance number -> "NAME[instance]", only for instanced messages. */
  readonly instances?: Readonly<Record<string, string>>
}

/** Upstream `stats()` entry. */
export interface UpstreamMessageStats {
  readonly count: number
  readonly msg_size: number
  readonly size: number
}

/** The constructors results are built with: the calling document's. */
export interface Realm {
  readonly Array: ArrayConstructor
  readonly Float64Array: Float64ArrayConstructor
  readonly Object: ObjectConstructor
  readonly Date: DateConstructor
}

/**
 * Upstream `multipliersTable`: unit prefixes for three multipliers, except that 1e-6 is the SI
 * prefix micro (`µ`) where upstream has `n` (proven upstream bug, docs/bug-proofs/js-dataflash-parser.md #2).
 */
const MULTIPLIER_PREFIX: Readonly<Record<string, string>> = { '0.000001': '\u00b5', '1000': 'M', '0.001': 'm' }

function isTextColumn(column: string[] | Int16Array[]): column is string[] {
  return column.length === 0 || typeof column[0] === 'string'
}

/** A value used as a property key (`String()`; objects through their `toString`). */
function propertyKey(value: unknown): string {
  return String(value)
}

function own<T>(table: Readonly<Record<string, T>>, key: string | undefined): T | undefined {
  return key !== undefined && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined
}

/**
 * Upstream `populateUnits()`: per message id, the unit label and multiplier of every character of
 * its FMTU `UnitIds` and `MultIds` (last record wins). A record for an undefined message type is
 * skipped, as `@apwt/dataflash` does (upstream threw and abandoned every later record: proven bug,
 * docs/bug-proofs/js-dataflash-parser.md #3); without FMTU there are none.
 */
function fmtuUnits(log: DataflashLog): Map<number, { units: (string | undefined)[]; multipliers: (number | undefined)[] }> {
  const out = new Map<number, { units: (string | undefined)[]; multipliers: (number | undefined)[] }>()
  if (log.messageType('FMTU')?.instances !== undefined) return out
  const types = log.get('FMTU', 'FmtType')
  const unitIds = log.get('FMTU', 'UnitIds')
  const multIds = log.get('FMTU', 'MultIds')
  if (types === undefined || unitIds === undefined || multIds === undefined) return out
  if (!ArrayBuffer.isView(types) || !Array.isArray(unitIds) || !Array.isArray(multIds)) return out
  const defined = new Set(log.formats().map((f) => f.id))
  for (let i = 0; i < types.length; i++) {
    const type = Number(types[i])
    if (!defined.has(type)) continue
    const units = unitIds[i]
    const mults = multIds[i]
    out.set(type, {
      units: typeof units === 'string' ? Array.from(units, (c) => own(BUILTIN_UNITS, c)) : [],
      multipliers: typeof mults === 'string' ? Array.from(mults, (c) => own(BUILTIN_MULTIPLIERS, c)) : []
    })
  }
  return out
}

/** Instance numbers in order of first appearance in the log (upstream `availableInstances`). */
function instancesInLogOrder(log: DataflashLog, info: MessageTypeInfo): number[] {
  const field = info.instanceField
  const column = field === undefined ? undefined : log.get(info.name, field)
  if (column === undefined || !ArrayBuffer.isView(column)) return [...(info.instances?.keys() ?? [])]
  const seen = new Set<number>()
  for (const value of column) seen.add(value)
  return [...seen]
}

export class DataflashParserFacade {
  buffer: ArrayBuffer | null = null
  messageTypes: Record<string, UpstreamMessageType> = {}
  /** Upstream fills this from `processData`'s message list; widget documents pass an empty one. */
  messages: Record<string, unknown> = {}
  private log: DataflashLog | undefined
  private readonly realm: Realm

  constructor(realm: Realm = globalThis) {
    this.realm = realm
  }

  /** The facade class for a document: `new DataflashParser()` there builds results in its realm. */
  static forRealm(realm: Realm): new () => DataflashParserFacade {
    return class extends DataflashParserFacade {
      constructor() {
        super(realm)
      }
    }
  }

  /** A plain object of this realm with the given entries. */
  private object<T extends object>(entries: T): T {
    return this.realm.Object.assign(new this.realm.Object(), entries)
  }

  /** Parse the log (upstream `processData(data, msgs)`; widget documents pass no messages to preload). */
  processData(
    data: ArrayBuffer,
    _msgs?: readonly string[]
  ): { types: Record<string, UpstreamMessageType>; messages: Record<string, unknown> } {
    this.buffer = data
    const log = DataflashLog.parse(data)
    this.log = log
    const realm = this.realm
    const types: Record<string, UpstreamMessageType> = this.object({})
    const fmtu = fmtuUnits(log)
    for (const [name, info] of log.messageTypes()) {
      // Upstream's `msg.units` / `msg.multipliers` exist only for types with an FMTU record.
      const tables = fmtu.get(info.id)
      const units = tables === undefined ? undefined : realm.Array.from(tables.units)
      const multipliers = tables === undefined ? undefined : realm.Array.from(tables.multipliers)
      const complexFields: Record<string, UpstreamComplexField> = this.object({})
      info.fieldNames.forEach((field, i) => {
        const multiplier = multipliers?.[i]
        complexFields[field] = this.object({
          name: field,
          units: units === undefined ? '?' : (own(MULTIPLIER_PREFIX, String(multiplier)) ?? '') + String(units[i]),
          multiplier: units === undefined ? 1.0 : multiplier
        })
      })
      const expressions = realm.Array.from(info.fieldNames)
      const entry = () => this.object({ expressions, units, multipliers, complexFields })
      const base = entry()
      types[name] = base
      if (info.instances === undefined) continue
      const instances: Record<string, string> = this.object({})
      for (const instance of instancesInLogOrder(log, info)) {
        const instName = `${name}[${instance}]`
        instances[String(instance)] = instName
        types[instName] = entry()
      }
      // Added to the entry already in place, so the message keeps its position before its instances.
      types[name] = this.object({ ...base, instances })
    }
    this.messageTypes = types
    this.messages = this.object({})
    return this.object({ types, messages: this.messages })
  }

  /** A column as upstream's `get_type_array` built it, new and in this realm. */
  private column(column: Column): UpstreamColumn {
    const realm = this.realm
    if (!Array.isArray(column)) return realm.Float64Array.from(column)
    if (isTextColumn(column)) return realm.Array.from(column)
    return realm.Array.from(column, (values) => realm.Array.from(values))
  }

  /**
   * One field (or, without `field`, an object of every field) of a message, optionally of one
   * instance. `undefined` for a missing message, instance or field, or when there are no records.
   */
  get_instance(name: unknown, instance: unknown, field?: unknown): UpstreamColumn | Record<string, UpstreamColumn> | undefined {
    const log = this.log
    if (log === undefined) return undefined
    // Upstream compared names with `==` (an array or object compares as its string form).
    const key = typeof name === 'string' ? name : typeof name === 'object' && name !== null ? propertyKey(name) : undefined
    const info = key === undefined ? undefined : log.messageType(key)
    if (info === undefined) return undefined
    let inst: number | undefined
    if (instance !== null && instance !== undefined) {
      // `instance in InstancesOffsetArray`: the instance as a property key.
      const key = typeof instance === 'symbol' ? undefined : propertyKey(instance)
      inst = [...(info.instances?.keys() ?? [])].find((k) => String(k) === key)
      if (inst === undefined) return undefined
    } else if (info.instances !== undefined) {
      // Proven upstream bug #119, fixed: upstream deleted the message's `OffsetArray` when splitting
      // it into instances, so reading it without an instance threw. Like upstream's other no-data
      // paths, this returns `undefined`, which the widget scripts report as an unknown log message.
      return undefined
    }
    if (field) {
      if (typeof field !== 'string') return undefined
      const column = inst === undefined ? log.get(info.name, field) : log.getInstance(info.name, inst, field)
      return column === undefined || column.length === 0 ? undefined : this.column(column)
    }
    const message = log.getMessage(info.name, inst)
    if (message === undefined || message.length === 0) return undefined
    const all: Record<string, UpstreamColumn> = this.object({})
    for (const [key, column] of Object.entries(message.columns)) all[key] = this.column(column)
    return all
  }

  get(name: unknown, field?: unknown): UpstreamColumn | Record<string, UpstreamColumn> | undefined {
    return this.get_instance(name, null, field)
  }

  /** Wall-clock start of the log from the first 3D-fix GPS time, or `undefined`. */
  extractStartTime(): Date | undefined {
    const start = this.log?.startTime()
    return start === undefined ? undefined : new this.realm.Date(start.getTime())
  }

  /** Composition of the log in bytes, as upstream `stats()` reports it. */
  stats(): Record<string, UpstreamMessageStats> {
    const out: Record<string, UpstreamMessageStats> = this.object({})
    if (this.log === undefined) return out
    for (const [name, s] of this.log.stats()) out[name] = this.object({ count: s.count, msg_size: s.recordSize, size: s.bytes })
    return out
  }
}
