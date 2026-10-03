import type { VehicleType } from '@apwt/dataflash'
import type { ComplexArray, WindowCorrection } from '@apwt/signal'
import type { FftKey } from './keys.js'
import type { ParamSets } from './param-sets.js'
import type { PidMessageSpec } from './vehicle.js'

/** A contiguous run of PID samples at a steady rate, in display units. */
export interface PidBatch {
  /** Seconds. */
  time: Float64Array
  /** Hz. */
  sampleRate: number
  /** Signals present in this batch. `Tar`, `Act` and `Out` are always present. */
  signals: Partial<Record<FftKey, Float64Array>> & Pick<Record<FftKey, Float64Array>, 'Tar' | 'Act' | 'Out'>
}

/** Windowed spectra of one parameter set's batches, concatenated in time order. */
export interface SetFft {
  /** Window centre times, seconds. */
  time: Float64Array
  spectra: Partial<Record<FftKey, ComplexArray[]>>
}

/** Properties shared by all spectra of one controller. */
export interface AxisFft {
  /** Bin frequencies, Hz. */
  bins: Float64Array
  averageSampleRate: number
  windowSize: number
  correction: WindowCorrection
}

/** Everything loaded for one controller (one axis radio button). */
export interface PidAxisData {
  spec: PidMessageSpec
  paramSets: ParamSets
  /** One entry per parameter set; null when the set has no usable batches. */
  sets: readonly (readonly PidBatch[] | null)[]
  startTime: number
  endTime: number
}

/** FFT results for one controller: per-set spectra plus shared bin layout. */
export interface PidAxisFft {
  sets: readonly (SetFft | null)[]
  axis: AxisFft
}

/** Keys with data in any batch of the controller. */
export function availableKeys(data: PidAxisData): ReadonlySet<FftKey> {
  const keys = new Set<FftKey>()
  for (const set of data.sets) {
    for (const batch of set ?? []) {
      for (const key of Object.keys(batch.signals) as FftKey[]) keys.add(key)
    }
  }
  return keys
}

/** Context traces shown above the PID plots. */
export interface FlightData {
  roll?: { time: Float64Array; values: Float64Array }
  pitch?: { time: Float64Array; values: Float64Array }
  throttle?: { time: Float64Array; values: Float64Array }
  altitude?: { time: Float64Array; values: Float64Array }
}

/** Everything the tool extracts from a log. */
export interface LoadedLog {
  axes: readonly PidAxisData[]
  flight: FlightData
  /** Overall span of PID data, seconds. */
  startTime: number
  endTime: number
  /** Base message types in the log, for the "Open in" buttons. */
  messageTypes: readonly string[]
  /** Vehicle family. Always a supported one: unsupported logs are rejected while loading. */
  vehicle: VehicleType
  /** Firmware version string, when the log records one. */
  firmware: string | null
}
