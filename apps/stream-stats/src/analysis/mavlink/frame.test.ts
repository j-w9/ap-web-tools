import { describe, expect, it } from 'vitest'
import { FRAMING_LENGTH, checkFrame, frameLength, readHeader, x25CrcBytes } from './frame.js'
import { encodeFrame } from '../test-support/tlog-writer.js'

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

describe('x25 checksum', () => {
  it('matches the CRC-16/MCRF4XX check value', () => {
    const bytes = ascii('123456789')
    expect(x25CrcBytes(bytes, 0, bytes.length)).toBe(0x6f91)
  })

  it('validates a known MAVLink 1 HEARTBEAT frame', () => {
    // Heartbeat from an ArduCopter (type 2, autopilot 3), system 1, component 1, sequence 0.
    const payload = [0, 0, 0, 0, 2, 3, 0x51, 4, 3]
    const frame = encodeFrame({ timeUs: 0n, version: 1, name: 'HEARTBEAT', payloadLength: 9 })
    expect(frame.length).toBe(17)
    frame.set(payload, 6)
    // Recompute the checksum independently: header and payload bytes, then CRC_EXTRA 50.
    const crc = x25CrcBytes(Uint8Array.of(50), 0, 1, x25CrcBytes(frame, 1, 15))
    frame[15] = crc & 0xff
    frame[16] = crc >> 8
    const view = new DataView(frame.buffer)
    const read = readHeader(view, 0)
    expect(read.kind).toBe('header')
    if (read.kind !== 'header') return
    expect(checkFrame(frame, view, 0, read.header, 50)).toBe(true)
    expect(checkFrame(frame, view, 0, read.header, 51)).toBe(false)
  })
})

describe('readHeader', () => {
  it('decodes MAVLink 1 and 2 headers', () => {
    const v1 = encodeFrame({
      timeUs: 0n,
      version: 1,
      name: 'ATTITUDE',
      payloadLength: 28,
      sequence: 7,
      systemId: 3,
      componentId: 4
    })
    const h1 = readHeader(new DataView(v1.buffer), 0)
    expect(h1).toEqual({
      kind: 'header',
      header: { version: 1, payloadLength: 28, sequence: 7, systemId: 3, componentId: 4, messageId: 30, signed: false }
    })

    const v2 = encodeFrame({
      timeUs: 0n,
      name: 'DEVICE_OP_READ',
      payloadLength: 5,
      sequence: 200,
      systemId: 255,
      componentId: 190,
      signed: true
    })
    const h2 = readHeader(new DataView(v2.buffer), 0)
    expect(h2).toEqual({
      kind: 'header',
      header: { version: 2, payloadLength: 5, sequence: 200, systemId: 255, componentId: 190, messageId: 11000, signed: true }
    })
    if (h2.kind === 'header') expect(frameLength(h2.header)).toBe(FRAMING_LENGTH[2] + 5 + 13)
  })

  it('reports missing magic and truncated headers', () => {
    expect(readHeader(new DataView(Uint8Array.of(0x00).buffer), 0)).toEqual({ kind: 'no-magic' })
    expect(readHeader(new DataView(Uint8Array.of(0xfe, 1, 2).buffer), 0)).toEqual({ kind: 'truncated' })
    expect(readHeader(new DataView(new Uint8Array([0xfd, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), 0)).toEqual({
      kind: 'truncated'
    })
  })
})
