/**
 * MAVLink 1 and 2 framing: header decoding, frame length and the X.25 checksum.
 *
 * Candidate for a shared `@apwt/mavlink` package. It has no dependency on the rest of
 * Stream Stats and does not decode payloads, only what is needed to find and validate frames.
 *
 * Port of the framing part of upstream `load_tlog` in `StreamStats/StreamStats.js`.
 */

/** MAVLink protocol version of one frame. */
export type MavlinkVersion = 1 | 2

/** Start-of-frame marker for each version. */
export const MAVLINK_MAGIC = { 1: 0xfe, 2: 0xfd } as const satisfies Record<MavlinkVersion, number>

/**
 * Bytes of framing around the payload: the header plus the two checksum bytes
 * (upstream `header_length`).
 */
export const FRAMING_LENGTH = { 1: 8, 2: 12 } as const satisfies Record<MavlinkVersion, number>

/** Length of the MAVLink 2 signature block appended when the frame is signed. */
export const SIGNATURE_LENGTH = 13

/** MAVLink 2 incompat flag: the frame carries a signature. */
const INCOMPAT_SIGNED = 0x01

/** Decoded MAVLink frame header. */
export interface MavlinkHeader {
  readonly version: MavlinkVersion
  readonly payloadLength: number
  readonly sequence: number
  readonly systemId: number
  readonly componentId: number
  readonly messageId: number
  /** Only MAVLink 2 frames can be signed. */
  readonly signed: boolean
}

/** What sits at a byte offset that might start a frame. */
export type HeaderRead =
  /** A complete header. The rest of the frame may still be missing or invalid. */
  | { readonly kind: 'header'; readonly header: MavlinkHeader }
  /** The byte is not a start-of-frame marker. */
  | { readonly kind: 'no-magic' }
  /** A start-of-frame marker whose header runs past the end of the data. */
  | { readonly kind: 'truncated' }

/**
 * Decode the header at `offset`. Upstream requires the header plus checksum to fit before
 * declaring it truncated, so that is what is checked here too.
 */
export function readHeader(view: DataView, offset: number): HeaderRead {
  const magic = view.getUint8(offset)
  if (magic === MAVLINK_MAGIC[1]) {
    if (offset + FRAMING_LENGTH[1] > view.byteLength) return { kind: 'truncated' }
    return {
      kind: 'header',
      header: {
        version: 1,
        payloadLength: view.getUint8(offset + 1),
        sequence: view.getUint8(offset + 2),
        systemId: view.getUint8(offset + 3),
        componentId: view.getUint8(offset + 4),
        messageId: view.getUint8(offset + 5),
        signed: false
      }
    }
  }
  if (magic === MAVLINK_MAGIC[2]) {
    if (offset + FRAMING_LENGTH[2] > view.byteLength) return { kind: 'truncated' }
    const incompatFlags = view.getUint8(offset + 2)
    return {
      kind: 'header',
      header: {
        version: 2,
        payloadLength: view.getUint8(offset + 1),
        sequence: view.getUint8(offset + 4),
        systemId: view.getUint8(offset + 5),
        componentId: view.getUint8(offset + 6),
        messageId: (view.getUint8(offset + 9) << 16) + (view.getUint8(offset + 8) << 8) + view.getUint8(offset + 7),
        signed: (incompatFlags & INCOMPAT_SIGNED) !== 0
      }
    }
  }
  return { kind: 'no-magic' }
}

/** Total frame length in bytes: header, payload, checksum and signature if present. */
export function frameLength(header: MavlinkHeader): number {
  return FRAMING_LENGTH[header.version] + header.payloadLength + (header.signed ? SIGNATURE_LENGTH : 0)
}

/** One step of CRC-16/MCRF4XX (the X.25 checksum MAVLink uses). */
export function x25Crc(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff)
  tmp = (tmp ^ (tmp << 4)) & 0xff
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

/** Initial value of the X.25 checksum. */
export const X25_INIT = 0xffff

/** Checksum of `bytes[start, end)`, continuing from `crc`. */
export function x25CrcBytes(bytes: Uint8Array, start: number, end: number, crc: number = X25_INIT): number {
  let out = crc
  for (let i = start; i < end; i++) out = x25Crc(bytes[i]!, out)
  return out
}

/**
 * Compute the checksum a frame at `offset` should carry: every byte after the magic up to the
 * checksum, then the message's CRC_EXTRA seed.
 */
export function frameChecksum(bytes: Uint8Array, offset: number, header: MavlinkHeader, crcExtra: number): number {
  const crcOffset = checksumOffset(header)
  return x25Crc(crcExtra, x25CrcBytes(bytes, offset + 1, offset + crcOffset))
}

/** Offset of the two checksum bytes from the start of the frame. */
export function checksumOffset(header: MavlinkHeader): number {
  return FRAMING_LENGTH[header.version] + header.payloadLength - 2
}

/** Whether the frame at `offset` carries a valid checksum. The whole frame must be in `bytes`. */
export function checkFrame(bytes: Uint8Array, view: DataView, offset: number, header: MavlinkHeader, crcExtra: number): boolean {
  const expected = view.getUint16(offset + checksumOffset(header), true)
  return frameChecksum(bytes, offset, header, crcExtra) === expected
}
