/**
 * The `mavlink20` global that upstream's `mavlink.js` defined, rebuilt from `@apwt/mavlink`.
 *
 * Code written for the original dashboard reads it in two places: sandboxed widgets (the MAVLink
 * Inspector walks `MAV_COMP_ID_*` constants and `mavlink20.map[id].type`), and the Formio form
 * definitions saved inside layouts (the "MAVLink field" select's custom data script calls
 * `new msg_map.type` for `_id` and `fieldnames`). Both keep working against this object.
 *
 * Provided: every enum entry and `<ENUM>_ENUM_END`, `MAVLINK_MSG_ID_<NAME>`, the protocol
 * constants, `map` (id to `{ format, type, order_map, crc_extra }`), `messages` (one class per
 * message, constructed with field values in XML order), `header`, `x25Crc`, `sha256` and
 * `create_signature`. Not provided: packing and parsing (`message.pack`, `MAVLink20Processor`),
 * which the read-only dashboard never used.
 */
import * as mavlink from '@apwt/mavlink'
import { ALL_MESSAGES, crcAccumulate, createSignature, sha256 } from '@apwt/mavlink'
import type { EnumObject, MessageDescriptor, MessageName } from '@apwt/mavlink'
import { legacyMessageInfo, type LegacyHeader, type LegacyMessageInfo } from './legacy-message.js'

/** An instance of a legacy message class: fields (undefined until set) plus constructor metadata. */
export type LegacyMessageObject = LegacyMessageInfo & { [field: string]: unknown }

export type LegacyMessageClass = new (...fields: unknown[]) => LegacyMessageObject

export interface LegacyMapEntry {
  readonly format: string
  readonly type: LegacyMessageClass
  readonly order_map: readonly number[]
  readonly crc_extra: number
}

export type LegacyHeaderClass = new (
  msgId: number,
  mlen?: number,
  seq?: number,
  srcSystem?: number,
  srcComponent?: number,
  incompat_flags?: number,
  compat_flags?: number
) => LegacyHeader

export interface LegacyMavlink20 {
  readonly map: Readonly<Record<number, LegacyMapEntry>>
  readonly messages: Readonly<Record<string, LegacyMessageClass>>
  readonly header: LegacyHeaderClass
  readonly x25Crc: (buffer: ArrayLike<number>, crcIn?: number) => number
  readonly sha256: (data: Uint8Array) => Uint8Array
  readonly create_signature: (key: Uint8Array, data: ArrayLike<number>) => Uint8Array
  /** Constants: enum entries, `*_ENUM_END`, `MAVLINK_MSG_ID_*` and protocol constants. */
  readonly [constant: string]: unknown
}

const PROTOCOL_CONSTANTS = {
  WIRE_PROTOCOL_VERSION: '2.0',
  PROTOCOL_MARKER_V1: 0xfe,
  PROTOCOL_MARKER_V2: 0xfd,
  HEADER_LEN_V1: 6,
  HEADER_LEN_V2: 10,
  HEADER_LEN: 10,
  MAVLINK_TYPE_CHAR: 0,
  MAVLINK_TYPE_UINT8_T: 1,
  MAVLINK_TYPE_INT8_T: 2,
  MAVLINK_TYPE_UINT16_T: 3,
  MAVLINK_TYPE_INT16_T: 4,
  MAVLINK_TYPE_UINT32_T: 5,
  MAVLINK_TYPE_INT32_T: 6,
  MAVLINK_TYPE_UINT64_T: 7,
  MAVLINK_TYPE_INT64_T: 8,
  MAVLINK_TYPE_FLOAT: 9,
  MAVLINK_TYPE_DOUBLE: 10,
  MAVLINK_IFLAG_SIGNED: 0x01,
  MAVLINK_SIGNATURE_BLOCK_LEN: 13,
  MAVLINK_MSG_ID_BAD_DATA: -1
} as const

/** A generated enum object: upper-case entry names to numbers (excludes e.g. `FIELD_TYPE_SIZE`). */
function isEnumObject(value: unknown): value is EnumObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length > 0 && entries.every(([key, v]) => /^[A-Z]/.test(key) && typeof v === 'number')
}

/** `MavType` -> `MAV_TYPE`: the generator's PascalCase export name back to the XML enum name. */
export function xmlEnumName(exportName: string): string {
  return exportName.replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_').toUpperCase()
}

