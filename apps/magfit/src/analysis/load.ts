// Log loading for MAGFit, ported from upstream MAGFit/magfit.js (`load`, minus the DOM).

import { DataflashLog } from '@apwt/dataflash'
import { loadAttitudeSources, type AttitudeSource } from './attitude.js'
import { MAX_COMPASSES, loadCompass, type CompassData } from './compass.js'
import { loadFlightData, type FlightData } from './flight-data.js'
import { logLocation, type LogLocation } from './location.js'
import { loadMotorSources, motorSourceAt, type FitMotorSource } from './motor.js'
import { expectedEarthField, type EarthField } from './wmm.js'

/** Everything MAGFit needs from a log, before any fitting. */
export interface MagFitLog {
  /** Compasses by index (length {@link MAX_COMPASSES}); `undefined` where absent. */
  readonly compasses: readonly (CompassData | undefined)[]
  /** Earliest compass sample time, seconds (default analysis start). */
  readonly startTime: number
  /** Latest compass sample time, seconds (default analysis end). */
  readonly endTime: number
  readonly location: LogLocation
  /** Expected earth field, assumed constant for the flight. */
  readonly earthField: EarthField
  readonly attitudeSources: readonly AttitudeSource[]
  /** Default attitude source index, `undefined` if the user must pick one. */
  readonly defaultAttitudeSource: number | undefined
  /** Interference sources for motor compensation fits. */
  readonly motorSources: readonly FitMotorSource[]
  readonly flight: FlightData
}

/**
 * Load a log for MAGFit. Throws an `Error` with upstream's user-facing message when the log
 * has no compass data, no usable location, or no attitude source.
 */
export function loadMagFitLog(source: ArrayBuffer | Uint8Array | DataflashLog): MagFitLog {
  const log = source instanceof DataflashLog ? source : DataflashLog.parse(source)

  if (log.instances('MAG').length === 0) throw new Error('No compass data in log')

  const compasses: (CompassData | undefined)[] = []
  let startTime: number | undefined
  let endTime: number | undefined
  for (let i = 0; i < MAX_COMPASSES; i++) {
    const compass = loadCompass(log, i)
    compasses.push(compass)
    if (compass === undefined) continue
    startTime = startTime === undefined ? compass.startTime : Math.min(startTime, compass.startTime)
    endTime = endTime === undefined ? compass.endTime : Math.max(endTime, compass.endTime)
  }
  if (startTime === undefined || endTime === undefined) throw new Error('No compass data in log')

  // Assume constant earth field, use last EKF origin
  const location = logLocation(log)
  const earthField = expectedEarthField(location?.lat, location?.lon)
  if (location === undefined || earthField === undefined) {
    throw new Error('Could not get earth field for Lat: ' + String(location?.lat) + ' Lng: ' + String(location?.lon))
  }

  const attitude = loadAttitudeSources(log)
  if (attitude.sources.length === 0) throw new Error('Unknown attitude source')

  // Upstream resamples every source at compass 1's times while loading (and crashes without it).
  const compass0Time = compasses[0]?.time
  const motorSources = loadMotorSources(log).map((s) => ({ ...s, atCompass0: motorSourceAt(s, compass0Time) }))

  return {
    compasses,
    startTime,
    endTime,
    location,
    earthField,
    attitudeSources: attitude.sources,
    defaultAttitudeSource: attitude.defaultIndex,
    motorSources,
    flight: loadFlightData(log)
  }
}
