/**
 * Public entry point: {@link DataflashLog}.
 *
 * A log is opened with a single scan that indexes every record and reads the
 * FMT/FMTU/UNIT/MULT tables. Message payloads are decoded lazily, one message
 * type (and optionally one instance) at a time, into columnar typed arrays
 * that are cached for subsequent calls.
 */
import { decodeAllColumns, decodeColumn, type Column, type NumericColumn } from './decode.js'
import { HEADER_SIZE, STRING_TYPES, readUint64, type FormatDefinition, type TypeCode } from './format.js'
import { splitInstances } from './instances.js'
import {
  detectVehicleType,
  mavTypeForVehicle,
  modeName,
  vehicleTypeForMavType,
  type MavType,
  type ModeChange,
  type VehicleType
} from './modes.js'
import { scanLog, type ScanResult } from './scan.js'
import { builtinTables, resolveFieldUnits, type FieldUnits, type UnitTables } from './units.js'

/** Options for {@link DataflashLog.parse}. */
export interface ParseOptions {
  /** Called with a 0..1 fraction while the log is being indexed. */
  readonly onProgress?: (fraction: number) => void
}

/** Description of one field of a message type. */
export interface FieldInfo extends FieldUnits {
  /** Field name, e.g. `"Roll"`. */
  readonly name: string
  /** Position of the field within the message. */
  readonly index: number
  /** Binary encoding of the field. */
  readonly type: TypeCode
  /** Whether the field decodes to text (`string[]`). */
  readonly isString: boolean
}

/** Everything known about one message type present in the log. */
export interface MessageTypeInfo {
  /** Message name, e.g. `"IMU"`. */
  readonly name: string
  /** Message id used in record headers. */
  readonly id: number
  /** Layout from the FMT record. */
  readonly format: FormatDefinition
  /** Per-field metadata, in message order. */
  readonly fields: readonly FieldInfo[]
  /** Field names, in message order (upstream `expressions`). */
  readonly fieldNames: readonly string[]
  /** Total number of records of this type (all instances). */
  readonly count: number
  /** Name of the instance-number field, or `undefined` for single-instance messages. */
  readonly instanceField: string | undefined
  /**
   * Record count per instance number, in ascending instance order, or
   * `undefined` for single-instance messages.
   */
  readonly instances: ReadonlyMap<number, number> | undefined
}

/** All fields of one message type (or one instance of it), decoded column-wise. */
export interface ParsedMessage {
  /** Message name. */
  readonly name: string
  /** Instance number, or `undefined` when all records were decoded together. */
  readonly instance: number | undefined
  /** Number of records; every column has this length. */
  readonly length: number
  /** Decoded columns keyed by field name. */
  readonly columns: Readonly<Record<string, Column>>
}

/** Size statistics for one message type. */
export interface MessageStats {
  /** Records in the log. */
  readonly count: number
  /** Bytes per record including the 3-byte header. */
  readonly recordSize: number
  /** Total bytes consumed by this message type. */
  readonly bytes: number
}

/** Message types whose text fields are decoded during open. */
const PARM = 'PARM'
const MSG = 'MSG'
const MODE = 'MODE'
const GPS = 'GPS'
const FILE = 'FILE'
const VER = 'VER'

const GPS_OK_FIX_3D = 3
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000
const UNIX_GPS_OFFSET_MS = 315964800 * 1000

/**
 * A parsed ArduPilot DataFlash (`.bin`) log.
 *
 * Create one with {@link DataflashLog.parse}. The source buffer is retained
 * (not copied) for the lifetime of the object; decoded columns are cached.
 */
export class DataflashLog {
  private readonly bytes: Uint8Array
  private readonly view: DataView
  private readonly scan: ScanResult
  private readonly infos = new Map<string, MessageTypeInfo>()
  /** Per message id: offsets grouped by instance number (only for instanced types). */
  private readonly instanceOffsets = new Map<number, Map<number, Uint32Array>>()
  private readonly messageCache = new Map<string, ParsedMessage>()
  private readonly columnCache = new Map<string, Column>()
  private paramCache: Map<string, number> | undefined
  private vehicleCache: VehicleType | null | undefined

