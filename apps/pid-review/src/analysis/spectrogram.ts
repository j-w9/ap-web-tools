import { arrayScale, complexAbs, type AmplitudeScale } from '@apwt/signal'
import type { AxisFft, SetFft } from './data.js'
import type { FftKey } from './keys.js'

export interface SpectrogramData {
  /** Window centre times, seconds, including inserted gap markers. */
  x: number[]
  /** One row per `x`; null rows render as gaps. */
  z: (Float64Array | null)[]
}

/**
 * Build spectrogram columns for `key` across all sets. Where consecutive windows are more
 * than 2.5x the running average spacing apart, two null columns are inserted so Plotly
 * leaves the gap blank instead of smearing across it.
 */
export function spectrogramData(
  sets: readonly (SetFft | null)[],
  key: FftKey,
  axis: AxisFft,
  amplitude: AmplitudeScale
): SpectrogramData {
  const resolution = axis.averageSampleRate / axis.windowSize
  const gain = amplitude.windowCorrection(axis.correction, resolution)
  const x: number[] = []
  const z: (Float64Array | null)[] = []

  for (const set of sets) {
    const spectra = set?.spectra[key]
    if (!set || !spectra) continue
    const n = set.time.length
    let count = 0
    let last = set.time[0] as number
    let sectionStart = last
    for (let j = 0; j < n; j++) {
      count++
      const t = set.time[j] as number
      const dt = t - last
      const averageDt = (t - sectionStart) / count
      if (dt > averageDt * 2.5) {
        count = 0
        x.push(last + averageDt, t - averageDt)
        z.push(null, null)
        sectionStart = t
      }
      x.push(t)
      const s = spectra[j]
      z.push(s ? amplitude.scale(amplitude.transform(arrayScale(complexAbs(s), gain))) : null)
      last = t
    }
  }
  return { x, z }
}
