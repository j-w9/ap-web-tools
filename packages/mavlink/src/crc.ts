/**
 * CRC-16/MCRF4XX, which MAVLink calls X.25: polynomial 0x1021 reflected, initial value 0xFFFF,
 * no final XOR. Upstream `mavlink20.x25Crc`.
 */

/** The initial CRC value. */
export const CRC_X25_INIT = 0xffff

/** Folds one byte into a running CRC. */
export function crcAccumulate(byte: number, crc: number): number {
  let tmp = (byte ^ crc) & 0xff
  tmp = (tmp ^ (tmp << 4)) & 0xff
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
}

/** CRC of `bytes`, continuing from `crc` (pass a previous result to checksum data in pieces). */
export function crcX25(bytes: Uint8Array, crc: number = CRC_X25_INIT): number {
  let result = crc
  for (const byte of bytes) result = crcAccumulate(byte, result)
  return result
}
