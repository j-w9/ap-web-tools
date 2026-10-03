// Synthetic DataFlash logs for the MAGFit proofs. The magnetic field each compass logs is the
// earth field at the log's location rotated into the body frame by the logged attitude, computed
// with upstream's own wmm.js and quaternion code (run in a separate vm context), so upstream's fits
// on these logs are well conditioned and valid unless a test makes them otherwise.
import { LogWriter } from '@apwt/dataflash/testing'
import { createUpstreamMagfit } from './_harness.js'

/** Location of the synthetic flight (Canberra). */
export const LAT = -35.3632621
/** Longitude of the synthetic flight. */
export const LON = 149.1652374

export interface MagLogOptions {
  /** Seconds of data at 10 Hz (default 60). */
  readonly duration?: number
  /** MAG instances to write (default [0, 1]). */
  readonly compasses?: readonly number[]
  /** Per instance: microseconds added to its sample times (default 0). */
  readonly magOffsetUs?: readonly number[]
  /** Per instance: write only every n-th sample (default 1). */
  readonly magEvery?: readonly number[]
  /** Write BAT current (default true). */
  readonly battery?: boolean
  /** Location records: ORGN (default), a POS format with no records, or nothing. */
  readonly location?: 'orgn' | 'empty-pos' | 'none'
  /** Parameters to leave out. */
  readonly omitParams?: readonly string[]
  /** Hold the attitude constant from this fraction of the log on (default: never). */
  readonly holdAttitudeFrom?: number
  /** Attitude sample indices whose quaternion is logged as NaN. */
  readonly nanAttitude?: readonly number[]
}

/** Quaternion [q1 (w), q2, q3, q4] from roll, pitch, yaw (rad), ZYX order. */
function quatFromEuler(roll: number, pitch: number, yaw: number): [number, number, number, number] {
  const cr = Math.cos(roll / 2)
  const sr = Math.sin(roll / 2)
  const cp = Math.cos(pitch / 2)
  const sp = Math.sin(pitch / 2)
  const cy = Math.cos(yaw / 2)
  const sy = Math.sin(yaw / 2)
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy]
}

/** Battery current at time `t` (s). */
export function currentAt(t: number): number {
  return 20 + 15 * Math.sin(t * 0.13) + 5 * Math.sin(t * 0.71)
}

