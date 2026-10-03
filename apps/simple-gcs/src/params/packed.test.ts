// Port of upstream tests/mavparam.test.cjs (packed format and text), plus oracle comparisons with
// upstream `modules/MAVLink/mavparam.js` on the same inputs.
import { describe, expect, it } from 'vitest'
import { paramsFixture, upstreamMavParam } from '../test-utils/upstream.js'
import {
  decodeParams,
  encodeUpload,
  formatParamValue,
  paramVehicle,
  parseParamText,
  saveParamText,
  valueForType,
  type ParamType
} from './packed.js'

const fixture = paramsFixture()
const packed = (): Uint8Array => Uint8Array.from(Buffer.from(fixture.hex, 'hex'))
const upstream = upstreamMavParam()

describe('packed parameters (upstream tests)', () => {
  it('packed defaults decode independent Python/MAVProxy fixtures, padding and exact int32', () => {
    const data = decodeParams(packed())
    expect(data.size).toBe(6)
    expect(data.get('TEST_I32')).toEqual({ name: 'TEST_I32', value: 16777217, type: 3, defaultValue: 0 })
    expect(data.get('TEST_FLOAT')!.defaultValue).toBe(0.5)
    expect(data.get('TEST_I16')!.value).toBe(-1234)
    const offset = new Uint8Array(7 + packed().length)
    offset.set(packed(), 7)
    expect(decodeParams(offset.subarray(7))).toEqual(data)
  })

  it('implicit defaults and no-default files', () => {
    for (const magic of [0x671b, 0x671c]) {
      const bytes = Uint8Array.from([0, 0, 1, 0, 1, 0, 1, 0, 65, 12])
      new DataView(bytes.buffer).setUint16(0, magic, true)
      const p = decodeParams(bytes).get('A')!
      expect(p.value).toBe(12)
      expect(p.defaultValue).toBe(magic === 0x671c ? 12 : undefined)
    }
  })

  it('malformed records, prefixes, counts, duplicate names, flags and nonfinite values fail', () => {
    for (let i = 0; i < packed().length - 2; i++) expect(() => decodeParams(packed().subarray(0, i)), `truncation ${i}`).toThrow()
    for (const [offset, value] of [
      [0, 0],
      [2, 7],
      [6, 0x51],
      [7, 15]
    ] as const) {
      const b = packed()
      b[offset] = value
      expect(() => decodeParams(b)).toThrow()
    }
    const bad = packed()
    new DataView(bad.buffer).setFloat32(fixture.offsets.TEST_FLOAT!.offset, Infinity, true)
    expect(() => decodeParams(bad)).toThrow(/finite/)
  })

  it('upload encoding matches independent bytes and preserves int32 beyond float precision', () => {
    expect(Buffer.from(encodeUpload([{ name: 'TEST_I32', value: 16777219, type: 3 }])).toString('hex')).toBe(fixture.uploadHex)
    for (const [type, value] of [
      [1, 128],
      [2, -32769],
      [3, 2147483648],
      [3, 1.5],
      [4, Infinity],
      [4, 1e50]
    ] as const) {
      expect(() => encodeUpload([{ name: 'TEST', value, type }])).toThrow()
    }
    expect(() => encodeUpload([{ name: 'TOO_LONG_PARAMETER_NAME', value: 1, type: 1 }])).toThrow()
  })

  it('parameter text supports MAVProxy and QGC, rejects malformed and duplicate lines', () => {
    expect(parseParamText('# parameters\nTEST_I8,-2\nTEST_FLOAT = 1.25 # note\n')).toEqual(
      new Map([
        ['TEST_I8', -2],
        ['TEST_FLOAT', 1.25]
      ])
    )
    expect(parseParamText('1\t1\tTEST_I32\t16777219\t6')).toEqual(new Map([['TEST_I32', 16777219]]))
    for (const text of ['', 'A NaN', 'A 1\nA 2', 'A 1 junk', 'A 0x10', 'A Infinity']) expect(() => parseParamText(text)).toThrow()
    const params = decodeParams(packed())
    const parsed = parseParamText(saveParamText(params.values()))
    for (const p of params.values()) expect(valueForType(parsed.get(p.name)!, p.type)).toBe(p.value)
  })

  it('short display decimals retain exact float32 values', () => {
    const p = { type: 4, value: Math.fround(0.1) } as const
    expect(formatParamValue(p)).toBe('0.1')
    expect(Math.fround(Number(formatParamValue(p)))).toBe(p.value)
  })
})

