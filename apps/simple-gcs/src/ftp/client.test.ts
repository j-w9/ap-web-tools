// Port of upstream tests/mavftp.test.cjs. Real MAVLink 2 frames pass through an in-memory vehicle
// (encoder and parser on each side) and a fake clock drives retries.
import { FILE_TRANSFER_PROTOCOL, MavlinkEncoder, MavlinkParser } from '@apwt/mavlink'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../test-utils/fake-clock.js'
import { MavFtpClient, type FtpInbound, type FtpOutcome } from './client.js'
import { FtpError, FtpOp, packOp, parseOp, type FtpPacket } from './protocol.js'

interface ReplyOptions {
  readonly seq?: number
  readonly nack?: boolean
  readonly complete?: number
  readonly offset?: number
}

const value = <T>(o: FtpOutcome<T>): T | null => (o.kind === 'done' ? o.value : null)
const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

function harness() {
  const clock = new FakeClock(1000)
  const toServer = new MavlinkParser({ messages: [FILE_TRANSFER_PROTOCOL] })
  const toClient = new MavlinkParser({ messages: [FILE_TRANSFER_PROTOCOL] })
  const clientEncoder = new MavlinkEncoder({ systemId: 255, componentId: 190 })
  const serverEncoder = new MavlinkEncoder({ systemId: 42, componentId: 1 })
  const sent: FtpPacket[] = []
  const ftp = new MavFtpClient(
    {
      sourceSystem: 255,
      sourceComponent: 190,
      send(payload, targetSystem, targetComponent) {
        const frame = clientEncoder.encode(FILE_TRANSFER_PROTOCOL, { targetNetwork: 0, targetSystem, targetComponent, payload })
        const [m] = toServer.push(frame)
        sent.push(parseOp(m!.fields.payload)!)
      }
    },
    clock
  )
  ftp.targetSystem = 42
  ftp.targetComponent = 1
  function reply(
    request: Pick<FtpPacket, 'seq' | 'session' | 'opcode' | 'offset'>,
    payload: ArrayLike<number> = [],
    opts: ReplyOptions = {}
  ): boolean {
    const bytes = Uint8Array.from(payload)
    const body = packOp(
      opts.seq ?? (request.seq + 1) & 65535,
      request.session,
      opts.nack === true ? FtpOp.Nack : FtpOp.Ack,
      bytes.length,
      request.opcode,
      opts.complete ?? 0,
      opts.offset ?? request.offset,
      bytes
    )
    const [m] = toClient.push(
      serverEncoder.encode(FILE_TRANSFER_PROTOCOL, { targetNetwork: 0, targetSystem: 255, targetComponent: 190, payload: body })
    )
    return ftp.handleMessage(m!)
  }
  function open(size: number, callback: (o: FtpOutcome<Uint8Array>) => void): FtpPacket | undefined {
    ftp.getFile('test.bin', callback)
    const request = sent.shift()!
    reply(request, u32(size))
    return sent.shift()
  }
  return { ftp, sent, reply, open, clock }
}