/** Every generated enum, keyed by its XML name, entries in XML order. */
export function legacyEnums(): ReadonlyMap<string, EnumObject> {
  const enums = new Map<string, EnumObject>()
  for (const [name, value] of Object.entries(mavlink)) if (isEnumObject(value)) enums.set(xmlEnumName(name), value)
  return enums
}

/**
 * Fields pymavlink fixes rather than taking as constructor arguments: HEARTBEAT's
 * `mavlink_version` is typed `uint8_t_mavlink_version` in the XML and always 3.
 */
const FIXED_FIELDS: Partial<Record<MessageName, Readonly<Record<string, number>>>> = { HEARTBEAT: { mavlink_version: 3 } }

function messageClass(descriptor: MessageDescriptor<MessageName>): LegacyMessageClass {
  const info = legacyMessageInfo(descriptor)
  const fixed = FIXED_FIELDS[descriptor.name] ?? {}
  const argumentNames = info.fieldnames.filter((name) => !(name in fixed))
  return class LegacyMessage {
    [field: string]: unknown
    // Declared for the type; assigned from `info` in the constructor.
    declare _format: string
    declare _id: number
    declare order_map: number[]
    declare len_map: number[]
    declare array_len_map: number[]
    declare crc_extra: number
    declare _name: string
    declare _instance_field: string | undefined
    declare _instance_offset: number
    declare fieldnames: string[]

    constructor(...fields: unknown[]) {
      // pymavlink: `[ this.a, this.b, ... ] = moreargs`, then the metadata.
      argumentNames.forEach((name, i) => {
        this[name] = fields[i]
      })
      Object.assign(this, fixed)
      Object.assign(this, structuredClone(info))
    }
  }
}

function x25Crc(buffer: ArrayLike<number>, crcIn = 0xffff): number {
  let crc = crcIn
  for (let i = 0; i < buffer.length; i++) crc = crcAccumulate(buffer[i]!, crc)
  return crc
}

class LegacyHeaderImpl implements LegacyHeader {
  mlen: number
  seq: number
  srcSystem: number
  srcComponent: number
  msgId: number
  incompat_flags: number
  compat_flags: number
  constructor(msgId: number, mlen = 0, seq = 0, srcSystem = 0, srcComponent = 0, incompatFlags = 0, compatFlags = 0) {
    this.mlen = mlen
    this.seq = seq
    this.srcSystem = srcSystem
    this.srcComponent = srcComponent
    this.msgId = msgId
    this.incompat_flags = incompatFlags
    this.compat_flags = compatFlags
  }
}

/** Builds the namespace. Upstream's was a function object; a plain object behaves the same for property access. */
export function createLegacyMavlink20(): LegacyMavlink20 {
  const constants: Record<string, unknown> = { ...PROTOCOL_CONSTANTS }
  for (const [enumName, entries] of legacyEnums()) {
    // pymavlink: one more than the highest entry value (not the last entry's).
    let highest = 0
    for (const [entry, value] of Object.entries(entries)) {
      constants[entry] = value
      highest = Math.max(highest, value)
    }
    constants[`${enumName}_ENUM_END`] = highest + 1
  }
  const map: Record<number, LegacyMapEntry> = {}
  const messages: Record<string, LegacyMessageClass> = {}
  for (const descriptor of ALL_MESSAGES) {
    const info = legacyMessageInfo(descriptor)
    const type = messageClass(descriptor)
    constants[`MAVLINK_MSG_ID_${descriptor.name}`] = descriptor.id
    messages[descriptor.name.toLowerCase()] = type
    map[descriptor.id] = { format: info._format, type, order_map: info.order_map, crc_extra: info.crc_extra }
  }
  return {
    ...constants,
    map,
    messages,
    header: LegacyHeaderImpl,
    x25Crc,
    sha256,
    create_signature: (key, data) => createSignature(key, Uint8Array.from(data))
  }
}

declare global {
  interface Window {
    /** Upstream's `mavlink.js` global, for user widget code and saved Formio scripts. */
    mavlink20?: LegacyMavlink20
  }
}

/** Defines `window.mavlink20` (once) and returns it. */
export function installLegacyMavlink20(target: Window = window): LegacyMavlink20 {
  target.mavlink20 ??= createLegacyMavlink20()
  return target.mavlink20
}
