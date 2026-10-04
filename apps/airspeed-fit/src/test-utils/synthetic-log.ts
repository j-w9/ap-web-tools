// Test-only: builds a synthetic plane log with everything AirspeedFit reads (ARSP x2, XKF1/XKF2
// x2 cores, BARO, POS, ATT, STAT, GPS, MSG, PARM) from a known flight, wind and pair of airspeed
// ratios, so the fit has a known answer and both the port and upstream can run on it.
import { LogWriter } from '@apwt/dataflash/testing'

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

export interface SyntheticOptions {
  /** True ARSPD_RATIO of each sensor (one ARSP instance per entry). */
  readonly trueRatios?: readonly number[]
  /** ARSPD_RATIO logged for each sensor. */
  readonly loggedRatios?: readonly number[]
  /** Outside air temperature at the field, deg C (used to generate the airspeed). */
  readonly groundTempC?: number
  /** Seconds of flight. */
  readonly flightSeconds?: number
  /** Airspeed noise amplitude, m/s. */
  readonly noise?: number
  /** Fly a straight line only (wind and ratio unobservable). */
  readonly straight?: boolean
  /** Add a Carbonix `GCS:WX` METAR status text. */
  readonly metar?: boolean
  /** Log BARO without an instance field (as very old firmware did). */
  readonly baroNoInstance?: boolean
  /** Log XKF1 without the VN, VE, VD columns. */
  readonly xkfNoVelocity?: boolean
  /** Log STAT without the isFlying column. */
  readonly statNoFlying?: boolean
}

/** Field elevation of the synthetic flight, m AMSL. */
export const FIELD_ELEVATION = 584
/** Wind at the start of the synthetic flight (north, east), m/s; it drifts slowly. */
export const SYNTHETIC_WIND = [3, -4] as const

const GROUND_BEFORE = 60
const GROUND_AFTER = 40

/** The flight's true airspeed (m/s), heading (rad), climb rate and height at time `t` into the flight. */
function flightState(t: number, straight: boolean): { tas: number; heading: number; vd: number; relAlt: number } {
  const tas = 20 + 3 * Math.sin(t / 37)
  // Alternate loiter circles and straight legs.
  const phase = t % 120
  const heading = straight ? 0.7 : phase < 60 ? (2 * Math.PI * t) / 30 : 1.2 + 0.4 * Math.sin(t / 15)
  const relAlt = 70 - 70 * Math.cos(t / 50)
  const vd = -(70 / 50) * Math.sin(t / 50)
  return { tas, heading, vd, relAlt }
}

