/**
 * The log object widget scripts receive. Upstream's sandbox iframe builds its own
 * `DataflashParser` (`modules/JsDataflashParser/parser.js`) from the log buffer and hands it to the
 * user script's `loadLog(log)`. This port has no copy of that module to serve, so the sandbox gets
 * this facade instead: the same public surface the scripts use (`processData`, `get`,
 * `get_instance`, `extractStartTime`, `messageTypes`, `stats`, `buffer`), backed by
 * `@apwt/dataflash`, which is verified against the upstream parser by oracle tests.
 *
 * Candidate to share with telemetry-dashboard.
 */
import { DataflashLog, type Column } from '@apwt/dataflash'

/** Upstream column: numbers as `Float64Array`, text and `int16[32]` arrays as plain arrays. */
export type UpstreamColumn = Float64Array | string[] | Int16Array[]

/** Upstream `messageTypes[name].complexFields[field]`. */
export interface UpstreamComplexField {
  readonly name: string
  readonly units: string
  readonly multiplier: number
}

/** Upstream `messageTypes[name]`. */
export interface UpstreamMessageType {
  readonly expressions: readonly string[]
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

/** Convert a column to upstream's array types (`get_type_array`). */
function toUpstreamColumn(column: Column): UpstreamColumn {
  if (Array.isArray(column)) return column
  return column instanceof Float64Array ? column : Float64Array.from(column)
}

export class DataflashParserFacade {
  buffer: ArrayBuffer | null = null
  messageTypes: Record<string, UpstreamMessageType> = {}
  private log: DataflashLog | undefined

  /** Parse the log (upstream `processData(data, msgs)`; message preloading is not needed here). */
  processData(data: ArrayBuffer, _msgs?: readonly string[]): { types: Record<string, UpstreamMessageType>; messages: object } {
    this.buffer = data
    this.log = DataflashLog.parse(data)
    const types: Record<string, UpstreamMessageType> = {}
    for (const [name, info] of this.log.messageTypes()) {
      const complexFields: Record<string, UpstreamComplexField> = {}
      for (const f of info.fields) complexFields[f.name] = { name: f.name, units: f.unit, multiplier: f.multiplier }
      const base = { expressions: info.fieldNames, complexFields }
      if (info.instances === undefined) {
        types[name] = base
        continue
      }
      const instances: Record<string, string> = {}
      for (const instance of info.instances.keys()) {
        const instName = `${name}[${instance}]`
        instances[String(instance)] = instName
        types[instName] = base
      }
      types[name] = { ...base, instances }
    }
    this.messageTypes = types
    return { types, messages: {} }
  }

  /**
   * One field (or, without `field`, an object of every field) of a message, optionally of one
   * instance. `undefined` for a missing message, instance or field, or when there are no records.
   */
  get_instance(
    name: string,
    instance: number | string | null | undefined,
    field?: string
  ): UpstreamColumn | Record<string, UpstreamColumn> | undefined {
    const log = this.log
    if (log === undefined) return undefined
    const info = log.messageType(name)
    if (info === undefined) return undefined
    let inst: number | undefined
    if (instance !== null && instance !== undefined) {
      inst = Number(instance)
      if (info.instances === undefined || !info.instances.has(inst)) return undefined
    } else if (info.instances !== undefined) {
      // Upstream bug, reproduced: splitting a message into instances deletes its `OffsetArray`, so
      // reading an instanced message without an instance number throws.
      throw new TypeError("Cannot read properties of undefined (reading 'length')")
    }
    if (field) {
      const column = inst === undefined ? log.get(name, field) : log.getInstance(name, inst, field)
      return column === undefined || column.length === 0 ? undefined : toUpstreamColumn(column)
    }
    const message = log.getMessage(name, inst)
    if (message === undefined || message.length === 0) return undefined
    const all: Record<string, UpstreamColumn> = {}
    for (const [key, column] of Object.entries(message.columns)) all[key] = toUpstreamColumn(column)
    return all
  }

  get(name: string, field?: string): UpstreamColumn | Record<string, UpstreamColumn> | undefined {
    return this.get_instance(name, null, field)
  }

  /** Wall-clock start of the log from the first 3D-fix GPS time, or `undefined`. */
  extractStartTime(): Date | undefined {
    return this.log?.startTime()
  }

  /** Composition of the log in bytes, as upstream `stats()` reports it. */
  stats(): Record<string, UpstreamMessageStats> {
    const out: Record<string, UpstreamMessageStats> = {}
    if (this.log === undefined) return out
    for (const [name, s] of this.log.stats()) out[name] = { count: s.count, msg_size: s.recordSize, size: s.bytes }
    return out
  }
}
