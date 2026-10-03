/**
 * ArduPilot packed parameter files over MAVFTP (upstream `modules/MAVLink/mavparam.js`). Wire
 * format: AP_Filesystem_Param.cpp and MAVProxy `modules/lib/param_ftp.py`.
 */

/** Packed value types: 1 int8, 2 int16, 3 int32, 4 float32. */
export type ParamType = 1 | 2 | 3 | 4

export interface Param {
  readonly name: string
  readonly value: number
  readonly type: ParamType
  /** Present when the file carries defaults (`withdefaults=1`, magic 0x671c). */
  readonly defaultValue?: number
}

/** A parameter value to upload. */
export interface ParamValue {
  readonly name: string
  readonly value: number
  readonly type: ParamType
}

/** Download path with defaults, and the upload path. */
export const PARAM_DOWNLOAD = '@PARAM/param.pck?withdefaults=1'
export const PARAM_UPLOAD = '@PARAM/param.pck'

const SIZES: Readonly<Record<ParamType, number>> = { 1: 1, 2: 2, 3: 4, 4: 4 }
const INT_LIMITS: Readonly<Record<1 | 2 | 3, readonly [number, number]>> = {
  1: [-128, 127],
  2: [-32768, 32767],
  3: [-2147483648, 2147483647]
}

export const isParamType = (type: number): type is ParamType => type === 1 || type === 2 || type === 3 || type === 4
export const validParamName = (name: string): boolean => /^[A-Z0-9_]{1,16}$/.test(name)

/** The value as stored for `type` (float32 rounding), or throws if it does not fit. */
export function valueForType(value: number, type: number): number {
  if (!Number.isFinite(value)) throw new Error('Value must be a finite number')
  if (type === 4) {
    const result = Math.fround(value)
    if (!Number.isFinite(result)) throw new Error('Value exceeds float32 range')
    return result
  }
  const limits = type === 1 || type === 2 || type === 3 ? INT_LIMITS[type] : undefined
  if (limits === undefined || !Number.isInteger(value) || value < limits[0] || value > limits[1]) {
    throw new Error(`Value does not fit parameter type ${type}`)
  }
  return value
}

function readValue(view: DataView, offset: number, type: ParamType): number {
  switch (type) {
    case 1:
      return view.getInt8(offset)
    case 2:
      return view.getInt16(offset, true)
    case 3:
      return view.getInt32(offset, true)
    case 4:
      return view.getFloat32(offset, true)
  }
}

function writeValue(view: DataView, offset: number, type: ParamType, value: number): void {
  switch (type) {
    case 1:
      return view.setInt8(offset, value)
    case 2:
      return view.setInt16(offset, value, true)
    case 3:
      return view.setInt32(offset, value, true)
    case 4:
      return view.setFloat32(offset, value, true)
  }
}

/** Decodes a packed parameter file; throws on any malformed record. */
export function decodeParams(data: Uint8Array): Map<string, Param> {
  if (data.length < 6) throw new Error('Truncated parameter header')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = view.getUint16(0, true)
  const count = view.getUint16(2, true)
  const total = view.getUint16(4, true)
  if ((magic !== 0x671b && magic !== 0x671c) || count !== total) throw new Error('Invalid or partial parameter file')
  const withDefaults = magic === 0x671c
  const params = new Map<string, Param>()
  let offset = 6
  let previous = ''
  while (offset < data.length) {
    const head = data[offset]!
    if (head === 0) {
      offset++ // Block padding.
      continue
    }
    if (offset + 2 > data.length) throw new Error('Truncated parameter record')
    const type = head & 15
    const flags = head >> 4
    const second = data[offset + 1]!
    const common = second & 15
    const suffix = (second >> 4) + 1
    const hasDefault = withDefaults && flags === 1
    if (!isParamType(type) || flags > (withDefaults ? 1 : 0) || common > previous.length || common + suffix > 16) {
      throw new Error('Invalid parameter type, flags or name prefix')
    }
    offset += 2
    if (offset + suffix + SIZES[type] * (hasDefault ? 2 : 1) > data.length) throw new Error('Truncated parameter value')
    const name = previous.slice(0, common) + String.fromCharCode(...data.subarray(offset, offset + suffix))
    if (!validParamName(name) || params.has(name)) throw new Error('Invalid or duplicate parameter name')
    offset += suffix
    const value = valueForType(readValue(view, offset, type), type)
    offset += SIZES[type]
    let defaultValue = withDefaults ? value : undefined
    if (hasDefault) {
      defaultValue = valueForType(readValue(view, offset, type), type)
      offset += SIZES[type]
    }
    params.set(name, defaultValue === undefined ? { name, value, type } : { name, value, type, defaultValue })
    previous = name
  }
  if (params.size !== count) throw new Error(`Parameter count mismatch: ${params.size} / ${count}`)
  return params
}

