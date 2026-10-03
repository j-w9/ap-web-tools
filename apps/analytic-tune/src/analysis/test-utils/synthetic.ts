// Test-only: synthetic system identification logs (SIDS/SIDD runs with RATE, ATT or ANG, and SIDP
// for fixed wing), with a crude plant so every spectrum is non-degenerate.
import { LogWriter } from '@apwt/dataflash/testing'
import { rng } from './random.js'

export type SyntheticVehicle = 'copter' | 'quadplane' | 'fixed-wing'

export interface SyntheticRun {
  /** SID_AXIS. */
  readonly axis: number
  /** Start time (s). */
  readonly start: number
  /** Chirp length (s). */
  readonly length: number
}

export interface SyntheticLogOptions {
  readonly vehicle: SyntheticVehicle
  readonly runs: readonly SyntheticRun[]
  readonly params: Readonly<Record<string, number>>
  /** Log attitude in ANG instead of ATT. */
  readonly ang?: boolean
  readonly seed?: number
}

const RATE_HZ = 400
const ATT_HZ = 400

export function buildSidLog(options: SyntheticLogOptions): Uint8Array {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x82, 'MSG', 'QZ', 'TimeUS,Message')
  w.defineFormat(0x83, 'SIDS', 'QBfffffff', 'TimeUS,Ax,Mag,FSt,FSp,TFin,TC,TR,TFout')
  w.defineFormat(0x84, 'SIDD', 'Qfffffffff', 'TimeUS,Time,Targ,F,Gx,Gy,Gz,Ax,Ay,Az')
  w.defineFormat(0x85, 'RATE', 'Qffffffffffff', 'TimeUS,RDes,R,ROut,PDes,P,POut,YDes,Y,YOut,ADes,A,AOut')
  const attName = options.ang === true ? 'ANG' : 'ATT'
  w.defineFormat(0x86, attName, 'Qffffff', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw')
  w.defineFormat(0x87, 'SIDP', 'Qfffffffffff', 'TimeUS,Aile,Elev,Rudd,rdes,pdes,DRll,Rll,DPit,Pit,aspd,eastas')

  const banner = options.vehicle === 'copter' ? 'ArduCopter V4.6.3 (abcdef12)' : 'ArduPlane V4.6.3 (abcdef12)'
  w.write('MSG', [1000, banner])
  let t = 2000
  for (const [name, value] of Object.entries(options.params)) w.write('PARM', [t++, name, value, value, 0])

  const next = rng(options.seed ?? 11)
  const noise = (scale: number) => (next() - 0.5) * scale
  const end = Math.max(...options.runs.map((r) => r.start + r.length)) + 3
  const dt = 1 / RATE_HZ
  const rate = [0, 0, 0]
  const angle = [0, 0, 0]
  for (let k = 0; k * dt < end; k++) {
    const time = 1 + k * dt
    const timeUs = Math.round(time * 1e6)
    const run = options.runs.find((r) => time >= r.start && time < r.start + r.length)
    let targ = 0
    let excited = -1
    if (run !== undefined) {
      if (Math.abs(time - run.start) < dt / 2) {
        w.write('SIDS', [timeUs, run.axis, 10, 0.5, 40, 0, 0, run.length, 0])
      }
      const tau = time - run.start
      const f = 0.5 + ((40 - 0.5) * tau) / run.length
      targ = 10 * Math.sin(2 * Math.PI * f * tau)
      excited = (run.axis - 1) % 3
    }
    const out = [0, 0, 0]
    const des = [0, 0, 0]
    for (let a = 0; a < 3; a++) {
      const drive = a === excited ? targ : 0
      const d = drive * 3 + noise(0.5)
      const o = (d - rate[a]!) * 0.004 + noise(0.002)
      const r = rate[a]! * 0.92 + o * 15 + noise(1)
      des[a] = d
      out[a] = o
      rate[a] = r
      angle[a] = angle[a]! + r * dt
    }
    w.write('RATE', [timeUs, des[0]!, rate[0]!, out[0]!, des[1]!, rate[1]!, out[1]!, des[2]!, rate[2]!, out[2]!, 0, 0, 0])
    if (k % (RATE_HZ / ATT_HZ) === 0) {
      w.write(attName, [
        timeUs + 7,
        angle[0]! + noise(0.1),
        angle[0]!,
        angle[1]! + noise(0.1),
        angle[1]!,
        angle[2]! + noise(0.1),
        angle[2]!
      ])
    }
    if (run !== undefined) {
      const g = rate.map((r) => r + noise(0.3))
      w.write('SIDD', [timeUs + 3, time - run.start, targ, 0, g[0]!, g[1]!, g[2]!, 0, 0, -9.8])
      if (options.vehicle === 'fixed-wing') {
        w.write('SIDP', [
          timeUs + 5,
          out[0]! * 100,
          out[1]! * 100,
          out[2]! * 100,
          des[0]!,
          des[1]!,
          angle[0]! + noise(0.2),
          angle[0]!,
          angle[1]! + noise(0.2),
          angle[1]!,
          18 + noise(2),
          1.02 + noise(0.01)
        ])
      }
    }
  }
  return w.toBytes()
}

/** An ArrayBuffer holding exactly the log bytes (the upstream parser wants one). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}
