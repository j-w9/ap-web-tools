/**
 * Test-only builder for synthetic tlogs: each frame is preceded by its 8-byte big-endian
 * microsecond timestamp and carries a valid checksum unless told otherwise.
 */
import { MAVLINK_MAGIC, SIGNATURE_LENGTH, frameChecksum, type MavlinkHeader, type MavlinkVersion } from '../mavlink/frame.js'
import { MAVLINK_MESSAGES, type MavlinkMessageName } from '../mavlink/messages.js'

export interface FrameSpec {
  timeUs: bigint
  version?: MavlinkVersion
  name: MavlinkMessageName
  payloadLength?: number
  sequence?: number
  systemId?: number
  componentId?: number
  signed?: boolean
  /** Write a wrong checksum. */
  corrupt?: boolean
}

export function messageId(name: MavlinkMessageName): number {
  const def = MAVLINK_MESSAGES.find((m) => m.name === name)
  if (def === undefined) throw new Error(name)
  return def.id
}

/** Encode one frame (without the timestamp). */
export function encodeFrame(spec: FrameSpec): Uint8Array {
  const version = spec.version ?? 2
  const def = MAVLINK_MESSAGES.find((m) => m.name === spec.name)
  if (def === undefined) throw new Error(spec.name)
  const payloadLength = spec.payloadLength ?? 9
  const signed = version === 2 && (spec.signed ?? false)
  const header: MavlinkHeader = {
    version,
    payloadLength,
    sequence: spec.sequence ?? 0,
    systemId: spec.systemId ?? 1,
    componentId: spec.componentId ?? 1,
    messageId: def.id,
    signed
  }
  const headerLength = version === 1 ? 6 : 10
  const out = new Uint8Array(headerLength + payloadLength + 2 + (signed ? SIGNATURE_LENGTH : 0))
  out[0] = MAVLINK_MAGIC[version]
  out[1] = payloadLength
  if (version === 1) {
    out[2] = header.sequence
    out[3] = header.systemId
    out[4] = header.componentId
    out[5] = def.id
  } else {
    out[2] = signed ? 1 : 0
    out[3] = 0
    out[4] = header.sequence
    out[5] = header.systemId
    out[6] = header.componentId
    out[7] = def.id & 0xff
    out[8] = (def.id >> 8) & 0xff
    out[9] = (def.id >> 16) & 0xff
  }
  for (let i = 0; i < payloadLength; i++) out[headerLength + i] = (i * 37 + 11) & 0xff
  let crc = frameChecksum(out, 0, header, def.crcExtra)
  if (spec.corrupt) crc ^= 0x5a5a
  out[headerLength + payloadLength] = crc & 0xff
  out[headerLength + payloadLength + 1] = crc >> 8
  return out
}

/** Concatenate timestamped frames, with optional raw junk between them. */
export function buildTlog(parts: readonly (FrameSpec | Uint8Array)[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = []
  for (const part of parts) {
    if (part instanceof Uint8Array) {
      chunks.push(part)
      continue
    }
    const stamp = new Uint8Array(8)
    new DataView(stamp.buffer).setBigUint64(0, part.timeUs)
    chunks.push(stamp, encodeFrame(part))
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
