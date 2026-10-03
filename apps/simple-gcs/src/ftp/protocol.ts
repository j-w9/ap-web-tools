/**
 * MAVLink FTP wire format (upstream `modules/MAVLink/mavftp.js`, `MAVFTP.packOp`/`parseOp`):
 * a 12-byte header followed by up to 239 data bytes, carried in FILE_TRANSFER_PROTOCOL.payload.
 */

/** FTP opcodes (upstream `MAVFTP.OP`). */
export const FtpOp = {
  None: 0,
  TerminateSession: 1,
  ResetSessions: 2,
  ListDirectory: 3,
  OpenFileRO: 4,
  ReadFile: 5,
  CreateFile: 6,
  WriteFile: 7,
  RemoveFile: 8,
  CreateDirectory: 9,
  RemoveDirectory: 10,
  OpenFileWO: 11,
  TruncateFile: 12,
  Rename: 13,
  CalcFileCRC32: 14,
  BurstReadFile: 15,
  Ack: 128,
  Nack: 129
} as const
export type FtpOpcode = (typeof FtpOp)[keyof typeof FtpOp]

/** NACK error codes (upstream `MAVFTP.ERR`). */
export const FtpError = {
  None: 0,
  Fail: 1,
  FailErrno: 2,
  InvalidDataSize: 3,
  InvalidSession: 4,
  NoSessionsAvailable: 5,
  EndOfFile: 6,
  UnknownCommand: 7,
  FileExists: 8,
  FileProtected: 9,
  FileNotFound: 10
} as const

export const FTP_HEADER_LENGTH = 12
export const FTP_MAX_PAYLOAD = 239

/** One decoded FTP packet. Opcodes from the wire are not restricted to known values. */
export interface FtpPacket {
  readonly seq: number
  readonly session: number
  readonly opcode: number
  readonly size: number
  readonly reqOpcode: number
  readonly burstComplete: number
  readonly offset: number
  readonly payload: Uint8Array
}

/** Packs a request; throws `RangeError` for an invalid payload size, as upstream does. */
export function packOp(
  seq: number,
  session: number,
  opcode: number,
  size: number,
  reqOpcode: number,
  burstComplete: number,
  offset: number,
  payload: ArrayLike<number> | null
): Uint8Array {
  if (!Number.isInteger(size) || size < 0 || size > FTP_MAX_PAYLOAD || (payload !== null && payload.length > FTP_MAX_PAYLOAD)) {
    throw new RangeError('Invalid FTP payload size')
  }
  const bytes = new Uint8Array(FTP_HEADER_LENGTH + FTP_MAX_PAYLOAD)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, seq, true)
  view.setUint8(2, session)
  view.setUint8(3, opcode)
  view.setUint8(4, size)
  view.setUint8(5, reqOpcode)
  view.setUint8(6, burstComplete)
  view.setUint32(8, offset, true)
  if (payload !== null) bytes.set(payload, FTP_HEADER_LENGTH)
  return bytes
}

/** Decodes a packet, or `null` when it is shorter than its header or its declared size. */
export function parseOp(payload: Uint8Array): FtpPacket | null {
  if (payload.length < FTP_HEADER_LENGTH) return null
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const size = view.getUint8(4)
  if (size > FTP_MAX_PAYLOAD || FTP_HEADER_LENGTH + size > payload.length) return null
  return {
    seq: view.getUint16(0, true),
    session: view.getUint8(2),
    opcode: view.getUint8(3),
    size,
    reqOpcode: view.getUint8(5),
    burstComplete: view.getUint8(6),
    offset: view.getUint32(8, true),
    payload: payload.subarray(FTP_HEADER_LENGTH, FTP_HEADER_LENGTH + size)
  }
}