/** Encodes values for upload, sorted and prefix-compressed; throws on invalid names, values or size. */
export function encodeUpload(params: Iterable<ParamValue>): Uint8Array {
  const list = [...params].sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const chunks: Uint8Array[] = []
  let previous = ''
  let length = 6
  const names = new Set<string>()
  for (const p of list) {
    if (!validParamName(p.name) || names.has(p.name)) throw new Error('Invalid or duplicate parameter name')
    names.add(p.name)
    const value = valueForType(p.value, p.type)
    let common = 0
    while (common < Math.min(previous.length, p.name.length, 15) && previous[common] === p.name[common]) common++
    const suffix = p.name.slice(common)
    const bytes = new Uint8Array(2 + suffix.length + SIZES[p.type])
    bytes[0] = p.type
    bytes[1] = ((suffix.length - 1) << 4) | common
    bytes.set(new TextEncoder().encode(suffix), 2)
    writeValue(new DataView(bytes.buffer), 2 + suffix.length, p.type, value)
    chunks.push(bytes)
    length += bytes.length
    previous = p.name
  }
  if (length > 65535 || list.length > 65535) throw new Error('Packed upload exceeds the 65535-byte format limit; split the file')
  const result = new Uint8Array(length)
  const view = new DataView(result.buffer)
  view.setUint16(0, 0x671b, true)
  view.setUint16(2, list.length, true)
  view.setUint16(4, length, true)
  let offset = 6
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** Display text: integers as-is, floats as the shortest decimal that round-trips to the same float32. */
export function formatParamValue(p: { readonly type: ParamType; readonly value: number }, value: number = p.value): string {
  if (p.type !== 4) return String(value)
  for (let digits = 1; digits <= 9; digits++) {
    const text = Number(value.toPrecision(digits)).toString()
    if (Math.fround(Number(text)) === value) return text
  }
  return String(value)
}

/**
 * Parameter file text (MAVProxy `NAME VALUE` or QGC's five-column format). Strict: any malformed
 * or duplicate line throws with its line number.
 */
export function parseParamText(text: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const [index, raw] of text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    const line = (raw.split(/[#;]/, 1)[0] ?? '').trim()
    if (!line) continue
    const fields = line.split(/[\s,=]+/)
    let name: string
    let value: string
    if (fields.length === 2) {
      name = fields[0]!
      value = fields[1]!
    } else if (fields.length === 5 && /^\d+$/.test(fields[0]!) && /^\d+$/.test(fields[1]!)) {
      name = fields[2]!
      value = fields[3]!
    } else {
      throw new Error(`Line ${index + 1}: expected PARAM_NAME VALUE`)
    }
    name = name.toUpperCase()
    if (!validParamName(name) || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) {
      throw new Error(`Line ${index + 1}: invalid name or value`)
    }
    if (values.has(name)) throw new Error(`Line ${index + 1}: duplicate ${name}`)
    values.set(name, Number(value))
  }
  if (!values.size) throw new Error('No parameters in file')
  return values
}

/** MAVProxy-style `NAME<TAB>VALUE` file text, sorted by name. */
export function saveParamText(params: Iterable<Param>): string {
  return (
    '# ArduPilot parameters\n' +
    [...params]
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
      .map((p) => `${p.name}\t${formatParamValue(p)}`)
      .join('\n') +
    '\n'
  )
}

/** Vehicle family for parameter definitions, from HEARTBEAT.type (upstream `MAVParam.vehicleName`). */
export type ParamVehicle = 'Rover' | 'Plane' | 'Sub' | 'AntennaTracker' | 'Blimp' | 'Heli' | 'Copter'

export function paramVehicle(type: number): ParamVehicle {
  if (type === 10 || type === 11) return 'Rover'
  if (type === 1 || (type >= 19 && type <= 25)) return 'Plane'
  if (type === 12) return 'Sub'
  if (type === 5) return 'AntennaTracker'
  if (type === 7) return 'Blimp'
  if (type === 4) return 'Heli'
  return 'Copter'
}
