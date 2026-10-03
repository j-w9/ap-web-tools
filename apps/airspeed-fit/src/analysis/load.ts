/**
 * Log adapter: everything AirspeedFit reads from a DataFlash log, with times in seconds
 * (upstream `load`, `get_velocity_sources`, `baro_gnd_temp_at` and `build_temp_sources`).
 */
import { timeUsToSeconds, type DataflashLog, type NumericColumn } from '@apwt/dataflash'
import { arrayAllEqual, linearInterp } from '@apwt/signal'
import { autoWindow, isaTemperatureAtAltC } from './core.js'
import { metarTemperature, type TempSourceKey, type TempSources } from './temperature.js'

/** EKF generations that log a ground velocity (`XKF1`/`NKF1`) and wind (`XKF2`/`NKF2`). */
const EKF_VARIANTS = [
  { velocity: 'XKF1', wind: 'XKF2', label: 'EKF3' },
  { velocity: 'NKF1', wind: 'NKF2', label: 'EKF2' }
] as const
export type EkfLabel = (typeof EKF_VARIANTS)[number]['label']

/** An EKF core's ground velocity (the truth for the wind triangle) and its onboard wind estimate. */
export interface VelocitySource {
  /** Stable key, e.g. "EKF3 core 0"; also the display name. */
  readonly name: string
  readonly ekf: EkfLabel
  readonly core: number
  readonly time: Float64Array
  readonly vn: NumericColumn
  readonly ve: NumericColumn
  readonly vd: NumericColumn
  /** Onboard EKF wind, when the core logged it. */
  readonly wind: { readonly time: Float64Array; readonly north: NumericColumn; readonly east: NumericColumn } | null
}

/** Parameter names of airspeed sensor `n` (1-based): `ARSPD_RATIO`, `ARSPD2_RATIO`, ... */
export type ArspdParam<Suffix extends string> = `ARSPD${'' | number}_${Suffix}`

/** One airspeed sensor (an `ARSP` instance) and its parameters. */
export interface AirspeedSensor {
  readonly instance: number
  readonly time: Float64Array
  /** Offset-corrected differential pressure, Pa. */
  readonly dpress: NumericColumn
  /** Airspeed the autopilot reported, m/s. */
  readonly airspeed: NumericColumn
  readonly ratioName: ArspdParam<'RATIO'>
  readonly useName: ArspdParam<'USE'>
  /** Ratio in the log (last logged value), when present. */
  readonly currentRatio: number | undefined
  readonly use: number | undefined
  readonly devId: number | undefined
  /** Every logged health flag is 1. */
  readonly healthy: boolean
  /** The last logged primary sensor is this one. */
  readonly primary: boolean
}

/** Everything the fit and the plots need from one log. */
export interface AirspeedLog {
  readonly sensors: readonly [AirspeedSensor, ...AirspeedSensor[]]
  readonly sources: readonly [VelocitySource, ...VelocitySource[]]
  readonly baro: { readonly time: Float64Array; readonly press: NumericColumn }
  readonly pos: { readonly time: Float64Array; readonly relAlt: NumericColumn; readonly alt: NumericColumn }
  readonly att: { readonly time: Float64Array; readonly roll: NumericColumn } | null
  /** First and last time `STAT.isFlying` is set. */
  readonly flight: { readonly lo: number; readonly hi: number } | null
  /** Ground elevation (POS.Alt, m AMSL) at takeoff, or at the end when the vehicle never flew. */
  readonly field: { readonly elevation: number; readonly time: number } | null
  /** Takeoff location and UTC time for the weather lookup. */
  readonly takeoff: { readonly lat: number; readonly lng: number; readonly date: Date } | null
  /** Temperature presets from the log (Open-Meteo is looked up separately). */
  readonly tempSources: TempSources
  readonly startTime: number
  readonly endTime: number
  /** Suggested analysis window (whole seconds), from the first sensor's differential pressure. */
  readonly autoWindow: readonly [number, number]
  /** The same window before rounding; upstream zooms the flight data plot to it on load. */
  readonly autoWindowExact: readonly [number, number]
  readonly messageTypes: readonly string[]
}

/** Instance to read for a single-instance sensor: 0 when present, else the first (upstream). */
function firstInstance(log: DataflashLog, name: string): number | undefined {
  const instances = log.instances(name)
  return instances.includes(0) ? 0 : instances[0]
}