  private constructor(bytes: Uint8Array, options: ParseOptions) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.scan = scanLog(bytes, this.view, options.onProgress)
    this.buildMessageTypes()
  }

  /**
   * Parse a DataFlash log held in memory.
   *
   * @param data The log bytes. A `Uint8Array` view is used as-is without copying.
   * @param options Progress callback.
   */
  static parse(data: ArrayBuffer | Uint8Array, options: ParseOptions = {}): DataflashLog {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    return new DataflashLog(bytes, options)
  }

  /** Size of the log in bytes. */
  get byteLength(): number {
    return this.bytes.byteLength
  }

  // ---------------------------------------------------------------- metadata

  /** Every message type that has at least one record, keyed by name. */
  messageTypes(): ReadonlyMap<string, MessageTypeInfo> {
    return this.infos
  }

  /** Info for one message type, or `undefined` if the log has no such records. */
  messageType(name: string): MessageTypeInfo | undefined {
    return this.infos.get(name)
  }

  /** Whether the log contains records of `name` (and, if given, that it has `field`). */
  has(name: string, field?: string): boolean {
    const info = this.infos.get(name)
    if (info === undefined) return false
    return field === undefined || info.format.columns.includes(field)
  }

  /** Field names of a message type, or an empty list if absent. */
  fieldNames(name: string): readonly string[] {
    return this.infos.get(name)?.fieldNames ?? []
  }

  /** Instance numbers of a message type in ascending order (empty if not instanced or absent). */
  instances(name: string): readonly number[] {
    const inst = this.infos.get(name)?.instances
    return inst === undefined ? [] : [...inst.keys()]
  }

  /** Number of records of a message type, optionally of one instance. */
  count(name: string, instance?: number): number {
    const info = this.infos.get(name)
    if (info === undefined) return 0
    if (instance === undefined) return info.count
    return info.instances?.get(instance) ?? 0
  }

  /** All format definitions found in the log, including types with no records. */
  formats(): readonly FormatDefinition[] {
    return this.scan.formats.filter((f): f is FormatDefinition => f !== undefined)
  }

  /** Record counts and byte usage per message type. */
  stats(): ReadonlyMap<string, MessageStats> {
    const out = new Map<string, MessageStats>()
    for (const fmt of this.scan.formats) {
      if (fmt === undefined) continue
      const count = this.scan.offsets[fmt.id]?.length ?? 0
      const recordSize = fmt.size + HEADER_SIZE
      out.set(fmt.name, { count, recordSize, bytes: count * recordSize })
    }
    return out
  }

  // ------------------------------------------------------------------- data

  /**
   * One field of a message type across every record (all instances, in log
   * order). Returns `undefined` if the message or field does not exist.
   */
  get(name: string, field: string): Column | undefined {
    return this.column(name, undefined, field)
  }

  /**
   * One field of a single instance of a message type. Returns `undefined`
   * if the message, instance or field does not exist.
   */
  getInstance(name: string, instance: number, field: string): Column | undefined {
    return this.column(name, instance, field)
  }

  /** Like {@link get} but only for numeric fields; `undefined` for text fields. */
  getNumbers(name: string, field: string, instance?: number): NumericColumn | undefined {
    const col = this.column(name, instance, field)
    return col !== undefined && ArrayBuffer.isView(col) ? col : undefined
  }

  /** Like {@link get} but only for text fields; `undefined` for numeric fields. */
  getStrings(name: string, field: string, instance?: number): string[] | undefined {
    const col = this.column(name, instance, field)
    return col !== undefined && !ArrayBuffer.isView(col) && isStringArray(col) ? col : undefined
  }

  /**
   * Decode every field of a message type. With `instance` given only that
   * instance's records are decoded. Results are cached, so repeated calls
   * are free. Returns `undefined` if the message (or instance) is absent.
   *
   * @param onProgress Called with a 0..1 fraction during decoding.
   */
  getMessage(
    name: string,
    instance?: number,
    onProgress?: (fraction: number) => void
  ): ParsedMessage | undefined {
    const info = this.infos.get(name)
    if (info === undefined) return undefined
    const key = cacheKey(name, instance)
    const cached = this.messageCache.get(key)
    if (cached !== undefined) return cached
    const offsets = this.offsetsFor(info, instance)
    if (offsets === undefined) return undefined
    const columns = decodeAllColumns(this.view, this.bytes, offsets, info.format, onProgress)
    const parsed: ParsedMessage = { name, instance, length: offsets.length, columns }
    this.messageCache.set(key, parsed)
    return parsed
  }

  // -------------------------------------------------------------- derived

  /**
   * Parameters as `name -> value`. When a parameter appears more than once
   * the last value in the log wins, matching the upstream tools.
   */
  params(): ReadonlyMap<string, number> {
    if (this.paramCache === undefined) {
      const map = new Map<string, number>()
      const names = this.getStrings(PARM, 'Name')
      const values = this.getNumbers(PARM, 'Value')
      if (names !== undefined && values !== undefined) {
        for (let i = 0; i < names.length; i++) map.set(names[i] as string, values[i] as number)
      }
      this.paramCache = map
    }
    return this.paramCache
  }

  /** Last logged value of one parameter, or `undefined` if never logged. */
  param(name: string): number | undefined {
    return this.params().get(name)
  }

  /** Text of every MSG record, in log order. */
  textMessages(): readonly string[] {
    return this.getStrings(MSG, 'Message') ?? []
  }

  /**
   * Vehicle family, from the VER record when present, else from the firmware
   * banner in MSG. `undefined` when neither identifies the vehicle.
   */
  vehicleType(): VehicleType | undefined {
    if (this.vehicleCache === undefined) {
      let detected: VehicleType | undefined
      const fwt = this.getNumbers(VER, 'FWT')
      if (fwt !== undefined && fwt.length > 0) detected = vehicleTypeForMavType(fwt[0] as number)
      detected ??= detectVehicleType(this.textMessages())
      this.vehicleCache = detected ?? null
    }
    return this.vehicleCache ?? undefined
  }

  /** MAV_TYPE for the detected vehicle; `undefined` when the vehicle is unknown. */
  mavType(): MavType | undefined {
    const vehicle = this.vehicleType()
    return vehicle === undefined ? undefined : mavTypeForVehicle(vehicle)
  }

  /**
   * Name of a mode number for this log's vehicle. Falls back to the copter
   * table when the vehicle is unknown (as upstream does), and to
   * `"UNKNOWN(<n>)"` when the number is not in the table.
   */
  modeName(mode: number): string {
    return modeName(this.vehicleType() ?? 'copter', mode) ?? `UNKNOWN(${mode})`
  }

  /** Every MODE record with its resolved mode name, in log order. */
  modes(): readonly ModeChange[] {
    const msg = this.getMessage(MODE)
    if (msg === undefined) return []
    const time = numeric(msg.columns['TimeUS'])
    const mode = numeric(msg.columns['Mode'])
    const reason = numeric(msg.columns['Rsn'])
    if (time === undefined || mode === undefined) return []
    const out: ModeChange[] = []
    for (let i = 0; i < msg.length; i++) {
      const m = mode[i] as number
      out.push({
        timeUs: time[i] as number,
        mode: m,
        reason: reason === undefined ? undefined : (reason[i] as number),
        name: this.modeName(m)
      })
    }
    return out
  }

  /**
   * Microsecond timestamp of the earliest timestamped record in the log,
   * or `undefined` if nothing carries a `TimeUS` field.
   */
  firstTimeUs(): number | undefined {
    let best: number | undefined
    for (const fmt of this.scan.formats) {
      if (fmt === undefined) continue
      const idx = fmt.columns.indexOf('TimeUS')
      if (idx === -1 || fmt.types[idx] !== 'Q') continue
      const first = this.scan.offsets[fmt.id]?.[0]
      if (first === undefined) continue
      const at = first + (fmt.fieldOffsets[idx] as number)
      if (best === undefined || at < best) best = at
    }
    return best === undefined ? undefined : readUint64(this.view, best)
  }

  /**
   * Wall-clock time at which the log started, derived from the first GPS
   * record with a 3D fix and corrected for leap seconds. `undefined` when the
   * log has no usable GPS time.
   */
  startTime(): Date | undefined {
    const info = this.infos.get(GPS)
    if (info === undefined) return undefined
    const startUs = this.firstTimeUs()
    if (startUs === undefined) return undefined

    let best: { timeUs: number; weeks: number; ms: number } | undefined
    const consider = (instance: number | undefined): void => {
      const time = numeric(this.column(GPS, instance, 'TimeUS'))
      const status = numeric(this.column(GPS, instance, 'Status'))
      const weeks = numeric(this.column(GPS, instance, 'GWk'))
      const ms = numeric(this.column(GPS, instance, 'GMS'))
      if (time === undefined || status === undefined || weeks === undefined || ms === undefined) return
      for (let i = 0; i < time.length; i++) {
        const w = weeks[i] as number
        const m = ms[i] as number
        if ((status[i] as number) >= GPS_OK_FIX_3D && w > 1000 && m > 0) {
          const t = time[i] as number
          if (best === undefined || t < best.timeUs) best = { timeUs: t, weeks: w, ms: m }
          return
        }
      }
    }
    if (info.instances !== undefined) {
      for (const inst of info.instances.keys()) consider(inst)
    } else {
      consider(undefined)
    }
    if (best === undefined) return undefined

    const gpsMs = best.weeks * MS_PER_WEEK + best.ms
    const logStartOffsetMs = (best.timeUs - startUs) * 0.001
    const unixMs = UNIX_GPS_OFFSET_MS + gpsMs - logStartOffsetMs
    const approx = new Date(unixMs)
    const leap = leapSecondsGps(approx.getUTCFullYear(), approx.getUTCMonth() + 1)
    return new Date(approx.getTime() - leap * 1000)
  }

  /**
   * Files embedded in the log via FILE records (e.g. `@SYS/uarts.txt`),
   * reassembled by concatenating chunks in log order.
   */
  files(): ReadonlyMap<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    const info = this.infos.get(FILE)
    if (info === undefined) return out
    const names = this.getStrings(FILE, 'FileName')
    const lengths = this.getNumbers(FILE, 'Length')
    const dataIdx = info.format.columns.indexOf('Data')
    const offsets = this.scan.offsets[info.id]
    if (names === undefined || dataIdx === -1 || offsets === undefined) return out
    const dataOffset = info.format.fieldOffsets[dataIdx] as number
    const dataType = info.format.types[dataIdx] as TypeCode
    const dataSize = info.format.fieldOffsets[dataIdx + 1] !== undefined
      ? (info.format.fieldOffsets[dataIdx + 1] as number) - dataOffset
      : info.format.size - dataOffset
    const chunks = new Map<string, Uint8Array[]>()
    for (let i = 0; i < offsets.length; i++) {
      const name = names[i] as string
      const start = (offsets[i] as number) + dataOffset
      let len = lengths === undefined ? dataSize : Math.min(lengths[i] as number, dataSize)
      if (lengths === undefined && STRING_TYPES.has(dataType)) {
        while (len > 0 && this.bytes[start + len - 1] === 0) len--
      }
      let list = chunks.get(name)
      if (list === undefined) {
        list = []
        chunks.set(name, list)
      }
      list.push(this.bytes.subarray(start, start + len))
    }
    for (const [name, list] of chunks) {
      const total = list.reduce((n, c) => n + c.byteLength, 0)
      const joined = new Uint8Array(total)
      let pos = 0
      for (const c of list) {
        joined.set(c, pos)
        pos += c.byteLength
      }
      out.set(name, joined)
    }
    return out
  }

  // ---------------------------------------------------------------- private

  private buildMessageTypes(): void {
    const tables = this.readUnitTables()
    const fmtu = this.readFmtu()

    for (const fmt of this.scan.formats) {
      if (fmt === undefined) continue
      const offsets = this.scan.offsets[fmt.id]
      if (offsets === undefined || offsets.length === 0) continue
      const ids = fmtu.get(fmt.id)
      const units = resolveFieldUnits(fmt.types.length, ids?.unitIds, ids?.multIds, tables)
      const fields: FieldInfo[] = fmt.types.map((type, index) => ({
        ...(units[index] as FieldUnits),
        name: fmt.columns[index] as string,
        index,
        type,
        isString: STRING_TYPES.has(type)
      }))

      let instanceField: string | undefined
      let instances: Map<number, number> | undefined
      const instField = fields.find((f) => f.isInstance && !f.isString && f.type !== 'a')
      if (instField !== undefined) {
        const split = splitInstances(
          this.view,
          offsets,
          fmt.fieldOffsets[instField.index] as number,
          instField.type
        )
        this.instanceOffsets.set(fmt.id, split)
        instanceField = instField.name
        instances = new Map([...split].map(([k, v]) => [k, v.length]))
      }

      this.infos.set(fmt.name, {
        name: fmt.name,
        id: fmt.id,
        format: fmt,
        fields,
        fieldNames: fmt.columns,
        count: offsets.length,
        instanceField,
        instances
      })
    }
  }

  /** UNIT/MULT tables from the log layered over the built-in defaults. */
  private readUnitTables(): UnitTables {
    const tables = builtinTables()
    const units = new Map(tables.units)
    const multipliers = new Map(tables.multipliers)
    const unitFmt = this.findFormat('UNIT')
    if (unitFmt !== undefined) {
      const ids = numeric(this.rawColumn(unitFmt, 'Id'))
      const labels = this.rawColumn(unitFmt, 'Label')
      if (ids !== undefined && labels !== undefined && isStringArray(labels)) {
        for (let i = 0; i < ids.length; i++) units.set(String.fromCharCode(ids[i] as number), labels[i] as string)
      }
    }
    const multFmt = this.findFormat('MULT')
    if (multFmt !== undefined) {
      const ids = numeric(this.rawColumn(multFmt, 'Id'))
      const mults = numeric(this.rawColumn(multFmt, 'Mult'))
      if (ids !== undefined && mults !== undefined) {
        for (let i = 0; i < ids.length; i++) multipliers.set(String.fromCharCode(ids[i] as number), mults[i] as number)
      }
    }
    return { units, multipliers }
  }

  /** FMTU records: message id -> unit/multiplier id strings (last record wins). */
  private readFmtu(): Map<number, { unitIds: string; multIds: string }> {
    const out = new Map<number, { unitIds: string; multIds: string }>()
    const fmt = this.findFormat('FMTU')
    if (fmt === undefined) return out
    const types = numeric(this.rawColumn(fmt, 'FmtType'))
    const unitIds = this.rawColumn(fmt, 'UnitIds')
    const multIds = this.rawColumn(fmt, 'MultIds')
    if (types === undefined || unitIds === undefined || multIds === undefined) return out
    if (!isStringArray(unitIds) || !isStringArray(multIds)) return out
    for (let i = 0; i < types.length; i++) {
      out.set(types[i] as number, { unitIds: unitIds[i] as string, multIds: multIds[i] as string })
    }
    return out
  }

  private findFormat(name: string): FormatDefinition | undefined {
    return this.scan.formats.find((f) => f !== undefined && f.name === name)
  }

  /** Decode a column straight from the scan index (used before message infos exist). */
  private rawColumn(fmt: FormatDefinition, field: string): Column | undefined {
    const idx = fmt.columns.indexOf(field)
    const offsets = this.scan.offsets[fmt.id]
    if (idx === -1 || offsets === undefined) return undefined
    return decodeColumn(this.view, this.bytes, offsets, fmt.fieldOffsets[idx] as number, fmt.types[idx] as TypeCode)
  }

  private offsetsFor(info: MessageTypeInfo, instance: number | undefined): Uint32Array | undefined {
    if (instance === undefined) return this.scan.offsets[info.id]
    return this.instanceOffsets.get(info.id)?.get(instance)
  }

  private column(name: string, instance: number | undefined, field: string): Column | undefined {
    const info = this.infos.get(name)
    if (info === undefined) return undefined
    const idx = info.format.columns.indexOf(field)
    if (idx === -1) return undefined

    const whole = this.messageCache.get(cacheKey(name, instance))
    if (whole !== undefined) return whole.columns[field]

    const key = cacheKey(name, instance) + '\u0000' + field
    const cached = this.columnCache.get(key)
    if (cached !== undefined) return cached

    const offsets = this.offsetsFor(info, instance)
    if (offsets === undefined) return undefined
    const col = decodeColumn(
      this.view,
      this.bytes,
      offsets,
      info.format.fieldOffsets[idx] as number,
      info.format.types[idx] as TypeCode
    )
    this.columnCache.set(key, col)
    return col
  }
}

function cacheKey(name: string, instance: number | undefined): string {
  return instance === undefined ? name : `${name}[${instance}]`
}

function isStringArray(col: Column): col is string[] {
  return Array.isArray(col) && (col.length === 0 || typeof col[0] === 'string')
}

function numeric(col: Column | undefined): NumericColumn | undefined {
  return col !== undefined && ArrayBuffer.isView(col) ? col : undefined
}

/** GPS-UTC leap second count in effect at the given month. */
export function leapSecondsGps(year: number, month: number): number {
  return leapSecondsTai(year, month) - 19
}

/** TAI-UTC offset in effect at the given month. */
export function leapSecondsTai(year: number, month: number): number {
  const yyyymm = year * 100 + month
  if (yyyymm >= 201701) return 37
  if (yyyymm >= 201507) return 36
  if (yyyymm >= 201207) return 35
  if (yyyymm >= 200901) return 34
  if (yyyymm >= 200601) return 33
  if (yyyymm >= 199901) return 32
  if (yyyymm >= 199707) return 31
  if (yyyymm >= 199601) return 30
  return 0
}
