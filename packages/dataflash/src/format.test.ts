import { describe, expect, it } from 'vitest'
import { TYPE_SIZES, isTypeCode, makeFormat, readInt64, readNumber, readString, readUint64 } from './format.js'

describe('format', () => {
  it('knows the size of every type code', () => {
    expect(TYPE_SIZES.Q).toBe(8)
    expect(TYPE_SIZES.a).toBe(64)
    expect(TYPE_SIZES.N).toBe(16)
    expect(isTypeCode('f')).toBe(true)
    expect(isTypeCode('x')).toBe(false)
  })

  it('computes field offsets and body size', () => {
    const fmt = makeFormat(200, 0, 'ATT', 'QccccCCCC', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,ErrRP,ErrYaw')
    expect(fmt.size).toBe(8 + 2 * 8)
    expect(fmt.fieldOffsets).toEqual([0, 8, 10, 12, 14, 16, 18, 20, 22])
    expect(fmt.columns[2]).toBe('Roll')
    expect(fmt.types[0]).toBe('Q')
  })

  it('rejects unknown type codes', () => {
    expect(() => makeFormat(1, 0, 'BAD', 'Qx', 'a,b')).toThrow(/Unknown DataFlash type code/)
    expect(makeFormat(1, 0, 'BAD', 'Qx', 'a,b', true)).toBeUndefined()
  })

  it('pads missing column names', () => {
    const fmt = makeFormat(1, 0, 'X', 'Qff', 'TimeUS')
    expect(fmt.columns).toEqual(['TimeUS', 'field1', 'field2'])
  })

  it('reads NUL-padded strings, keeping embedded NULs', () => {
    const bytes = Uint8Array.from([65, 66, 0, 67, 0, 0])
    expect(readString(bytes, 0, 6)).toBe('AB\u0000C')
    expect(readString(bytes, 0, 2)).toBe('AB')
    expect(readString(bytes, 2, 1)).toBe('')
  })

  it('reads 64-bit integers as numbers', () => {
    const buf = new ArrayBuffer(16)
    const view = new DataView(buf)
    view.setBigUint64(0, 2n ** 53n - 1n, true)
    view.setBigInt64(8, -5_000_000_000n, true)
    expect(readUint64(view, 0)).toBe(2 ** 53 - 1)
    expect(readInt64(view, 8)).toBe(-5_000_000_000)
    expect(readNumber(view, 0, 'Q')).toBe(2 ** 53 - 1)
    expect(readNumber(view, 8, 'q')).toBe(-5_000_000_000)
  })

  it('applies the built-in /100 scaling', () => {
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    view.setInt16(0, -1234, true)
    view.setUint32(4, 123456, true)
    expect(readNumber(view, 0, 'c')).toBe(-12.34)
    expect(readNumber(view, 4, 'E')).toBe(1234.56)
    expect(() => readNumber(view, 0, 'N')).toThrow()
  })
})
