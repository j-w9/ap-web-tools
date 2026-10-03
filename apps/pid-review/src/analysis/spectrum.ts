import { arrayAdd, arrayScale, complexAbs, type AmplitudeScale } from '@apwt/signal'
import type { AxisFft, SetFft } from './data.js'
import type { FftKey } from './keys.js'
import { timeRangeIndices } from './time-range.js'

/**
 * Average the windowed spectra of `key` that fall inside the time range, with window
 * correction, mapped to display scale. Returns null when the set has no spectra for `key`.
 */
export function meanSpectrum(
  set: SetFft,
  key: FftKey,
  axis: AxisFft,
  amplitude: AmplitudeScale,
  range: readonly [number, number]
): Float64Array | null {
  const spectra = set.spectra[key]
  if (!spectra || spectra.length === 0) return null

  const resolution = axis.averageSampleRate / axis.windowSize
  const gain = amplitude.windowCorrection(axis.correction, resolution)
  const [start, end] = timeRangeIndices(set.time, range[0], range[1])
  const count = end - start

  let sum: Float64Array = new Float64Array(spectra[0]!.re.length)
  for (let k = start; k < end; k++) {
    const s = spectra[k]
    if (!s) continue
    sum = arrayAdd(sum, amplitude.transform(complexAbs(s)))
  }
  return amplitude.scale(arrayScale(sum, gain / count))
}
