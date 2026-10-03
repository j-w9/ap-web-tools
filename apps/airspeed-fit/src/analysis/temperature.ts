/**
 * Ground-temperature presets and the live temperature readout (upstream `build_temp_sources`,
 * `metar_temp_from_msg`, `set_temp_select`, `window_mean` and `update_temp_debug`).
 *
 * The temperature is always a single ground-level value lapsed to each sample's altitude; a
 * preset source only fills that value.
 */
import { linearInterp } from '@apwt/signal'
import { US_TO_S } from '@apwt/dataflash'
import { airTemperatureC, densityAltitudeM, eas2tas } from './core.js'

/** Preset temperature sources, in preference order. */
export const TEMP_SOURCE_KEYS = ['openmeteo', 'isa', 'baro', 'metar'] as const
export type TempSourceKey = (typeof TEMP_SOURCE_KEYS)[number]

export const TEMP_SOURCE_LABELS = {
  openmeteo: 'Open-Meteo',
  isa: 'ISA',
  baro: 'BARO.GndTemp',
  metar: 'METAR'
} as const satisfies Record<TempSourceKey, string>

/** Ground temperature (deg C) of each source that has data. */
export type TempSources = Readonly<Partial<Record<TempSourceKey, number>>>

/** What fills the ground-temperature box: a preset, or a value the user typed. */
export type TempChoice = TempSourceKey | 'custom'

/** Dropdown label of a preset, e.g. "ISA (12 °C)". */
export function tempSourceLabel(key: TempSourceKey, value: number): string {
  return `${TEMP_SOURCE_LABELS[key]} (${value.toFixed(0)} °C)`
}

/** The box text a preset fills in: upstream rounds it to whole degrees with `toFixed(0)`. */
export function tempBoxText(value: number): string {
  return value.toFixed(0)
}

/**
 * The source to select: `preferred` when it has data, else the first available preset, else
 * custom. Upstream `set_temp_select`.
 */
export function chooseTempSource(sources: TempSources, preferred: TempSourceKey | null): TempChoice {
  if (preferred !== null && sources[preferred] !== undefined) return preferred
  return TEMP_SOURCE_KEYS.find((k) => sources[k] !== undefined) ?? 'custom'
}

// Carbonix-specific upstream behaviour: their GCS sends the nearest airfield's METAR as a "GCS:WX"
// status text. The air temperature is the "TT/DD" temperature/dewpoint group.
const WX_TEMP_RE = /GCS:WX.*[^0-9A-Za-z](M?\d\d)\/M?\d\d/

/**
 * METAR air temperature from a `GCS:WX` status text closest in time to `tSeconds`, or null when
 * the log has none. Upstream `metar_temp_from_msg`.
 */
export function metarTemperature(
  messages: readonly string[],
  timesUs: ArrayLike<number> | undefined,
  tSeconds: number | null
): number | null {
  let best: number | null = null
  let bestDiff = Infinity
  for (let i = 0; i < messages.length; i++) {
    const m = WX_TEMP_RE.exec(messages[i]!)
    const g = m?.[1]
    if (g === undefined) continue
    const val = g.startsWith('M') ? -parseInt(g.slice(1), 10) : parseInt(g, 10)
    if (!isFinite(val)) continue
    const timeUs = timesUs?.[i]
    const tt = timeUs !== undefined ? timeUs * US_TO_S : (tSeconds ?? 0)
    const diff = tSeconds !== null ? Math.abs(tt - tSeconds) : 0
    if (diff < bestDiff) {
      bestDiff = diff
      best = val
    }
  }
  return best
}

/**
 * Mean of `values` whose timestamps fall in [t0, t1], falling back to the overall mean when the
 * window is empty. Upstream `window_mean`.
 */
export function windowMean(values: ArrayLike<number>, times: ArrayLike<number>, t0: number, t1: number): number {
  let s = 0
  let n = 0
  for (let i = 0; i < values.length; i++) {
    if (times[i]! < t0 || times[i]! > t1) continue
    s += values[i]!
    n++
  }
  if (n === 0) {
    for (let i = 0; i < values.length; i++) s += values[i]!
    n = values.length
  }
  return n > 0 ? s / n : NaN
}

/** Inputs to {@link temperatureReadout}: the pressure and altitude streams and the takeoff field. */
export interface ReadoutInputs {
  readonly baro: { readonly time: Float64Array; readonly press: ArrayLike<number> }
  readonly pos: { readonly time: Float64Array; readonly relAlt: ArrayLike<number> }
  readonly field: { readonly elevation: number; readonly time: number } | null
}

/** Live readout under the temperature controls; null entries show as "n/a". */
export interface TemperatureReadout {
  readonly fieldElevationM: number | null
  readonly densityAltitudeM: number | null
  /** Average EAS2TAS over the window as a percentage above 1. */
  readonly eas2tasPercent: number | null
}

/**
 * Field elevation, field density altitude and the average EAS2TAS over the window, from raw log
 * aggregates (window means), independent of the fit. Upstream `update_temp_debug`.
 */
export function temperatureReadout(
  log: ReadoutInputs,
  groundTempC: number,
  window: readonly [number, number]
): TemperatureReadout {
  let densityAlt: number | null = null
  if (log.field !== null) {
    const pField = linearInterp(log.baro.press, log.baro.time, [log.field.time])[0] ?? NaN
    densityAlt = densityAltitudeM(eas2tas(pField, groundTempC))
  }
  const [t0, t1] = window
  const meanP = windowMean(log.baro.press, log.baro.time, t0, t1)
  const meanT = airTemperatureC(groundTempC, windowMean(log.pos.relAlt, log.pos.time, t0, t1))
  const e2t = eas2tas(meanP, meanT)
  return {
    fieldElevationM: log.field?.elevation ?? null,
    densityAltitudeM: densityAlt !== null && isFinite(densityAlt) ? densityAlt : null,
    eas2tasPercent: isFinite(e2t) ? (e2t - 1) * 100 : null
  }
}