/** Build the log bytes. */
export async function buildMagLog(options: MagLogOptions = {}): Promise<ArrayBuffer> {
  const duration = options.duration ?? 60
  const compasses = options.compasses ?? [0, 1]
  const omit = new Set(options.omitParams ?? [])
  const nan = new Set(options.nanAttitude ?? [])
  const rate = 10
  const n = Math.floor(duration * rate)
  const hold = Math.floor(n * (options.holdAttitudeFrom ?? 2))
  const t0 = 1_000_000

  // Attitude at each sample, held constant from `hold` on.
  const quats: [number, number, number, number][] = []
  for (let k = 0; k < n; k++) {
    const t = Math.min(k, hold) / rate
    quats.push(quatFromEuler(1.2 * Math.sin(t * 0.21) + 0.6 * Math.sin(t * 0.83), 0.9 * Math.sin(t * 0.17 + 1), t * 0.35))
  }

  // Body frame earth field from upstream's own code.
  const calc = await createUpstreamMagfit()
  Reflect.set(calc.context, '__q', {
    q1: quats.map((q) => q[0]),
    q2: quats.map((q) => q[1]),
    q3: quats.map((q) => q[2]),
    q4: quats.map((q) => q[3])
  })
  const body = calc.evaluate<{ x: number[]; y: number[]; z: number[] }>(
    `earth_field = expected_earth_field_lat_lon(${LAT}, ${LON}); get_body_frame_ef(__q)`
  )

  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(0x82, 'UNIT', 'QbZ', 'TimeUS,Id,Label')
  w.defineFormat(0x84, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x90, 'MAG', 'QBhhhhhhhhhBI', 'TimeUS,I,MagX,MagY,MagZ,OfsX,OfsY,OfsZ,MOX,MOY,MOZ,Health,S')
  w.defineFormat(0x92, 'AHR2', 'Qffff', 'TimeUS,Q1,Q2,Q3,Q4')
  w.defineFormat(0x93, 'ORGN', 'QBLLe', 'TimeUS,Type,Lat,Lng,Alt')
  w.defineFormat(0x94, 'BAT', 'QBff', 'TimeUS,Inst,Volt,Curr')

  for (const [id, label] of [
    ['s', 's'],
    ['#', 'instance']
  ] as const) {
    w.write('UNIT', [t0, id.charCodeAt(0), label])
  }
  w.write('FMTU', [t0, 0x90, 's#-----------', '-------------'])
  w.write('FMTU', [t0, 0x93, 's#---', '-----'])
  w.write('FMTU', [t0, 0x94, 's#--', '----'])

  const param = (name: string, value: number): void => {
    if (!omit.has(name)) w.write('PARM', [t0, name, value, value, 0])
  }
  param('AHRS_EKF_TYPE', 0)
  param('COMPASS_MOTCT', 0)
  const offsets = [
    [30, -20, 40],
    [-60, 25, 10],
    [5, 15, -25]
  ]
  for (let i = 0; i < 3; i++) {
    const s = i === 0 ? '' : String(i + 1)
    param('COMPASS_USE' + s, 1)
    param(i === 0 ? 'COMPASS_EXTERNAL' : 'COMPASS_EXTERN' + s, 0)
    param('COMPASS_ORIENT' + s, 0)
    param('COMPASS_DEV_ID' + s, 97539 + i)
    param('COMPASS_SCALE' + s, 1)
    ;['X', 'Y', 'Z'].forEach((a, k) => {
      param(`COMPASS_OFS${s}_${a}`, offsets[i]![k]!)
      param(`COMPASS_DIA${s}_${a}`, 1)
      param(`COMPASS_ODI${s}_${a}`, 0)
      param(`COMPASS_MOT${s}_${a}`, 0)
    })
  }

  const location = options.location ?? 'orgn'
  // A POS format (Lat, Lng columns) that is never written.
  if (location === 'empty-pos') w.defineFormat(0x95, 'POS', 'QLLe', 'TimeUS,Lat,Lng,Alt')
  if (location === 'orgn') w.write('ORGN', [t0 + 10, 0, Math.round(LAT * 1e7), Math.round(LON * 1e7), 584])

  let seed = 7
  const noise = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return (seed / 2147483648 - 0.5) * 4
  }
  for (let k = 0; k < n; k++) {
    const t = t0 + 100_000 + k * 100_000
    const q = nan.has(k) ? [NaN, NaN, NaN, NaN] : quats[k]!
    w.write('AHR2', [t - 20_000, q[0]!, q[1]!, q[2]!, q[3]!])
    if (options.battery ?? true) w.write('BAT', [t - 10_000, 0, 16, currentAt(t * 1e-6)])
    for (const i of compasses) {
      if (k % (options.magEvery?.[i] ?? 1) !== 0) continue
      const o = offsets[i]!
      // Logged field = body field + existing offsets (raw sensor reading has no error).
      w.write('MAG', [
        t + (options.magOffsetUs?.[i] ?? 0),
        i,
        Math.round(body.x[k]! + o[0]! + noise()),
        Math.round(body.y[k]! + o[1]! + noise()),
        Math.round(body.z[k]! + o[2]! + noise()),
        o[0]!,
        o[1]!,
        o[2]!,
        0,
        0,
        0,
        1,
        0
      ])
    }
  }
  const bytes = w.toBytes()
  const out = new Uint8Array(bytes.byteLength)
  out.set(bytes)
  return out.buffer
}
