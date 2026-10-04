// Scripted vehicle for the UI audit (scripts/ui-audit.config.mjs), loaded in the browser by a
// stubbed `WebSocket`: an unsigned ArduPilot copter near CMAC flying a slow circle, sending the
// messages the default layout's widgets show (attitude, speeds, battery, altitudes, position, home,
// navigation target and status text) ten times a second. Never a real vehicle.
import {
  ATTITUDE,
  GLOBAL_POSITION_INT,
  HEARTBEAT,
  HOME_POSITION,
  MavlinkEncoder,
  NAV_CONTROLLER_OUTPUT,
  STATUSTEXT,
  SYS_STATUS,
  VFR_HUD
} from '@apwt/mavlink'

/** The stubbed WebSocket as the peer drives it. */
export interface PeerSocket {
  readonly readyState: number
  _open(): void
  _deliver(bytes: Uint8Array): void
}

export interface Peer {
  receive(data: unknown): void
  stop(): void
}

const LAT = -353632600
const LON = 1491652300
const MESSAGES = [
  [6, 'ArduCopter V4.6.0 (ui-audit)'],
  [6, 'EKF3 IMU0 is using GPS'],
  [6, 'Mission: 1 Takeoff'],
  [4, 'Battery 1 is low 14.10V'],
  [6, 'Reached command #2']
] as const

export function createPeer(socket: PeerSocket): Peer {
  const enc = new MavlinkEncoder({ systemId: 1, componentId: 1 })
  let tick = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const emit = (bytes: Uint8Array): void => {
    if (socket.readyState === 1) socket._deliver(bytes)
  }
  const step = (): void => {
    tick++
    const t = tick / 10
    const yaw = (t / 6) % (2 * Math.PI)
    const speed = 6 + 2 * Math.sin(t / 3)
    if (tick % 10 === 1) {
      emit(enc.encode(HEARTBEAT, { type: 2, autopilot: 3, baseMode: 217, customMode: 3, systemStatus: 4, mavlinkVersion: 3 }))
      emit(
        enc.encode(HOME_POSITION, {
          latitude: LAT,
          longitude: LON,
          altitude: 584000,
          x: 0,
          y: 0,
          z: 0,
          q: [1, 0, 0, 0],
          approachX: 0,
          approachY: 0,
          approachZ: 0,
          timeUsec: 0n
        })
      )
      emit(
        enc.encode(SYS_STATUS, {
          onboardControlSensorsPresent: 0,
          onboardControlSensorsEnabled: 0,
          onboardControlSensorsHealth: 0,
          load: 300,
          voltageBattery: Math.round(15600 - 20 * t),
          currentBattery: Math.round(1850 + 300 * Math.sin(t)),
          batteryRemaining: 68,
          dropRateComm: 0,
          errorsComm: 0,
          errorsCount1: 0,
          errorsCount2: 0,
          errorsCount3: 0,
          errorsCount4: 0
        })
      )
      const message = MESSAGES[Math.floor(tick / 10) % MESSAGES.length]
      if (message !== undefined && tick < 60) emit(enc.encode(STATUSTEXT, { severity: message[0], text: message[1] }))
    }
    emit(
      enc.encode(ATTITUDE, {
        timeBootMs: tick * 100,
        roll: 0.25 * Math.sin(t / 2),
        pitch: -0.08 + 0.05 * Math.cos(t / 2),
        yaw: yaw > Math.PI ? yaw - 2 * Math.PI : yaw,
        rollspeed: 0,
        pitchspeed: 0,
        yawspeed: 0.17
      })
    )
    emit(
      enc.encode(VFR_HUD, {
        airspeed: speed + 1.5 * Math.sin(t),
        groundspeed: speed,
        heading: Math.round((yaw * 180) / Math.PI),
        throttle: 48,
        alt: 614.2,
        climb: 0.1
      })
    )
    emit(
      enc.encode(GLOBAL_POSITION_INT, {
        timeBootMs: tick * 100,
        lat: LAT + Math.round(15000 * Math.sin(t / 6)),
        lon: LON + Math.round(18000 * (1 - Math.cos(t / 6))),
        alt: 614200,
        relativeAlt: 30200,
        vx: 0,
        vy: 0,
        vz: 0,
        hdg: Math.round((yaw * 18000) / Math.PI)
      })
    )
    emit(
      enc.encode(NAV_CONTROLLER_OUTPUT, {
        navRoll: 0,
        navPitch: 0,
        navBearing: 90,
        targetBearing: 90,
        wpDist: 120,
        altError: 0,
        aspdError: 0,
        xtrackError: 0
      })
    )
  }
  setTimeout(() => {
    socket._open()
    timer = setInterval(step, 100)
  }, 30)
  return {
    receive() {
      // Heartbeats from the dashboard need no answer.
    },
    stop() {
      clearInterval(timer)
    }
  }
}
