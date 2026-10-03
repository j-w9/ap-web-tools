// Deterministic simulated vehicle behind a fake WebSocket, modelled on the init script of upstream
// tests/browser.cjs: signed telemetry every 500 ms, COMMAND_ACKs, and MAVFTP replies serving a
// one-circle fence, a one-waypoint mission and the parameter fixture.
import {
  ALL_MESSAGES,
  COMMAND_ACK,
  FILE_TRANSFER_PROTOCOL,
  GLOBAL_POSITION_INT,
  HEARTBEAT,
  MavlinkEncoder,
  MavlinkParser,
  MavlinkSigning,
  POSITION_TARGET_GLOBAL_INT,
  signingKeyFromPassphrase,
  type ReceivedMessage
} from '@apwt/mavlink'
import type { Timer } from '../clock.js'
import { packOp, parseOp } from '../ftp/protocol.js'
import type { LockRequester } from '../link/leases.js'
import type { LinkSocket, SocketFactory, SocketHandlers } from '../link/socket.js'
import { decodeParams } from '../params/packed.js'
import type { FakeClock } from './fake-clock.js'
import { paramsFixture } from './upstream.js'

type SocketState = 0 | 1 | 2 | 3

export interface VehicleState {
  sent: ReceivedMessage[]
  sockets: FakeSocket[]
  armed: boolean
  mode: number
  reject: boolean
  noAck: boolean
  passphrase: string
  vehicleSystem: number
  silent: boolean
  holdTelemetry: boolean
  hangClose: boolean
  rejectSocket: boolean
  target: { x: number; y: number } | null
  closeCodes: number[]
  lastHeartbeatPacket: Uint8Array | null
  paramBytes: Uint8Array
}

export class FakeSocket implements LinkSocket {
  readyState: SocketState = 0
  private handlers: SocketHandlers | null
  private timer: Timer | null = null
  private encoder: MavlinkEncoder | null = null
  private parser: MavlinkParser | null = null
  private ftpPath = ''
  private upload: Uint8Array | null = null

  constructor(
    readonly url: string,
    handlers: SocketHandlers,
    private readonly state: VehicleState,
    private readonly clock: FakeClock
  ) {
    this.handlers = handlers
    clock.after(25, () => {
      if (this.readyState === 3) return
      const signing = new MavlinkSigning({
        secretKey: signingKeyFromPassphrase(state.passphrase),
        timestamp: Math.floor((clock.now() - Date.UTC(2015, 0, 1)) * 100)
      })
      this.encoder = new MavlinkEncoder({ systemId: state.vehicleSystem, componentId: 1, signing })
      this.parser = new MavlinkParser({ messages: ALL_MESSAGES, signing })
      this.readyState = 1
      this.handlers?.open()
      this.telemetry()
      this.timer = clock.every(500, () => this.telemetry())
    })
  }

  get isOpen(): boolean {
    return this.readyState === 1
  }

  /** Delivers raw bytes as if received (e.g. a replayed packet). */
  deliver(bytes: Uint8Array): void {
    this.handlers?.message(bytes)
  }

  /** The socket's current close handler, to fire it late. */
  closeHandler(): ((code: number, reason: string) => void) | null {
    const h = this.handlers
    return h === null ? null : (code, reason) => h.close(code, reason)
  }

  private emit(frame: Uint8Array, heartbeat = false): void {
    if (heartbeat) this.state.lastHeartbeatPacket = frame
    this.handlers?.message(frame)
  }

