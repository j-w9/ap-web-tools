import { describe, expect, it } from 'vitest'
import { formatAddress, imageSegments, parseAddress, parseFirmwareFile } from './image.js'

const encode = (text: string) => new TextEncoder().encode(text)

// Two data records at 0x08000000 and an end-of-file record.
const HEX = [':020000040800F2', ':0400000001020304F2', ':00000001FF'].join('\n')

describe('parseFirmwareFile', () => {
  it('reads a .bin as raw bytes', () => {
    const r = parseFirmwareFile('bl.bin', new Uint8Array([1, 2, 3]))
    expect(r.ok && r.value.format === 'bin' && r.value.size).toBe(3)
  })

  it('reads a .hex with its own addresses', () => {
    const r = parseFirmwareFile('bl.hex', encode(HEX))
    if (!r.ok || r.value.format !== 'hex') throw new Error('expected hex')
    expect(r.value.segments[0]?.address).toBe(0x08000000)
    expect(Array.from(r.value.segments[0]?.data ?? [])).toEqual([1, 2, 3, 4])
  })

  it('rejects empty and malformed files with a message', () => {
    expect(parseFirmwareFile('x.bin', new Uint8Array(0))).toEqual({ ok: false, error: 'x.bin is empty.' })
    const bad = parseFirmwareFile('x.hex', encode('not hex'))
    expect(bad.ok).toBe(false)
  })
})

describe('imageSegments', () => {
  it('places a .bin at the start address and leaves .hex addresses alone', () => {
    const bin = parseFirmwareFile('a.bin', new Uint8Array([9]))
    if (!bin.ok) throw new Error(bin.error)
    expect(imageSegments(bin.value, 0x08000000)[0]?.address).toBe(0x08000000)
    const hex = parseFirmwareFile('a.hex', encode(HEX))
    if (!hex.ok) throw new Error(hex.error)
    expect(imageSegments(hex.value, 0x1234)[0]?.address).toBe(0x08000000)
  })
})

describe('addresses', () => {
  it('parses and formats hexadecimal addresses', () => {
    expect(parseAddress('0x08000000')).toBe(0x08000000)
    expect(parseAddress(' 0X8004000 ')).toBe(0x08004000)
    expect(parseAddress('134217728')).toBeNull()
    expect(formatAddress(0x08000000)).toBe('0x08000000')
  })
})
