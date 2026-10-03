// Differential test: upstream `modules/MAVLink/mavftp.js` (MAVFTP, run as-is with its MAVLink
// library) and the port's `MavFtpClient` are driven by the same seeded, lossy simulated vehicle.
// Every request either side sends, every frame sequence number, every handleMessage result and
// every completion must be identical, through retries, drops, duplicates, stale and foreign
// replies, EOF handling, virtual files, uploads, resets and cancellation.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { FILE_TRANSFER_PROTOCOL, MavlinkEncoder, MavlinkParser } from '@apwt/mavlink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemClock } from '../clock.js'
import { UPSTREAM } from '../test-utils/upstream.js'
import { MavFtpClient, type FtpOutcome } from './client.js'
import { FtpOp, packOp, parseOp } from './protocol.js'

const require = createRequire(import.meta.url)

interface Packet {
  readonly frameSeq: number
  readonly seq: number
  readonly session: number
  readonly opcode: number
  readonly size: number
  readonly reqOpcode: number
  readonly burstComplete: number
  readonly offset: number
  readonly payload: readonly number[]
}

interface UpstreamOp {
  seq: number
  session: number
  opcode: number
  size: number
  req_opcode: number
  burst_complete: number
  offset: number
  payload: Uint8Array
}

interface UpstreamMessage {
  _name: string
  _header: { srcSystem: number; srcComponent: number; seq: number }
  target_system: number
  target_component: number
  payload: Uint8Array | number[]
}

interface UpstreamMavFtp {
  targetSystem: number
  targetComponent: number
  seq: number
  getFile(path: string, cb: (d: Uint8Array | null) => void, options?: { sizeIsEstimate?: boolean; fixedReadSize?: boolean }): void
  putFile(path: string, data: Uint8Array, cb: (d: number | null) => void): void
  resetSessions(cb: (d: true | null) => void): void
  cancel(): void
  handleMessage(m: UpstreamMessage): boolean
  parseOp(payload: Uint8Array | number[]): UpstreamOp | null
}

interface UpstreamProcessor {
  seq: number
  decode(bytes: Uint8Array): UpstreamMessage
}

interface UpstreamMavlink {
  mavlink20: unknown
  MAVLink20Processor: new (logger: null, system: number, component: number) => UpstreamProcessor
}

