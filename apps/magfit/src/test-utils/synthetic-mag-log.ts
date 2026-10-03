// Test-only: builds a synthetic DataFlash log with everything MAGFit uses (MAG x3, XKQ, AHR2,
// ORGN, BAT, PARM) from a known compass error model, so the fits have a known answer and both
// the port and upstream can be run on rich, well-covered data.
import { LogWriter } from '@apwt/dataflash/testing'
import { Matrix, inverse } from 'ml-matrix'
import { quatFromEuler, quatInverse, quatRotate } from '../analysis/quaternion.js'
import { rotationQuat } from '../analysis/rotations.js'
import { expectedEarthField } from '../analysis/wmm.js'

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type V3 = [number, number, number]

/** True error model of one compass and the calibration parameters set in the log. */
interface CompassModel {
  external: number
  /** Orientation parameter in the log. */
  orient: number
  /** Actual mounting rotation (external only). */
  trueOrient: number
  trueOffsets: V3
  trueScale: number
  trueDiag: V3
  trueOffDiag: V3
  /** mGauss per amp. */
  trueMotor: V3
  ofs: V3
  dia: V3
  odi: V3
  scale: number
  mot: V3
}

/** Location of the synthetic flight (Canberra, like ArduPilot SITL). */
export const SYNTHETIC_LAT = -35.3632621
/** Longitude of the synthetic flight. */
export const SYNTHETIC_LON = 149.1652374

/** The compass models used by {@link buildSyntheticMagLog}. */
export const SYNTHETIC_COMPASSES: readonly CompassModel[] = [
  // External, mounted yaw 180 but parameter says none; offsets only.
  {
    external: 1,
    orient: 0,
    trueOrient: 4,
    trueOffsets: [80, -40, 120],
    trueScale: 1,
    trueDiag: [1, 1, 1],
    trueOffDiag: [0, 0, 0],
    trueMotor: [0, 0, 0],
    ofs: [10, 10, -10],
    dia: [1, 1, 1],
    odi: [0, 0, 0],
    scale: 1,
    mot: [0, 0, 0]
  },
  // Internal with soft iron, scale and current interference; existing cal offsets only.
  {
    external: 0,
    orient: 0,
    trueOrient: 0,
    trueOffsets: [-150, 60, 30],
    trueScale: 1.04,
    trueDiag: [1.03, 0.97, 1.0],
    trueOffDiag: [0.03, -0.02, 0.01],
    trueMotor: [2.5, -1.5, 4],
    ofs: [-100, 20, 0],
    dia: [1, 1, 1],
    odi: [0, 0, 0],
    scale: 1,
    mot: [0, 0, 0]
  },
  // External, correctly oriented, existing cal with iron, scale and motor that must be removed.
  {
    external: 1,
    orient: 2,
    trueOrient: 2,
    trueOffsets: [20, 35, -60],
    trueScale: 0.96,
    trueDiag: [1, 1, 1],
    trueOffDiag: [0, 0, 0],
    trueMotor: [0, 0, 0],
    ofs: [15, 30, -50],
    dia: [1.02, 0.99, 1.01],
    odi: [0.01, 0.0, -0.01],
    scale: 1.05,
    mot: [0.5, 0.2, -0.3]
  }
]

function iron(d: V3, o: V3): Matrix {
  return new Matrix([
    [d[0], o[0], o[1]],
    [o[0], d[1], o[2]],
    [o[1], o[2], d[2]]
  ])
}

function mul(m: Matrix, v: V3): V3 {
  return [0, 1, 2].map((r) => m.get(r, 0) * v[0] + m.get(r, 1) * v[1] + m.get(r, 2) * v[2]) as V3
}

/** Options for {@link buildSyntheticMagLog}. */
export interface SyntheticOptions {
  /** Seconds of flight. */
  duration?: number
  /** Include BAT current. */
  battery?: boolean
  /** Compass indices to include. */
  compasses?: readonly number[]
  /** Write ORGN records (default true). */
  origin?: boolean
}