describe('MAVFTP downloads', () => {
  for (const size of [0, 1, 80, 160, 239, 240, 2048]) {
    it(`download ${size} bytes exactly, including zero padding`, () => {
      const h = harness()
      const data = Uint8Array.from({ length: size }, (_, i) => i & 255)
      let result: Uint8Array | null | undefined
      let calls = 0
      let request = h.open(size, (d) => {
        result = value(d)
        calls++
      })
      while (request && request.opcode !== FtpOp.TerminateSession) {
        for (let offset = request.offset; offset < size; offset += 80) {
          h.reply(request, data.subarray(offset, offset + 80), { offset, complete: offset + 80 >= size ? 1 : 0 })
        }
        request = h.sent.shift()
      }
      expect(result).toEqual(data)
      expect(calls).toBe(1)
      expect(h.ftp.timerActive).toBe(false)
    })
  }

  it('EOF cannot truncate a missing final burst packet', () => {
    const h = harness()
    const expected = Uint8Array.from({ length: 160 }, (_, i) => i)
    let result: Uint8Array | null | undefined
    const req = h.open(160, (d) => (result = value(d)))!
    h.reply(req, expected.subarray(0, 80), { offset: 0 })
    h.reply(req, [FtpError.EndOfFile], { offset: 160, nack: true })
    expect(result).toBeUndefined()
    const gap = h.sent.shift()!
    expect(gap.opcode).toBe(FtpOp.ReadFile)
    expect(gap.offset).toBe(80)
    h.reply(gap, expected.subarray(80))
    expect(result).toEqual(expected)
  })

  it('out-of-order and duplicate bursts fill missing intervals without duplicate gaps', () => {
    const h = harness()
    const expected = Uint8Array.from({ length: 400 }, (_, i) => i & 255)
    let result: Uint8Array | null | undefined
    const req = h.open(400, (d) => (result = value(d)))!
    h.reply(req, expected.subarray(160, 240), { offset: 160 })
    h.reply(req, expected.subarray(160, 240), { offset: 160 })
    h.reply(req, expected.subarray(0, 80), { offset: 0 })
    h.reply(req, expected.subarray(320), { offset: 320, complete: 1 })
    expect(h.sent.map((r) => r.offset)).toEqual([80, 240])
    for (const gap of h.sent.splice(0)) h.reply(gap, expected.subarray(gap.offset, gap.offset + gap.size))
    expect(result).toEqual(expected)
  })

  it('short gap replies leave only the missing suffix to request', () => {
    const h = harness()
    let result: Uint8Array | null | undefined
    const req = h.open(80, (d) => (result = value(d)))!
    h.reply(req, [6], { nack: true, offset: 80 })
    const gap = h.sent.shift()!
    h.reply(gap, new Uint8Array(30))
    const rest = h.sent.shift()!
    expect(rest.offset).toBe(30)
    expect(rest.size).toBe(50)
    h.reply(rest, new Uint8Array(50))
    expect(result?.length).toBe(80)
  })

  it('open and burst retries keep the same sequence and wait a full timeout', () => {
    const h = harness()
    h.ftp.getFile('file', () => {})
    const open = h.sent.shift()!
    h.clock.tick(3000)
    const retry = h.sent.shift()!
    expect(retry.seq).toBe(open.seq)
    expect(retry.session).toBe(open.session)
    h.reply(retry, u32(80))
    const burst = h.sent.shift()!
    h.clock.tick(3000)
    const burstRetry = h.sent.shift()!
    expect(burstRetry.seq).toBe(burst.seq)
    h.clock.tick(250)
    expect(h.sent.length).toBe(0)
  })

  it('gap recovery keeps at most five reads in flight and retries dropped replies', () => {
    const h = harness()
    const data = Uint8Array.from({ length: 900 }, (_, i) => i & 255)
    let result: Uint8Array | null | undefined
    const burst = h.open(data.length, (d) => (result = value(d)))!
    h.reply(burst, [6], { nack: true, offset: 900 })
    expect(h.sent.length).toBe(5)
    const dropped = h.sent.shift()!
    let count = 0
    while (h.sent.length && count++ < 30) {
      const r = h.sent.shift()!
      if (r.opcode === 5) h.reply(r, data.subarray(r.offset, r.offset + r.size))
      expect(h.ftp.download!.pendingReads).toBeLessThanOrEqual(5)
    }
    expect(result).toBeUndefined()
    h.clock.tick(1000)
    const retry = h.sent.shift()!
    expect(retry.seq).toBe(dropped.seq)
    h.reply(retry, data.subarray(retry.offset, retry.offset + retry.size))
    expect(result).toEqual(data)
  })

  it('timeouts finish once and clear timers before a callback starts the next file', () => {
    const h = harness()
    let calls = 0
    h.ftp.maxOpenRetries = 0
    h.ftp.getFile('first', (d) => {
      expect(value(d)).toBeNull()
      calls++
      h.ftp.getFile('second', () => {})
    })
    h.clock.tick(3000)
    expect(calls).toBe(1)
    expect(h.ftp.activePath).toBe('second')
    expect(h.ftp.download?.opening).toBe(true)
  })

  it('completion is reentrant and stale replies cannot alter the next transfer', () => {
    const h = harness()
    let result: Uint8Array | null | undefined
    const burst = h.open(1, () => h.ftp.getFile('second', (d) => (result = value(d))))!
    h.reply(burst, [7], { complete: 1 })
    const newSession = h.ftp.session
    expect(h.ftp.activePath).toBe('second')
    expect(newSession).not.toBe(burst.session)
    expect(h.reply(burst, [9], { complete: 1 })).toBe(false)
    expect(result).toBeUndefined()
  })

  it('wrong source, destination, session and sequence are ignored', () => {
    const h = harness()
    h.ftp.getFile('file', () => {})
    const request = h.sent.shift()!
    expect(h.reply({ ...request, seq: request.seq + 3 }, [1, 0, 0, 0])).toBe(false)
    expect(h.reply({ ...request, session: request.session + 1 }, [1, 0, 0, 0])).toBe(false)
    const body = packOp(request.seq + 1, request.session, 128, 4, 4, 0, 0, [1, 0, 0, 0])
    const msg = {
      name: 'FILE_TRANSFER_PROTOCOL',
      header: { systemId: 41, componentId: 1 },
      fields: { targetSystem: 255, targetComponent: 190, payload: body }
    } satisfies FtpInbound
    expect(h.ftp.handleMessage(msg)).toBe(false)
    expect(
      h.ftp.handleMessage({ ...msg, header: { systemId: 42, componentId: 1 }, fields: { ...msg.fields, targetComponent: 2 } })
    ).toBe(false)
    expect(h.ftp.download?.opening).toBe(true)
  })

  it('wire header uses all 16 sequence bits and byte offsets', () => {
    // Upstream also accepts strings and plain arrays (artifacts of its untyped MAVLink library);
    // the typed parser only receives Uint8Array, including subarrays with a byte offset.
    const { ftp } = harness()
    const b = packOp(65535, 7, 128, 3, 5, 1, 0x12345678, [0, 128, 255])
    const padded = new Uint8Array(b.length + 8)
    padded.set(b, 4)
    for (const input of [b, padded.subarray(4, -4)]) {
      const op = parseOp(input)!
      expect(op.seq).toBe(65535)
      expect(op.offset).toBe(0x12345678)
      expect(op.payload).toEqual(Uint8Array.from([0, 128, 255]))
    }
    ftp.seq = 65535
    ftp.getFile('file', () => {})
    expect(ftp.seq).toBe(0)
    expect(parseOp(b.subarray(0, 13))).toBeNull()
    b[4] = 240
    expect(parseOp(b)).toBeNull()
  })

  it('NACK, excessive file sizes and invalid paths fail without leaking a transfer', () => {
    const h = harness()
    let calls = 0
    const fail = (d: FtpOutcome<Uint8Array>): void => {
      expect(value(d)).toBeNull()
      calls++
    }
    h.ftp.getFile('missing', fail)
    h.reply(h.sent.shift()!, [10], { nack: true })
    h.sent.length = 0
    h.open(h.ftp.maxFileSize + 1, fail)
    h.ftp.getFile('x'.repeat(240), fail)
    h.ftp.getFile('x\0y', fail)
    expect(calls).toBe(4)
    expect(h.ftp.activePath).toBeNull()
    expect(h.ftp.timerActive).toBe(false)
  })

  it('malformed or out-of-bounds data never grows the buffer or completes the file', () => {
    const h = harness()
    let result: Uint8Array | null | undefined
    const burst = h.open(80, (d) => (result = value(d)))!
    expect(h.reply(burst, [1, 2], { offset: 79 })).toBe(false)
    expect(h.reply(burst, [], { offset: 0 })).toBe(false)
    expect(h.ftp.download?.bufferLength).toBe(80)
    expect(result).toBeUndefined()
  })

  it('burst retry exhaustion fails once and releases the session', () => {
    const h = harness()
    let calls = 0
    h.ftp.maxBurstRetries = 1
    h.open(160, (d) => {
      expect(value(d)).toBeNull()
      calls++
    })
    h.clock.tick(3000)
    h.clock.tick(3000)
    expect(calls).toBe(1)
    expect(h.ftp.activePath).toBeNull()
    h.clock.tick(6000)
    expect(calls).toBe(1)
  })

  it('gap retry exhaustion fails without returning a zero-filled file', () => {
    const h = harness()
    let calls = 0
    h.ftp.maxGapRetries = 1
    const burst = h.open(160, (d) => {
      expect(value(d)).toBeNull()
      calls++
    })!
    h.reply(burst, [6], { nack: true })
    h.clock.tick(1000)
    h.clock.tick(1000)
    expect(calls).toBe(1)
    expect(h.ftp.download?.pendingReads ?? 0).toBe(0)
  })

  it('cancellation reports failure once and ignores a late open ACK', () => {
    const h = harness()
    let calls = 0
    h.ftp.getFile('file', (d) => {
      expect(value(d)).toBeNull()
      calls++
    })
    const open = h.sent.shift()!
    h.ftp.cancel()
    h.ftp.cancel()
    expect(calls).toBe(1)
    expect(h.reply(open, [1, 0, 0, 0])).toBe(false)
    h.clock.tick(10000)
    expect(calls).toBe(1)
  })
})