/** Build the synthetic log. */
export function buildSyntheticAirspeedLog(options: SyntheticOptions = {}): ArrayBuffer {
  const trueRatios = options.trueRatios ?? [1.9, 2.2]
  const loggedRatios = options.loggedRatios ?? trueRatios.map(() => 2.0)
  const groundTempC = options.groundTempC ?? 20
  const flightSeconds = options.flightSeconds ?? 600
  const noiseAmp = options.noise ?? 0.3
  const straight = options.straight ?? false
  const next = rng(7)
  const noise = (amp: number): number => (next() - 0.5) * 2 * amp

  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(0x82, 'UNIT', 'QbZ', 'TimeUS,Id,Label')
  w.defineFormat(0x83, 'MULT', 'Qbd', 'TimeUS,Id,Mult')
  w.defineFormat(0x84, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x85, 'MSG', 'QZ', 'TimeUS,Message')
  w.defineFormat(0x90, 'ARSP', 'QBffffBBB', 'TimeUS,I,Airspeed,DiffPress,Temp,Offset,U,H,Pri')
  if (options.xkfNoVelocity) w.defineFormat(0x91, 'XKF1', 'QBfff', 'TimeUS,C,Roll,Pitch,Yaw')
  else w.defineFormat(0x91, 'XKF1', 'QBffffff', 'TimeUS,C,Roll,Pitch,Yaw,VN,VE,VD')
  w.defineFormat(0x92, 'XKF2', 'QBff', 'TimeUS,C,VWN,VWE')
  if (options.baroNoInstance) w.defineFormat(0x93, 'BARO', 'Qfff', 'TimeUS,Alt,Press,GndTemp')
  else w.defineFormat(0x93, 'BARO', 'QBfff', 'TimeUS,I,Alt,Press,GndTemp')
  w.defineFormat(0x94, 'POS', 'QLLfff', 'TimeUS,Lat,Lng,Alt,RelHomeAlt,RelOriginAlt')
  w.defineFormat(0x95, 'ATT', 'Qfff', 'TimeUS,DesRoll,Roll,Pitch')
  if (options.statNoFlying) w.defineFormat(0x96, 'STAT', 'Qf', 'TimeUS,isFlyProb')
  else w.defineFormat(0x96, 'STAT', 'QBf', 'TimeUS,isFlying,isFlyProb')
  w.defineFormat(0x97, 'GPS', 'QBBIHBcLLeffffB', 'TimeUS,I,Status,GMS,GWk,NSats,HDop,Lat,Lng,Alt,Spd,GCrs,VZ,Yaw,U')

  const t0 = 1_000_000
  for (const [id, label] of [
    ['-', ''],
    ['s', 's'],
    ['#', 'instance']
  ] as const) {
    w.write('UNIT', [t0, id.charCodeAt(0), label])
  }
  for (const [id, m] of [
    ['-', 0],
    ['F', 1e-6]
  ] as const) {
    w.write('MULT', [t0, id.charCodeAt(0), m])
  }
  w.write('FMTU', [t0, 0x90, 's#-------', 'F--------'])
  w.write('FMTU', options.xkfNoVelocity ? [t0, 0x91, 's#---', 'F----'] : [t0, 0x91, 's#------', 'F-------'])
  w.write('FMTU', [t0, 0x92, 's#--', 'F---'])
  w.write('FMTU', options.baroNoInstance ? [t0, 0x93, 's---', 'F---'] : [t0, 0x93, 's#---', 'F----'])
  w.write('FMTU', [t0, 0x97, 's#-------------', 'F--------------'])

  const param = (name: string, value: number): void => w.write('PARM', [t0, name, value, value, 0])
  trueRatios.forEach((_, i) => {
    const suffix = i === 0 ? '' : String(i + 1)
    param(`ARSPD${suffix}_RATIO`, loggedRatios[i] ?? 2)
    param(`ARSPD${suffix}_USE`, 1)
  })
  // MS4525 on I2C address 0x28, and a DroneCAN sensor on bus 1 node 12 without a sensor id.
  param('ARSPD_DEVID', 1 | (0x28 << 8) | (2 << 16))
  if (trueRatios.length > 1) param('ARSPD2_DEVID', 3 | (1 << 3) | (12 << 8))
  if (options.metar ?? true) w.write('MSG', [t0 + 500, 'GCS:WX1: YSCB 080000Z 18010KT 9999 FEW030 18/05 Q1020'])

  const lat0 = -35.3632621
  const lng0 = 149.1652374
  const rate = 10
  const total = GROUND_BEFORE + flightSeconds + GROUND_AFTER
  const p0 = 101325 * Math.pow(1 - (0.0065 * FIELD_ELEVATION) / 288.15, 5.2559)
  let north = 0
  let east = 0
  for (let k = 0; k <= total * rate; k++) {
    const time = k / rate
    const timeUs = t0 + Math.round(time * 1e6)
    const ft = time - GROUND_BEFORE
    const flying = ft >= 0 && ft <= flightSeconds
    const s = flying ? flightState(ft, straight) : { tas: 0, heading: 0, vd: 0, relAlt: 0 }
    const windN = SYNTHETIC_WIND[0] + 0.5 * Math.sin(time / 200)
    const windE = SYNTHETIC_WIND[1] + 0.3 * Math.cos(time / 170)
    const vn = flying ? s.tas * Math.cos(s.heading) + windN : 0
    const ve = flying ? s.tas * Math.sin(s.heading) + windE : 0
    north += vn / rate
    east += ve / rate

    const tempC = groundTempC - 0.0065 * s.relAlt
    const press = p0 * Math.pow(1 - (0.0065 * s.relAlt) / (groundTempC + 273.15), 5.2559)
    const rho = press / (287.05 * (tempC + 273.15))
    const e2t = Math.sqrt(1.225 / rho)

    trueRatios.forEach((ratio, i) => {
      const tas = flying ? Math.hypot(vn - windN, ve - windE, s.vd) + noise(noiseAmp) : noise(0.5)
      const eas = tas / e2t
      const dpress = (Math.sign(eas) * eas * eas) / ratio
      const logged = loggedRatios[i] ?? 2
      const airspeed = Math.sqrt(Math.max(dpress, 0) * logged)
      w.write('ARSP', [timeUs + i * 1000, i, airspeed, dpress, tempC, 1.5, 1, 1, 0])
    })
    for (let core = 0; core < 2; core++) {
      const e = core * 0.05
      if (options.xkfNoVelocity) w.write('XKF1', [timeUs + 3000 + core * 100, core, 0, 0, s.heading])
      else w.write('XKF1', [timeUs + 3000 + core * 100, core, 0, 0, s.heading, vn + e, ve - e, s.vd])
      w.write('XKF2', [timeUs + 3500 + core * 100, core, windN + 0.2, windE - 0.2])
    }
    if (options.baroNoInstance) w.write('BARO', [timeUs + 4000, s.relAlt, press + noise(2), 35])
    else w.write('BARO', [timeUs + 4000, 0, s.relAlt, press + noise(2), 35])
    w.write('ATT', [timeUs + 5000, 0, flying ? 25 * Math.sin(s.heading) : 0, 0])
    if (k % 2 === 0) {
      const latE7 = Math.round((lat0 + north / 111_320) * 1e7)
      const lngE7 = Math.round((lng0 + east / (111_320 * Math.cos((lat0 * Math.PI) / 180))) * 1e7)
      w.write('POS', [timeUs + 6000, latE7, lngE7, FIELD_ELEVATION + s.relAlt, s.relAlt, s.relAlt])
      w.write('GPS', [
        timeUs + 7000,
        0,
        3,
        300_000_000 + Math.round(time * 1000),
        2300,
        12,
        0.8,
        latE7,
        lngE7,
        FIELD_ELEVATION,
        0,
        0,
        0,
        0,
        1
      ])
    }
    if (k % rate === 0)
      w.write('STAT', options.statNoFlying ? [timeUs + 8000, flying ? 1 : 0] : [timeUs + 8000, flying ? 1 : 0, flying ? 1 : 0])
  }

  const bytes = w.toBytes()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