/** Build the synthetic log bytes. */
export function buildSyntheticMagLog(options: SyntheticOptions = {}): ArrayBuffer {
  const duration = options.duration ?? 120
  const battery = options.battery ?? true
  const include = options.compasses ?? [0, 1, 2]
  const next = rng(42)
  const noise = (amp: number): number => (next() - 0.5) * 2 * amp

  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(0x82, 'UNIT', 'QbZ', 'TimeUS,Id,Label')
  w.defineFormat(0x83, 'MULT', 'Qbd', 'TimeUS,Id,Mult')
  w.defineFormat(0x84, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x90, 'MAG', 'QBhhhhhhhhhBI', 'TimeUS,I,MagX,MagY,MagZ,OfsX,OfsY,OfsZ,MOX,MOY,MOZ,Health,S')
  w.defineFormat(0x91, 'XKQ', 'QBffff', 'TimeUS,C,Q1,Q2,Q3,Q4')
  w.defineFormat(0x92, 'AHR2', 'Qffff', 'TimeUS,Q1,Q2,Q3,Q4')
  w.defineFormat(0x93, 'ORGN', 'QBLLe', 'TimeUS,Type,Lat,Lng,Alt')
  w.defineFormat(0x94, 'BAT', 'QBff', 'TimeUS,Inst,Volt,Curr')

  const t0 = 1_000_000
  for (const [id, label] of [
    ['-', ''],
    ['s', 's'],
    ['#', 'instance'],
    ['D', 'deglatitude'],
    ['U', 'deglongitude'],
    ['m', 'm'],
    ['v', 'V'],
    ['A', 'A'],
    ['G', 'Gauss']
  ]) {
    w.write('UNIT', [t0, id!.charCodeAt(0), label!])
  }
  for (const [id, m] of [
    ['-', 0],
    ['0', 1],
    ['F', 1e-6],
    ['G', 1e-7],
    ['B', 1e-2]
  ] as const)
    w.write('MULT', [t0, id.charCodeAt(0), m])
  w.write('FMTU', [t0, 0x90, 's#GGGGGGGGG--', 'F-000000000--'])
  w.write('FMTU', [t0, 0x91, 's#----', 'F-0000'])
  w.write('FMTU', [t0, 0x93, 's#DUm', 'F-GGB'])
  w.write('FMTU', [t0, 0x94, 's#vA', 'F-00'])

  const param = (name: string, value: number): void => w.write('PARM', [t0, name, value, value, 0])
  param('AHRS_EKF_TYPE', 3)
  param('EK3_PRIMARY', 0)
  param('COMPASS_MOTCT', 0)
  SYNTHETIC_COMPASSES.forEach((c, i) => {
    const n = i === 0 ? '' : String(i + 1)
    param('COMPASS_USE' + n, 1)
    param(i === 0 ? 'COMPASS_EXTERNAL' : 'COMPASS_EXTERN' + n, c.external)
    param('COMPASS_ORIENT' + n, c.orient)
    param('COMPASS_DEV_ID' + n, 97539 + i)
    param('COMPASS_SCALE' + n, c.scale)
    ;['X', 'Y', 'Z'].forEach((a, k) => {
      param(`COMPASS_OFS${n}_${a}`, c.ofs[k]!)
      param(`COMPASS_DIA${n}_${a}`, c.dia[k]!)
      param(`COMPASS_ODI${n}_${a}`, c.odi[k]!)
      param(`COMPASS_MOT${n}_${a}`, c.mot[k]!)
    })
  })

  if (options.origin ?? true) w.write('ORGN', [t0 + 10, 0, Math.round(SYNTHETIC_LAT * 1e7), Math.round(SYNTHETIC_LON * 1e7), 584])
  if (options.origin ?? true) w.write('ORGN', [t0 + 11, 1, Math.round(SYNTHETIC_LAT * 1e7), Math.round(SYNTHETIC_LON * 1e7), 584])

  const ef = expectedEarthField(SYNTHETIC_LAT, SYNTHETIC_LON)!.vector
  const rate = 10
  const n = Math.floor(duration * rate)
  const attitudeAt = (t: number) =>
    quatFromEuler(
      1.2 * Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.83),
      0.9 * Math.sin(t * 0.17 + 1) + 0.4 * Math.cos(t * 0.61),
      t * 0.35
    )
  const currentAt = (t: number): number => 20 + 15 * Math.sin(t * 0.13) + 5 * Math.sin(t * 0.71)

  for (let k = 0; k < n; k++) {
    const t = t0 + 100_000 + k * 100_000
    const ts = t * 1e-6
    // Attitude logged slightly before the compass so the port must slerp.
    const qa = attitudeAt(ts - 0.03)
    w.write('XKQ', [t - 30_000, 0, qa.q1, qa.q2, qa.q3, qa.q4])
    w.write('XKQ', [t - 29_000, 1, qa.q1, qa.q2, qa.q3, qa.q4])
    if (k % 2 === 0) w.write('AHR2', [t - 20_000, qa.q1, qa.q2, qa.q3, qa.q4])
    const current = currentAt(ts)
    if (battery) w.write('BAT', [t - 10_000, 0, 16.8 - current * 0.01, current])

    const q = attitudeAt(ts)
    const body = quatRotate(quatInverse(q), ef)
    const currentAtMag = currentAt(ts)
    for (const i of include) {
      const c = SYNTHETIC_COMPASSES[i]!
      // True relation: body = M s (R_true sensor + ofs_true) + mot I
      const ms = iron(c.trueDiag, c.trueOffDiag).mul(c.trueScale)
      const corrected: V3 = [0, 1, 2].map((a) => body[a]! - c.trueMotor[a]! * currentAtMag + noise(3)) as V3
      const boardTrue = mul(inverse(ms), corrected).map((v, a) => v - c.trueOffsets[a]!) as V3
      const sensor = c.external ? quatRotate(quatInverse(rotationQuat(c.trueOrient)!), boardTrue) : boardTrue
      // What ArduPilot logs with the parameters in the log
      const board = c.external ? quatRotate(rotationQuat(c.orient)!, sensor) : sensor
      const withOfs = board.map((v, a) => v + c.ofs[a]!) as V3
      const scaled = c.scale <= 1.5 && c.scale >= 1 / 1.5 ? (withOfs.map((v) => v * c.scale) as V3) : withOfs
      const ironed = mul(iron(c.dia, c.odi), scaled)
      const mot = c.mot.map((m) => Math.round(m * currentAtMag)) as V3
      const logged = ironed.map((v, a) => Math.round(v + mot[a]!))
      w.write('MAG', [t, i, logged[0]!, logged[1]!, logged[2]!, c.ofs[0], c.ofs[1], c.ofs[2], mot[0], mot[1], mot[2], 1, 0])
    }
  }
  const bytes = w.toBytes()
  const out = new Uint8Array(bytes.byteLength)
  out.set(bytes)
  return out.buffer
}