describe('MAVFTP uploads', () => {
  for (const size of [0, 1, 239, 240, 1600]) {
    it(`upload ${size} bytes waits for every write and close ACK`, () => {
      const h = harness()
      const bytes = Uint8Array.from({ length: size }, (_, i) => i & 255)
      let result: number | null | undefined
      h.ftp.putFile('out.bin', bytes, (d) => (result = value(d)))
      const create = h.sent.shift()!
      expect(create.opcode).toBe(6)
      h.reply(create)
      const received = new Uint8Array(size)
      for (;;) {
        const req = h.sent.shift()
        expect(req).toBeDefined()
        expect(result).toBeUndefined()
        if (req!.opcode === 1) {
          h.reply(req!)
          break
        }
        expect(req!.opcode).toBe(7)
        received.set(req!.payload, req!.offset)
        h.reply(req!)
      }
      expect(result).toBe(size)
      expect(received).toEqual(bytes)
      expect(h.sent.length).toBe(0)
      expect(h.ftp.timerActive).toBe(false)
    })
  }

  it('upload retries exact bytes and sequence; stale, wrong-offset and foreign replies do not advance', () => {
    const h = harness()
    let result: number | null | undefined
    h.ftp.putFile('out', new Uint8Array(300), (d) => (result = value(d)))
    const create = h.sent.shift()!
    h.clock.tick(3000)
    const retry = h.sent.shift()!
    expect(retry).toEqual(create)
    h.reply(create)
    const write = h.sent.shift()!
    expect(h.reply(create)).toBe(false)
    expect(h.reply(write, [], { offset: 1 })).toBe(false)
    const bad = { ...write, session: (write.session + 1) & 255 }
    expect(h.reply(bad)).toBe(false)
    h.clock.tick(3000)
    expect(h.sent.shift()).toEqual(write)
    h.reply(write)
    const next = h.sent.shift()!
    h.reply(next)
    const close = h.sent.shift()!
    h.clock.tick(3000)
    expect(h.sent.shift()).toEqual(close)
    expect(result).toBeUndefined()
    h.reply(close)
    expect(result).toBe(300)
  })

  for (const stage of ['create', 'write', 'close', 'timeout', 'cancel'] as const) {
    it(`upload failure at ${stage} finishes once without success`, () => {
      const h = harness()
      let calls = 0
      let result: number | null | undefined
      h.ftp.putFile('out', new Uint8Array(1), (d) => {
        calls++
        result = value(d)
      })
      let req = h.sent.shift()!
      if (stage !== 'create' && stage !== 'timeout' && stage !== 'cancel') {
        h.reply(req)
        req = h.sent.shift()!
      }
      if (stage === 'close') {
        h.reply(req)
        req = h.sent.shift()!
      }
      if (stage === 'timeout') {
        for (let i = 0; i < 7; i++) h.clock.tick(3000)
      } else if (stage === 'cancel') h.ftp.cancel()
      else h.reply(req, [1], { nack: true })
      expect(result).toBeNull()
      expect(calls).toBe(1)
      h.reply(req)
      expect(calls).toBe(1)
    })
  }
})

