// Scripted vehicle for the UI audit (scripts/ui-audit.config.mjs), loaded in the browser by a
// stubbed `WebSocket`: an unsigned ArduPilot rover at CMAC sending heartbeat, position, attitude,
// battery, GPS, status text and LTE values every 500 ms, answering commands with COMMAND_ACK and
// serving a fence, a mission and upstream's parameter fixture over MAVFTP. Never a real vehicle.
import {
  ALL_MESSAGES,
  ATTITUDE,
  BATTERY_STATUS,
  COMMAND_ACK,
  FILE_TRANSFER_PROTOCOL,
  GLOBAL_POSITION_INT,
  GPS_RAW_INT,
  HEARTBEAT,
  MavlinkEncoder,
  MavlinkParser,
  NAMED_VALUE_FLOAT,
  STATUSTEXT,
  SYS_STATUS
} from '@apwt/mavlink'
import { packOp, parseOp } from '../ftp/protocol.js'

/** The stubbed WebSocket as the peer drives it. */
export interface PeerSocket {
  readonly readyState: number
  /** Marks the socket open and fires `open`. */
  _open(): void
  /** Fires `message` with these bytes. */
  _deliver(bytes: Uint8Array): void
}

export interface Peer {
  receive(data: ArrayBuffer | ArrayBufferView): void
  stop(): void
}

const LAT = -353632600
const LON = 1491652300
const MAGIC = 0x763d
const ITEM = 38

/** A mission-format file (upstream `MissionParser`): 10-byte header, then MISSION_ITEM_INT items. */
function missionFile(type: number, items: readonly { command: number; lat: number; lon: number; p1?: number }[]): Uint8Array {
  const bytes = new Uint8Array(10 + ITEM * items.length)
  const v = new DataView(bytes.buffer)
  v.setUint16(0, MAGIC, true)
  v.setUint16(2, type, true)
  v.setUint16(8, items.length, true)
  items.forEach((item, seq) => {
    const o = 10 + ITEM * seq
    v.setFloat32(o, item.p1 ?? 0, true)
    v.setInt32(o + 16, item.lat, true)
    v.setInt32(o + 20, item.lon, true)
    v.setFloat32(o + 24, 0, true)
    v.setUint16(o + 28, seq, true)
    v.setUint16(o + 30, item.command, true)
    bytes[o + 34] = 0
    bytes[o + 36] = 1
    bytes[o + 37] = type
  })
  return bytes
}

const FENCE = missionFile(1, [
  { command: 5003, lat: LAT, lon: LON, p1: 180 },
  { command: 5004, lat: LAT + 6000, lon: LON + 9000, p1: 25 }
])
const MISSION = missionFile(0, [
  { command: 16, lat: LAT, lon: LON },
  { command: 16, lat: LAT + 8000, lon: LON - 6000 },
  { command: 16, lat: LAT + 9000, lon: LON + 7000 },
  { command: 16, lat: LAT - 5000, lon: LON + 9000 },
  { command: 20, lat: 0, lon: 0 }
])

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}

