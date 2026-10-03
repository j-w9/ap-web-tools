// Test-only: builds Intel HEX text.

function record(type: number, address: number, data: readonly number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data]
  const checksum = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff
  return ':' + [...bytes, checksum].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
}

/** HEX text for `data` at `base`, 16 bytes per record, with extended linear address records. */
export function intelHex(base: number, data: readonly number[], eol = '\n'): string {
  const lines: string[] = []
  let upper = -1
  for (let offset = 0; offset < data.length; offset += 16) {
    const address = base + offset
    if (address >>> 16 !== upper) {
      upper = address >>> 16
      lines.push(record(4, 0, [(upper >> 8) & 0xff, upper & 0xff]))
    }
    lines.push(record(0, address & 0xffff, data.slice(offset, offset + 16)))
  }
  lines.push(record(5, 0, [0x08, 0x00, 0x01, 0xc5]))
  lines.push(record(1, 0, []))
  return lines.join(eol) + eol
}