describe('MAVFTP virtual files, wrap and legacy sessions', () => {
  for (const estimate of [80, 400]) {
    it(`virtual file ignores size estimate ${estimate} but waits for EOF and missing fixed-size blocks`, () => {
      const h = harness()
      const bytes = Uint8Array.from({ length: 170 }, (_, i) => i)
      let result: Uint8Array | null | undefined
      h.ftp.getFile('@PARAM/param.pck', (d) => (result = value(d)), { sizeIsEstimate: true, fixedReadSize: true })
      const create = h.sent.shift()!
      h.reply(create, u32(estimate))
      const burst = h.sent.shift()!
      h.reply(burst, bytes.subarray(0, 80), { offset: 0 })
      // Lose the middle block and the short final block. EOF alone cannot report success, even
      // when the advertised estimate was too small.
      expect(result).toBeUndefined()
      h.reply(burst, [6], { offset: 170, nack: true })
      const gaps = h.sent.splice(0)
      expect(gaps.map((g) => g.size)).toEqual([80, 80])
      for (const req of gaps) h.reply(req, bytes.subarray(req.offset, req.offset + req.size))
      expect(result).toEqual(bytes)
    })
  }

  it('virtual file can grow beyond its estimate and exact-size files still reject extra data', () => {
    const h = harness()
    let result: Uint8Array | null | undefined
    h.ftp.getFile('@PARAM/param.pck', (d) => (result = value(d)), { sizeIsEstimate: true })
    h.reply(h.sent.shift()!, u32(10))
    const req = h.sent.shift()!
    const bytes = new Uint8Array(20).fill(7)
    h.reply(req, bytes, { offset: 0 })
    expect(result).toBeUndefined()
    h.reply(req, [6], { offset: 20, nack: true })
    expect(result).toEqual(bytes)
  })

  for (const droppedData of [false, true]) {
    for (const startSeq of [0, 65534]) {
      it(`ArduPilot cached single-packet burst: loss=${droppedData}, sequence=${startSeq}`, () => {
        const h = harness()
        const expected = Uint8Array.from([10, 20, 30, 40])
        h.ftp.seq = startSeq
        let result: Uint8Array | null | undefined
        let closed = false
        let cached: { request: FtpPacket; payload: ArrayLike<number>; opts: ReplyOptions; seq: number } | undefined
        h.ftp.getFile('small-fence.dat', (d) => (result = value(d)))
        // GCS_FTP caches the last reply, even when that packet was dropped.
        const respond = (request: FtpPacket, payload: ArrayLike<number>, opts: ReplyOptions = {}): void => {
          cached = { request, payload, opts, seq: opts.seq ?? (request.seq + 1) & 65535 }
          h.reply(request, payload, opts)
        }
        for (let steps = 0; h.sent.length && steps < 20; steps++) {
          const request = h.sent.shift()!
          if (cached && request.session === cached.request.session && ((request.seq + 1) & 65535) === cached.seq) {
            h.reply(cached.request, cached.payload, cached.opts)
            continue
          }
          if (request.opcode === FtpOp.OpenFileRO) respond(request, [4, 0, 0, 0])
          else if (request.opcode === FtpOp.BurstReadFile) {
            if (!droppedData) respond(request, expected)
            respond(request, [6], { seq: (request.seq + 2) & 65535, offset: 4, nack: true, complete: 1 })
          } else if (request.opcode === FtpOp.ReadFile) respond(request, expected)
          else if (request.opcode === FtpOp.TerminateSession) {
            closed = true
            respond(request, [])
          } else throw new Error(`unexpected request ${request.opcode}`)
        }
        expect(result, 'gap recovery must escape the cached EOF').toEqual(expected)
        expect(closed, 'TerminateSession must reach the server').toBe(true)
      })
    }
  }

  it('burst reply sequence wraps and reordered replies never move it backwards', () => {
    const h = harness()
    h.ftp.seq = 65533
    const burst = h.open(240, () => {})!
    h.reply(burst, new Uint8Array(80), { offset: 80, seq: 0 })
    expect(h.ftp.seq).toBe(1)
    h.reply(burst, new Uint8Array(80), { offset: 0, seq: 65535 })
    expect(h.ftp.seq).toBe(1)
    h.reply(burst, new Uint8Array(80), { offset: 160, seq: 1 })
    expect(h.sent.at(-1)!.seq).toBe(2)
  })

  it('non-EOF burst NAK fails once, preserving server sequence for close', () => {
    const h = harness()
    let result: Uint8Array | null | 'pending' = 'pending'
    let calls = 0
    const burst = h.open(160, (d) => {
      result = value(d)
      calls++
    })!
    h.reply(burst, [FtpError.FailErrno, 5], { nack: true, seq: 12 })
    expect(result).toBeNull()
    expect(calls).toBe(1)
    expect(h.sent.at(-1)!.seq).toBe(13)
  })

  it('estimated-file EOF below received data or above the size limit is ignored', () => {
    const h = harness()
    h.ftp.getFile('param.pck', () => {}, { sizeIsEstimate: true })
    h.reply(h.sent.shift()!, [160, 0, 0, 0])
    const burst = h.sent.shift()!
    h.reply(burst, new Uint8Array(80), { offset: 80 })
    expect(h.reply(burst, [6], { nack: true, offset: 80, seq: 300 })).toBe(false)
    expect(h.reply(burst, [6], { nack: true, offset: h.ftp.maxFileSize + 1, seq: 300 })).toBe(false)
    expect(h.ftp.download?.actualSize).toBeNull()
    expect(h.ftp.download?.bursting).toBe(true)
  })

  it('reset sessions retries lost ACKs and completes before any file opens', () => {
    const h = harness()
    let result: true | null | undefined
    h.ftp.resetSessions((ok) => (result = value(ok)))
    const request = h.sent.shift()!
    expect(request.opcode).toBe(FtpOp.ResetSessions)
    h.clock.tick(3000)
    expect(h.sent.shift()!.seq).toBe(request.seq)
    h.reply({ ...request, seq: (request.seq - 1) & 65535 })
    expect(result).toBeUndefined()
    h.reply(request)
    expect(result).toBe(true)
    expect(h.ftp.timerActive).toBe(false)
    expect(h.sent.length, 'reset does not terminate an unrelated session').toBe(0)
  })

  for (const operation of ['download', 'upload'] as const) {
    for (const failure of ['rejected', 'timeout', 'cancel'] as const) {
      it(`${operation} ${failure} before open ACK never terminates another client's legacy session`, () => {
        const h = harness()
        let result: unknown
        h.ftp.maxOpenRetries = 0
        if (operation === 'download') h.ftp.getFile('ours', (d) => (result = value(d)))
        else h.ftp.putFile('ours', new Uint8Array([1]), (d) => (result = value(d)))
        const open = h.sent.shift()!
        // ArduPilot 4.6 has one file shared by all GCS identities. Its terminate handler checks
        // only the FTP session byte, not the owner.
        let otherFileOpen = true
        if (failure === 'rejected') h.reply(open, [FtpError.Fail], { nack: true })
        else if (failure === 'timeout') h.clock.tick(3000)
        else h.ftp.cancel()
        for (const request of h.sent) {
          if (
            (request.opcode === FtpOp.ResetSessions || request.opcode === FtpOp.TerminateSession) &&
            request.session === open.session
          ) {
            otherFileOpen = false
          }
        }
        expect(result).toBeNull()
        expect(otherFileOpen).toBe(true)
        expect(h.sent.length, 'no cleanup request without an acknowledged open').toBe(0)
      })
    }
  }

  for (const operation of ['download', 'upload'] as const) {
    it(`${operation} cancellation after an open ACK releases its own session`, () => {
      const h = harness()
      if (operation === 'download') h.open(80, () => {})
      else {
        h.ftp.putFile('ours', new Uint8Array([1]), () => {})
        h.reply(h.sent.shift()!)
      }
      h.sent.length = 0
      h.ftp.cancel()
      expect(h.sent.length).toBe(1)
      expect(h.sent[0]!.opcode).toBe(FtpOp.TerminateSession)
    })
  }

  it('OpenFileRO reply sequence wraps from 65535 to zero and rejects stale replies', () => {
    const h = harness()
    h.ftp.seq = 65535
    let result: Uint8Array | null | undefined
    h.ftp.getFile('empty', (d) => (result = value(d)))
    const open = h.sent.shift()!
    expect(open.seq).toBe(65535)
    expect(h.reply(open, [0, 0, 0, 0], { seq: 65535 })).toBe(false)
    expect(result).toBeUndefined()
    expect(h.reply(open, [0, 0, 0, 0], { seq: 0 })).toBe(true)
    expect(result).toEqual(new Uint8Array())
  })

  it('ReadFile reply sequence wraps to zero, including retry after packet loss', () => {
    const h = harness()
    let result: Uint8Array | null | undefined
    const burst = h.open(3, (d) => (result = value(d)))!
    // The EOF leaves a gap. Place its recovery request at the wrap boundary.
    h.ftp.seq = 65535
    h.reply(burst, [6], { nack: true, offset: 3, seq: 65534 })
    const gap = h.sent.shift()!
    expect(gap.opcode).toBe(FtpOp.ReadFile)
    expect(gap.seq).toBe(65535)
    h.clock.tick(1000)
    expect(h.sent.shift()!.seq).toBe(65535)
    expect(h.reply(gap, [7, 8, 9], { seq: 65535 })).toBe(false)
    expect(result).toBeUndefined()
    expect(h.reply(gap, [7, 8, 9], { seq: 0 })).toBe(true)
    expect(result).toEqual(Uint8Array.from([7, 8, 9]))
  })
})
