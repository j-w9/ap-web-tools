import { parseIntelHex, type IntelHexSegment } from '@arduconfig/firmware-flash'

/**
 * A bootloader image as loaded from disk. Intel HEX carries its own addresses; a raw `.bin`
 * has none and is written at a start address chosen for the device.
 */
export type FirmwareImage =
  | { readonly format: 'hex'; readonly name: string; readonly segments: readonly IntelHexSegment[]; readonly size: number }
  | { readonly format: 'bin'; readonly name: string; readonly data: Uint8Array; readonly size: number }

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/** Read a bootloader file: `.hex` as Intel HEX, anything else as raw binary. */
export function parseFirmwareFile(name: string, bytes: Uint8Array): ParseResult<FirmwareImage> {
  if (bytes.length === 0) return { ok: false, error: `${name} is empty.` }
  if (!name.toLowerCase().endsWith('.hex')) {
    return { ok: true, value: { format: 'bin', name, data: bytes, size: bytes.length } }
  }
  let segments: readonly IntelHexSegment[]
  try {
    segments = parseIntelHex(new TextDecoder().decode(bytes)).segments
  } catch (e) {
    return { ok: false, error: `${name} is not valid Intel HEX: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (segments.length === 0) return { ok: false, error: `${name} contains no data records.` }
  const size = segments.reduce((n, s) => n + s.data.length, 0)
  return { ok: true, value: { format: 'hex', name, segments, size } }
}

/** Segments to write. A `.bin` is placed at `startAddress`; a `.hex` keeps its own addresses. */
export function imageSegments(image: FirmwareImage, startAddress: number): readonly IntelHexSegment[] {
  return image.format === 'hex' ? image.segments : [{ address: startAddress, data: image.data }]
}

/** Parse a hexadecimal address such as `0x08000000`. Returns null for anything else. */
export function parseAddress(text: string): number | null {
  const match = /^\s*0x([0-9a-f]{1,8})\s*$/i.exec(text)
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 16)
}

/** Format an address as `0x08000000`. */
export function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`
}