function seconds(log: DataflashLog, name: string, instance?: number): Float64Array | undefined {
  const t = log.getNumbers(name, 'TimeUS', instance)
  return t === undefined ? undefined : timeUsToSeconds(t)
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function velocitySources(log: DataflashLog): VelocitySource[] {
  const sources: VelocitySource[] = []
  for (const v of EKF_VARIANTS) {
    const windCores = new Set(log.instances(v.wind))
    for (const core of log.instances(v.velocity)) {
      const time = seconds(log, v.velocity, core)
      const vn = log.getNumbers(v.velocity, 'VN', core)
      const ve = log.getNumbers(v.velocity, 'VE', core)
      const vd = log.getNumbers(v.velocity, 'VD', core)
      if (time === undefined || time.length === 0) continue
      // Upstream runs Array.from on these columns and crashes when one is missing.
      if (vn === undefined || ve === undefined || vd === undefined) throw new Error(`${v.velocity} is missing VN, VE or VD`)
      let wind: VelocitySource['wind'] = null
      if (windCores.has(core)) {
        const windTime = seconds(log, v.wind, core)
        const north = log.getNumbers(v.wind, 'VWN', core)
        const east = log.getNumbers(v.wind, 'VWE', core)
        if (windTime === undefined || north === undefined || east === undefined) {
          throw new Error(`${v.wind} is missing TimeUS, VWN or VWE`)
        }
        wind = { time: windTime, north, east }
      }
      sources.push({
        name: `${v.label} core ${core}`,
        ekf: v.label,
        core,
        time,
        vn,
        ve,
        vd,
        wind
      })
    }
  }
  return sources
}

/** BARO.GndTemp at a time (deg C), or null. Reference only (IMU heaters warm the baro). */
function baroGndTempAt(log: DataflashLog, tSeconds: number | null): number | null {
  if (tSeconds === null) return null
  const inst = firstInstance(log, 'BARO')
  if (inst === undefined) return null
  const gt = log.getNumbers('BARO', 'GndTemp', inst)
  const time = seconds(log, 'BARO', inst)
  if (gt === undefined || gt.length === 0 || time === undefined) return null
  const v = linearInterp(gt, time, [tSeconds])[0] ?? NaN
  return isFinite(v) ? v : null
}

/** Parameter `suffix` of the sensor logging ARSP instance `inst`: no number for the first sensor. */
export function arspdParam<Suffix extends string>(inst: number, suffix: Suffix): ArspdParam<Suffix> {
  return inst === 0 ? `ARSPD_${suffix}` : `ARSPD${inst + 1}_${suffix}`
}

function airspeedSensor(log: DataflashLog, inst: number): AirspeedSensor | undefined {
  const time = seconds(log, 'ARSP', inst)
  if (time === undefined || time.length === 0) return undefined
  const ratioName = arspdParam(inst, 'RATIO')
  const useName = arspdParam(inst, 'USE')
  const health = log.getNumbers('ARSP', 'H', inst)
  const primary = log.getNumbers('ARSP', 'Pri', inst)
  const lastPrimary = primary !== undefined && primary.length > 0 ? primary[primary.length - 1] : undefined
  return {
    instance: inst,
    time,
    dpress: required(log.getNumbers('ARSP', 'DiffPress', inst), 'No DiffPress field in ARSP'),
    airspeed: required(log.getNumbers('ARSP', 'Airspeed', inst), 'No Airspeed field in ARSP'),
    ratioName,
    useName,
    currentRatio: log.param(ratioName),
    use: log.param(useName),
    devId: log.param(arspdParam(inst, 'DEVID')),
    healthy: health !== undefined && arrayAllEqual(health, 1),
    primary: lastPrimary === inst
  }
}

/**
 * Read a log for AirspeedFit. Throws an `Error` with a message for the user when a required
 * message is missing (upstream alerts and stops in the same cases).
 */
export function loadAirspeedLog(log: DataflashLog): AirspeedLog {
  const arspInstances = log.instances('ARSP')
  if (arspInstances.length === 0) throw new Error('No airspeed (ARSP) data in log')
  if (!log.has('XKF1') && !log.has('NKF1')) throw new Error('No EKF velocity (XKF1/NKF1) data in log')
  if (!log.has('BARO')) throw new Error('No barometer (BARO) data in log, needed for EAS2TAS')

  const [firstSource, ...otherSources] = velocitySources(log)
  if (firstSource === undefined) throw new Error('Could not read EKF velocity')

  // Static pressure from the first barometer. Upstream reads `BARO.instances` and crashes when
  // BARO has no instance field; stop with an error instead.
  const baroInst = firstInstance(log, 'BARO')
  if (baroInst === undefined) throw new Error('BARO has no instance field')
  const baro = {
    time: required(seconds(log, 'BARO', baroInst), 'No BARO.TimeUS in log'),
    press: required(log.getNumbers('BARO', 'Press', baroInst), 'No BARO.Press in log')
  }

  if (!log.has('POS')) throw new Error('No POS data in log, needed for altitude')
  const pos = {
    time: required(seconds(log, 'POS'), 'No POS.TimeUS in log'),
    relAlt: required(log.getNumbers('POS', 'RelHomeAlt'), 'No POS.RelHomeAlt in log'),
    alt: required(log.getNumbers('POS', 'Alt'), 'No POS.Alt in log')
  }

  const attTime = seconds(log, 'ATT')
  const roll = log.getNumbers('ATT', 'Roll')
  const att = attTime !== undefined && roll !== undefined ? { time: attTime, roll } : null

  // Flight span from STAT.isFlying (for the auto window).
  let flyingFrom: number | undefined
  let flyingTo: number | undefined
  const statTime = seconds(log, 'STAT')
  const flying = log.getNumbers('STAT', 'isFlying')
  // Upstream crashes on a STAT message without isFlying.
  if (log.has('STAT') && (statTime === undefined || flying === undefined)) throw new Error('STAT is missing TimeUS or isFlying')
  if (statTime !== undefined && flying !== undefined) {
    for (let i = 0; i < flying.length; i++) {
      if (flying[i] !== 1) continue
      flyingFrom ??= statTime[i]
      flyingTo = statTime[i]
    }
  }
  const flight = flyingFrom !== undefined && flyingTo !== undefined ? { lo: flyingFrom, hi: flyingTo } : null

  // Ground elevation: POS.Alt when the vehicle first flies, or the last POS.Alt if it never does.
  let field: { elevation: number; time: number } | null = null
  let takeoff: AirspeedLog['takeoff'] = null
  if (pos.alt.length > 0) {
    field =
      flight !== null
        ? { time: flight.lo, elevation: linearInterp(pos.alt, pos.time, [flight.lo])[0] ?? NaN }
        : { time: pos.time[pos.time.length - 1] ?? NaN, elevation: pos.alt[pos.alt.length - 1] ?? NaN }

    // Takeoff location and UTC log start for the weather lookup.
    const lat = log.getNumbers('POS', 'Lat')
    const lng = log.getNumbers('POS', 'Lng')
    const utc = log.startTime()
    if (lat !== undefined && lng !== undefined && utc !== undefined) {
      const la = (linearInterp(lat, pos.time, [field.time])[0] ?? NaN) * 1e-7
      const lo = (linearInterp(lng, pos.time, [field.time])[0] ?? NaN) * 1e-7
      if (isFinite(la) && isFinite(lo)) takeoff = { lat: la, lng: lo, date: utc }
    }
  }

  const tempSources: Partial<Record<TempSourceKey, number>> = {}
  if (field !== null) tempSources.isa = isaTemperatureAtAltC(field.elevation)
  const gt = baroGndTempAt(log, field?.time ?? null)
  if (gt !== null) tempSources.baro = gt
  const metar = metarTemperature(log.textMessages(), log.getNumbers('MSG', 'TimeUS'), field?.time ?? null)
  if (metar !== null) tempSources.metar = metar

  const sensors = [...arspInstances].sort((a, b) => a - b).flatMap((inst) => airspeedSensor(log, inst) ?? [])
  const [firstSensor, ...otherSensors] = sensors
  if (firstSensor === undefined) throw new Error('No usable airspeed data in log')

  let startTime = Infinity
  let endTime = -Infinity
  for (const s of sensors) {
    startTime = Math.min(startTime, s.time[0]!)
    endTime = Math.max(endTime, s.time[s.time.length - 1]!)
  }

  // Auto window from the first sensor over the flight span; the whole log when that fails.
  let window: [number, number] = [startTime, endTime]
  try {
    const aw = autoWindow(firstSensor.time, firstSensor.dpress, flight?.lo ?? startTime, flight?.hi ?? endTime)
    window = [aw.start, aw.end]
  } catch {
    // keep the whole log
  }

  return {
    sensors: [firstSensor, ...otherSensors],
    sources: [firstSource, ...otherSources],
    baro,
    pos,
    att,
    flight,
    field,
    takeoff,
    tempSources,
    startTime,
    endTime,
    autoWindow: [Math.floor(window[0]), Math.ceil(window[1])],
    autoWindowExact: window,
    messageTypes: [...log.messageTypes().keys()]
  }
}