  telemetry(): void {
    const enc = this.encoder
    if (this.readyState !== 1 || this.state.holdTelemetry || enc === null) return
    if (this.state.silent) {
      const foreign = new MavlinkEncoder({ systemId: 99, componentId: 1 })
      this.emit(
        foreign.encode(HEARTBEAT, { type: 6, autopilot: 8, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
      )
      return
    }
    this.emit(
      enc.encode(HEARTBEAT, {
        type: 11,
        autopilot: 3,
        baseMode: this.state.armed ? 137 : 9,
        customMode: this.state.mode,
        systemStatus: 4,
        mavlinkVersion: 3
      }),
      true
    )
    this.emit(
      enc.encode(GLOBAL_POSITION_INT, {
        timeBootMs: 1000,
        lat: -350000000,
        lon: 1490000000,
        alt: 500000,
        relativeAlt: 0,
        vx: 100,
        vy: 0,
        vz: 0,
        hdg: 9000
      })
    )
    const t = this.state.target
    if (t !== null) {
      this.emit(
        enc.encode(POSITION_TARGET_GLOBAL_INT, {
          timeBootMs: 1000,
          coordinateFrame: 0,
          typeMask: 65016,
          latInt: t.x,
          lonInt: t.y,
          alt: 500,
          vx: 0,
          vy: 0,
          vz: 0,
          afx: 0,
          afy: 0,
          afz: 0,
          yaw: 0,
          yawRate: 0
        })
      )
    }
  }

  send(bytes: Uint8Array): void {
    const parser = this.parser
    const enc = this.encoder
    if (parser === null || enc === null) throw new Error('not open')
    for (const msg of parser.push(bytes)) {
      this.state.sent.push(msg)
      if (msg.name === 'COMMAND_INT') {
        const f = msg.fields
        if (!this.state.reject) {
          if (f.command === 400) this.state.armed = f.param1 === 1
          if (f.command === 176) this.state.mode = f.param2
          if (f.command === 192) {
            this.state.mode = 15
            this.state.target = { x: f.x, y: f.y }
          }
        }
        if (!this.state.noAck)
          this.emit(
            enc.encode(COMMAND_ACK, {
              command: f.command,
              result: this.state.reject ? 2 : 0,
              progress: 0,
              resultParam2: 0,
              targetSystem: msg.header.systemId,
              targetComponent: msg.header.componentId
            })
          )
        this.telemetry()
      }
      if (msg.name === 'FILE_TRANSFER_PROTOCOL') this.ftp(msg.fields.payload, msg.header.systemId, msg.header.componentId)
    }
  }

  private ftp(raw: Uint8Array, toSystem: number, toComponent: number): void {
    const req = parseOp(raw)
    if (req === null) return
    if (req.opcode === 2) this.ftpPath = ''
    if (req.opcode === 4 || req.opcode === 6) this.ftpPath = new TextDecoder().decode(req.payload).replace(/\0.*$/, '')
    let bytes: Uint8Array = new Uint8Array(48)
    const v = new DataView(bytes.buffer)
    v.setUint16(0, 0x763d, true)
    v.setUint16(2, 1, true)
    v.setUint16(8, 1, true)
    v.setFloat32(10, 50, true)
    v.setInt32(26, -350000000, true)
    v.setInt32(30, 1490000000, true)
    v.setUint16(40, 5003, true)
    bytes[47] = 1
    if (this.ftpPath === '@MISSION/mission.dat') {
      v.setUint16(2, 0, true)
      v.setUint16(40, 16, true)
    }
    const isParam = this.ftpPath.startsWith('@PARAM/')
    if (isParam) bytes = this.state.paramBytes
    if (req.opcode === 6) this.upload = new Uint8Array(65535)
    if (req.opcode === 7) this.upload?.set(req.payload, req.offset)
    if (req.opcode === 1 && this.upload !== null) {
      const header = new DataView(this.upload.buffer)
      const packed = this.upload.slice(0, header.getUint16(4, true))
      new DataView(packed.buffer).setUint16(4, header.getUint16(2, true), true)
      const offsets = paramsFixture().offsets
      const view = new DataView(this.state.paramBytes.buffer)
      for (const p of decodeParams(packed).values()) {
        const { type, offset } = offsets[p.name]!
        if (type === 1) view.setInt8(offset, p.value)
        else if (type === 2) view.setInt16(offset, p.value, true)
        else if (type === 3) view.setInt32(offset, p.value, true)
        else view.setFloat32(offset, p.value, true)
      }
      this.upload = null
    }
    let payload: Uint8Array = new Uint8Array(0)
    if (req.opcode === 4) {
      payload = new Uint8Array(4)
      new DataView(payload.buffer).setUint32(0, bytes.length + (isParam ? 128 : 0), true)
    }
    if (req.opcode === 15 || req.opcode === 5) payload = bytes.slice(req.offset, req.offset + 80)
    const eof = (req.opcode === 15 || req.opcode === 5) && req.offset >= bytes.length
    if (eof) payload = Uint8Array.of(6)
    const body = packOp((req.seq + 1) & 65535, req.session, eof ? 129 : 128, payload.length, req.opcode, 1, req.offset, payload)
    this.clock.after(0, () => {
      if (this.readyState === 1 && this.encoder !== null) {
        this.emit(
          this.encoder.encode(FILE_TRANSFER_PROTOCOL, {
            targetNetwork: 0,
            targetSystem: toSystem,
            targetComponent: toComponent,
            payload: body
          })
        )
      }
    })
  }

  /** Server-initiated close (the vehicle side drops the connection). */
  serverClose(): void {
    this.timer?.cancel()
    this.readyState = 3
    const h = this.handlers
    this.clock.after(0, () => h?.close(1000, ''))
  }

  close(code: number): void {
    if (code !== 1000 && (code < 3000 || code > 4999)) throw new DOMException('Invalid close code', 'InvalidAccessError')
    this.state.closeCodes.push(code)
    this.timer?.cancel()
    if (this.state.hangClose) {
      this.readyState = 2
      return
    }
    this.readyState = 3
    const h = this.handlers
    this.clock.after(0, () => h?.close(1000, ''))
  }

  detach(): void {
    // Upstream nulls the handlers; a hung socket keeps them reachable only through `closeHandler`.
    if (!this.state.hangClose) this.handlers = null
  }
}

export function fakeVehicle(clock: FakeClock) {
  const state: VehicleState = {
    sent: [],
    sockets: [],
    armed: false,
    mode: 0,
    reject: false,
    noAck: false,
    passphrase: 'test-signing',
    vehicleSystem: 42,
    silent: false,
    holdTelemetry: false,
    hangClose: false,
    rejectSocket: false,
    target: null,
    closeCodes: [],
    lastHeartbeatPacket: null,
    paramBytes: Uint8Array.from(Buffer.from(paramsFixture().hex, 'hex'))
  }
  const openSocket: SocketFactory = (url, handlers) => {
    if (state.rejectSocket) throw new DOMException('Connection blocked by browser', 'SecurityError')
    const socket = new FakeSocket(url, handlers, state, clock)
    state.sockets.push(socket)
    return socket
  }
  return { state, openSocket }
}

/** Web Locks stand-in shared by several sessions ("tabs"). */
export function fakeLocks(): LockRequester & { readonly held: Set<string> } {
  const held = new Set<string>()
  return {
    held,
    request(name, _options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null))
      held.add(name)
      const result = callback({ name })
      return Promise.resolve(result).finally(() => held.delete(name))
    }
  }
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}