export function createPeer(socket: PeerSocket): Peer {
  const enc = new MavlinkEncoder({ systemId: 1, componentId: 1 })
  const parser = new MavlinkParser({ messages: ALL_MESSAGES })
  let params: Uint8Array = new Uint8Array(0)
  void fetch('/upstream/tests/fixtures/params.json')
    .then((r) => r.json() as Promise<{ hex: string }>)
    .then((j) => (params = hexBytes(j.hex)))
  let armed = false
  let mode = 4
  let tick = 0
  let ftpPath = ''
  let timer: ReturnType<typeof setInterval> | undefined

  const emit = (bytes: Uint8Array): void => {
    if (socket.readyState === 1) socket._deliver(bytes)
  }

  const telemetry = (): void => {
    tick++
    const heading = (tick * 3) % 360
    emit(
      enc.encode(HEARTBEAT, {
        type: 10,
        autopilot: 3,
        baseMode: armed ? 217 : 89,
        customMode: mode,
        systemStatus: 4,
        mavlinkVersion: 3
      })
    )
    emit(
      enc.encode(GLOBAL_POSITION_INT, {
        timeBootMs: tick * 500,
        lat: LAT + Math.round(3000 * Math.sin(tick / 20)),
        lon: LON + Math.round(3000 * Math.cos(tick / 20)),
        alt: 584000,
        relativeAlt: 0,
        vx: 180,
        vy: 60,
        vz: 0,
        hdg: heading * 100
      })
    )
    emit(
      enc.encode(ATTITUDE, {
        timeBootMs: tick * 500,
        roll: 0,
        pitch: 0,
        yaw: (heading * Math.PI) / 180,
        rollspeed: 0,
        pitchspeed: 0,
        yawspeed: 0
      })
    )
    emit(
      enc.encode(BATTERY_STATUS, {
        id: 0,
        batteryFunction: 0,
        type: 0,
        temperature: 32767,
        voltages: [12400, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
        currentBattery: 420,
        currentConsumed: 300,
        energyConsumed: -1,
        batteryRemaining: 72
      })
    )
    emit(
      enc.encode(GPS_RAW_INT, {
        timeUsec: BigInt(tick) * 500000n,
        fixType: 3,
        lat: LAT,
        lon: LON,
        alt: 584000,
        eph: 90,
        epv: 120,
        vel: 190,
        cog: heading * 100,
        satellitesVisible: 21
      })
    )
    emit(
      enc.encode(SYS_STATUS, {
        onboardControlSensorsPresent: 0x100000,
        onboardControlSensorsEnabled: 0x100000,
        onboardControlSensorsHealth: 0x100000,
        load: 300,
        voltageBattery: 12400,
        currentBattery: 420,
        batteryRemaining: 72,
        dropRateComm: 0,
        errorsComm: 0,
        errorsCount1: 0,
        errorsCount2: 0,
        errorsCount3: 0,
        errorsCount4: 0
      })
    )
    emit(enc.encode(NAMED_VALUE_FLOAT, { timeBootMs: tick * 500, name: 'LTE_MCCMNC', value: 50501 }))
    emit(enc.encode(NAMED_VALUE_FLOAT, { timeBootMs: tick * 500, name: 'LTE_RSRP', value: -94 }))
    if (tick === 2) {
      emit(enc.encode(STATUSTEXT, { severity: 6, text: 'ArduRover V4.6.0 (ui-audit)' }))
      emit(enc.encode(STATUSTEXT, { severity: 6, text: 'EKF3 IMU0 is using GPS' }))
      emit(enc.encode(STATUSTEXT, { severity: 4, text: 'PreArm: Battery 1 low voltage failsafe' }))
    }
  }

  const ftp = (raw: Uint8Array, toSystem: number, toComponent: number): void => {
    const req = parseOp(raw)
    if (req === null) return
    if (req.opcode === 2) ftpPath = ''
    if (req.opcode === 4) ftpPath = new TextDecoder().decode(req.payload).replace(/\0.*$/, '')
    const isParam = ftpPath.startsWith('@PARAM/')
    const bytes = isParam ? params : ftpPath === '@MISSION/mission.dat' ? MISSION : FENCE
    let payload: Uint8Array = new Uint8Array(0)
    if (req.opcode === 4) {
      payload = new Uint8Array(4)
      new DataView(payload.buffer).setUint32(0, bytes.length + (isParam ? 128 : 0), true)
    }
    if (req.opcode === 15 || req.opcode === 5) payload = bytes.slice(req.offset, req.offset + 80)
    const eof = (req.opcode === 15 || req.opcode === 5) && req.offset >= bytes.length
    if (eof) payload = Uint8Array.of(6)
    const body = packOp((req.seq + 1) & 65535, req.session, eof ? 129 : 128, payload.length, req.opcode, 1, req.offset, payload)
    setTimeout(() => {
      emit(
        enc.encode(FILE_TRANSFER_PROTOCOL, {
          targetNetwork: 0,
          targetSystem: toSystem,
          targetComponent: toComponent,
          payload: body
        })
      )
    }, 5)
  }

  setTimeout(() => {
    socket._open()
    telemetry()
    timer = setInterval(telemetry, 500)
  }, 30)

  return {
    receive(data) {
      const bytes =
        data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      for (const msg of parser.push(bytes)) {
        if (msg.name === 'COMMAND_INT' || msg.name === 'COMMAND_LONG') {
          const f = msg.fields
          if (f.command === 400) armed = f.param1 === 1
          if (f.command === 176) mode = f.param2
          emit(
            enc.encode(COMMAND_ACK, {
              command: f.command,
              result: 0,
              progress: 0,
              resultParam2: 0,
              targetSystem: msg.header.systemId,
              targetComponent: msg.header.componentId
            })
          )
        }
        if (msg.name === 'FILE_TRANSFER_PROTOCOL') ftp(msg.fields.payload, msg.header.systemId, msg.header.componentId)
      }
    },
    stop() {
      clearInterval(timer)
    }
  }
}