function loadUpstream(): {
  mav: UpstreamMavlink
  MAVFTP: new (mavlink: UpstreamProcessor, ws: { send(b: Uint8Array): void }) => UpstreamMavFtp
} {
  const mav = require(resolve(UPSTREAM, 'modules/MAVLink/mavlink.js')) as UpstreamMavlink
  Reflect.set(globalThis, 'mavlink20', mav.mavlink20)
  const mod = require(resolve(UPSTREAM, 'modules/MAVLink/mavftp.js')) as {
    MAVFTP: new (mavlink: UpstreamProcessor, ws: { send(b: Uint8Array): void }) => UpstreamMavFtp
  }
  return { mav, MAVFTP: mod.MAVFTP }
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The client side of one run, wrapping either implementation behind the same surface. */
interface Side {
  readonly sent: Packet[]
  getFile(path: string, options: { sizeIsEstimate?: boolean; fixedReadSize?: boolean }, onDone: (r: unknown) => void): void
  putFile(path: string, data: Uint8Array, onDone: (r: unknown) => void): void
  resetSessions(onDone: (r: unknown) => void): void
  cancel(): void
  /** Delivers a reply from (src system, src component) addressed to (target system, target component). */
  deliver(src: readonly [number, number], target: readonly [number, number], body: Uint8Array): boolean
  setSeq(seq: number): void
}

function upstreamSide(): Side {
  const { mav, MAVFTP } = loadUpstream()
  const client = new mav.MAVLink20Processor(null, 255, 190)
  const server = new mav.MAVLink20Processor(null, 42, 1)
  const sent: Packet[] = []
  const ftp: UpstreamMavFtp = new MAVFTP(client, {
    send(bytes) {
      const m = server.decode(bytes)
      const op = ftp.parseOp(m.payload)!
      sent.push({
        frameSeq: m._header.seq,
        seq: op.seq,
        session: op.session,
        opcode: op.opcode,
        size: op.size,
        reqOpcode: op.req_opcode,
        burstComplete: op.burst_complete,
        offset: op.offset,
        payload: Array.from(op.payload)
      })
    }
  })
  ftp.targetSystem = 42
  ftp.targetComponent = 1
  const norm = (d: unknown): unknown => (d instanceof Uint8Array ? Array.from(d) : d)
  return {
    sent,
    getFile: (path, options, onDone) => ftp.getFile(path, (d) => onDone(norm(d)), options),
    putFile: (path, data, onDone) => ftp.putFile(path, data, (d) => onDone(d)),
    resetSessions: (onDone) => ftp.resetSessions((d) => onDone(d)),
    cancel: () => ftp.cancel(),
    deliver: (src, target, body) =>
      ftp.handleMessage({
        _name: 'FILE_TRANSFER_PROTOCOL',
        _header: { srcSystem: src[0], srcComponent: src[1], seq: 0 },
        target_system: target[0],
        target_component: target[1],
        payload: body
      }),
    setSeq: (seq) => (ftp.seq = seq)
  }
}

function portSide(): Side {
  const toServer = new MavlinkParser({ messages: [FILE_TRANSFER_PROTOCOL] })
  const encoder = new MavlinkEncoder({ systemId: 255, componentId: 190 })
  const sent: Packet[] = []
  const ftp = new MavFtpClient(
    {
      sourceSystem: 255,
      sourceComponent: 190,
      send(payload, targetSystem, targetComponent) {
        const [m] = toServer.push(
          encoder.encode(FILE_TRANSFER_PROTOCOL, { targetNetwork: 0, targetSystem, targetComponent, payload })
        )
        const op = parseOp(m!.fields.payload)!
        sent.push({
          frameSeq: m!.header.sequence,
          seq: op.seq,
          session: op.session,
          opcode: op.opcode,
          size: op.size,
          reqOpcode: op.reqOpcode,
          burstComplete: op.burstComplete,
          offset: op.offset,
          payload: Array.from(op.payload)
        })
      }
    },
    systemClock
  )
  ftp.targetSystem = 42
  ftp.targetComponent = 1
  const norm = (o: FtpOutcome<unknown>): unknown =>
    o.kind === 'failed' ? null : o.value instanceof Uint8Array ? Array.from(o.value) : o.value
  return {
    sent,
    getFile: (path, options, onDone) => ftp.getFile(path, (o) => onDone(norm(o)), options),
    putFile: (path, data, onDone) => ftp.putFile(path, data, (o) => onDone(norm(o))),
    resetSessions: (onDone) => ftp.resetSessions((o) => onDone(norm(o))),
    cancel: () => ftp.cancel(),
    deliver: (src, target, body) =>
      ftp.handleMessage({
        name: 'FILE_TRANSFER_PROTOCOL',
        header: { systemId: src[0], componentId: src[1] },
        fields: { targetSystem: target[0], targetComponent: target[1], payload: body }
      }),
    setSeq: (seq) => (ftp.seq = seq)
  }
}

/**
 * Runs one seeded scenario against a side and returns the full transcript. The simulated vehicle
 * answers queued requests with drops, duplicates, stale/foreign replies, short data and NACKs.
 */
function run(side: Side, seed: number): unknown[] {
  const random = rng(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const log: unknown[] = []
  const fileSize = pick([0, 1, 3, 80, 81, 160, 239, 240, 400, 900, 2048])
  const file = Uint8Array.from({ length: fileSize }, (_, i) => (i * 7 + seed) & 255)
  const lossy = random() < 0.3 ? 0 : 0.25
  let server = 0
  const nextServerSeq = (req: Packet): number => (random() < 0.85 ? (req.seq + 1) & 65535 : (server = (server + 1) & 65535))

  const reply = (
    req: Packet,
    payload: ArrayLike<number>,
    opts: { nack?: boolean; offset?: number; seq?: number; complete?: number } = {}
  ) => {
    const bytes = Uint8Array.from(payload)
    const body = packOp(
      opts.seq ?? (req.seq + 1) & 65535,
      req.session,
      opts.nack === true ? FtpOp.Nack : FtpOp.Ack,
      bytes.length,
      req.opcode,
      opts.complete ?? 0,
      opts.offset ?? req.offset,
      bytes
    )
    // Occasionally from the wrong component or to the wrong target.
    const r = random()
    const src: [number, number] = r < 0.03 ? [41, 1] : [42, 1]
    const target: [number, number] = r > 0.97 ? [255, 191] : [255, 190]
    log.push(['rx', side.deliver(src, target, body)])
    if (random() < 0.05) log.push(['dup', side.deliver(src, target, body)])
  }

  const respond = (req: Packet): void => {
    if (random() < lossy) return
    const sizeBytes = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
    switch (req.opcode) {
      case FtpOp.OpenFileRO:
        if (random() < 0.05) reply(req, [10], { nack: true })
        else reply(req, sizeBytes(random() < 0.2 ? Math.max(0, fileSize + pick([-50, -1, 1, 70])) : fileSize))
        break
      case FtpOp.BurstReadFile: {
        let seq = (req.seq + 1) & 65535
        for (let offset = req.offset; offset < fileSize; offset += 80) {
          const last = offset + 80 >= fileSize
          if (random() > lossy) reply(req, file.subarray(offset, offset + 80), { offset, seq, complete: last ? 1 : 0 })
          seq = (seq + 1) & 65535
          if (random() < 0.1) break
        }
        if (random() < 0.7) reply(req, random() < 0.05 ? [1] : [6], { nack: true, offset: fileSize, seq, complete: 1 })
        break
      }
      case FtpOp.ReadFile: {
        if (random() < 0.03) reply(req, [6], { nack: true })
        else {
          const r = random()
          const size = r < 0.15 ? Math.floor(req.size / 2) : r < 0.2 ? req.size + 10 : req.size
          reply(req, file.subarray(req.offset, req.offset + size), { seq: nextServerSeq(req) })
        }
        break
      }
      case FtpOp.CreateFile:
      case FtpOp.WriteFile:
      case FtpOp.TerminateSession:
      case FtpOp.ResetSessions:
        if (random() < 0.03) reply(req, [1], { nack: true })
        else reply(req, [], random() < 0.05 ? { offset: req.offset + 1 } : {})
        break
      default:
        throw new Error(`unexpected opcode ${req.opcode}`)
    }
  }

  const done =
    (label: string) =>
    (r: unknown): void => {
      log.push(['done', label, r])
    }
  const start = (n: number): void => {
    const op = random()
    if (op < 0.6) {
      const virtual = random() < 0.3
      side.getFile(`file${n}`, virtual ? { sizeIsEstimate: true, fixedReadSize: random() < 0.7 } : {}, done(`get${n}`))
    } else if (op < 0.85) {
      side.putFile(`up${n}`, file.slice(0, pick([0, 1, 239, 240, 500])), done(`put${n}`))
    } else side.resetSessions(done(`reset${n}`))
  }

  if (random() < 0.3) side.setSeq(65530 + Math.floor(random() * 6))
  start(0)
  let transfers = 1
  for (let step = 0; step < 400; step++) {
    const action = random()
    if (action < 0.7 && side.sent.length) {
      const req = side.sent.shift()!
      log.push(['tx', req])
      respond(req)
    } else if (action < 0.97) {
      vi.advanceTimersByTime(pick([250, 500, 1000, 3000]))
    } else if (action < 0.985) {
      side.cancel()
      log.push(['cancel'])
    } else if (transfers < 4) {
      start(transfers++)
    }
  }
  log.push(['tail', side.sent.splice(0)])
  side.cancel()
  return log
}

describe('MavFtpClient vs upstream MAVFTP (seeded lossy vehicle)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  for (let seed = 1; seed <= 150; seed++) {
    it(`seed ${seed}: identical requests, replies accepted and outcomes`, () => {
      vi.useFakeTimers({ now: 1000 })
      const theirs = run(upstreamSide(), seed)
      vi.useRealTimers()
      vi.useFakeTimers({ now: 1000 })
      const ours = run(portSide(), seed)
      expect(ours).toEqual(theirs)
    })
  }
})