describe('packed parameters (oracle against upstream mavparam.js)', () => {
  it('decode, save and format agree on the fixture', () => {
    const ours = decodeParams(packed())
    const theirs = upstream.decode(packed())
    expect([...ours.values()]).toEqual(
      [...theirs.values()].map((p) => (p.defaultValue === undefined ? { name: p.name, value: p.value, type: p.type } : p))
    )
    expect(saveParamText(ours.values())).toBe(upstream.saveText(theirs.values()))
  })

  it('formatValue and valueForType agree on assorted values', () => {
    const values = [0, 1, -1, 0.1, 1 / 3, 1e-7, 123456.789, 3.4e38, -2147483648, 2147483647, 16777217, 0.30000001, 1e20, 7.25]
    for (const type of [1, 2, 3, 4] as const satisfies readonly ParamType[]) {
      for (const raw of values) {
        let theirs: string
        try {
          // Upstream `valueForType` is private; the round trip through encode/decode exercises it.
          const bytes = upstream.encodeUpload([{ name: 'X', value: raw, type }])
          const header = new Uint8Array(bytes)
          new DataView(header.buffer).setUint16(4, new DataView(header.buffer).getUint16(2, true), true)
          theirs = String(upstream.decode(header).get('X')?.value)
        } catch {
          theirs = 'throws'
        }
        let ours: string
        try {
          ours = String(valueForType(raw, type))
        } catch {
          ours = 'throws'
        }
        expect(ours, `type ${type} value ${raw}`).toBe(theirs)
        if (ours !== 'throws')
          expect(formatParamValue({ type, value: Number(ours) })).toBe(upstream.formatValue({ type, value: Number(ours) }))
      }
    }
  })

  it('encodeUpload produces identical bytes for a multi-parameter set', () => {
    const set = [
      { name: 'SERVO1_FUNCTION', value: 33, type: 2 },
      { name: 'SERVO10_FUNCTION', value: 0, type: 2 },
      { name: 'ARMING_CHECK', value: 1, type: 3 },
      { name: 'ATC_RAT_RLL_P', value: 0.135, type: 4 },
      { name: 'A', value: -5, type: 1 }
    ] as const
    expect(encodeUpload(set)).toEqual(Uint8Array.from(upstream.encodeUpload(set)))
  })

  it('parseText agrees on accepted and rejected inputs', () => {
    const inputs = [
      'A 1',
      'a,2',
      'A=3.5e2',
      '﻿A 1\r\nB 2',
      'A 1 ; comment',
      '1 1 A 2 9',
      '1 x A 2 9',
      'A .5',
      'A 5.',
      'A -0',
      'A +1',
      'A 1e400',
      'TOO_LONG_PARAMETER_NAME 1',
      'A',
      '# only comment'
    ]
    for (const text of inputs) {
      const run = (f: () => Map<string, number>): string => {
        try {
          return JSON.stringify([...f()])
        } catch (e) {
          return `throws ${(e as Error).message}`
        }
      }
      expect(
        run(() => parseParamText(text)),
        text
      ).toBe(run(() => upstream.parseText(text)))
    }
  })

  it('vehicle names agree for every MAV_TYPE', () => {
    for (let type = 0; type < 50; type++) expect(paramVehicle(type)).toBe(upstream.vehicleName(type))
  })
})
