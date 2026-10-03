// Amplitude and frequency axis scaling for FFT plots (from upstream/Libraries/fft.js).
// The `hover` strings are Plotly hovertemplate fragments; no DOM access is involved.

import { arrayLog10, arrayMul, arrayScale } from './array.js'
import type { WindowCorrection } from './window.js'

/** Which amplitude representation an `AmplitudeScale` produces. */
export type AmplitudeKind = 'linear' | 'dB' | 'PSD'

/** Recipe for turning raw |FFT| amplitudes into plotted values. */
export interface AmplitudeScale {
  readonly kind: AmplitudeKind
  /** Pre-average transform of raw amplitudes (identity, or x^2 for PSD). Upstream `fun`. */
  readonly transform: (x: ArrayLike<number>) => Float64Array
  /** Post-average display mapping (identity, 20*log10 or 10*log10). Upstream `scale`. */
  readonly scale: (x: ArrayLike<number>) => Float64Array
  /** Axis label, e.g. "Amplitude (dB)". */
  readonly label: string
  /** Plotly hovertemplate fragment for the given axis letter ("x" or "y"). */
  readonly hover: (axis: string) => string
  /** Gain to apply to transformed amplitudes given the window correction and bin width (Hz). */
  readonly windowCorrection: (correction: WindowCorrection, resolution: number) => number
  /** Gain to apply to a quantisation-noise floor estimate given that window correction. */
  readonly quantizationCorrection: (windowCorrection: number) => number
}

/** Options for `fftAmplitudeScale`; `psd` takes precedence over `dB`, as upstream. */
export interface AmplitudeScaleOptions {
  readonly dB?: boolean
  readonly psd?: boolean
}

const identity = (x: ArrayLike<number>): Float64Array => Float64Array.from(x)

/** Amplitude scaling recipe: linear, dB (20*log10) or PSD (10*log10 of x^2 per Hz). */
export function fftAmplitudeScale(options: AmplitudeScaleOptions = {}): AmplitudeScale {
  if (options.psd === true) {
    return {
      kind: 'PSD',
      transform: (x) => arrayMul(x, x),
      scale: (x) => arrayScale(arrayLog10(x), 10.0),
      label: 'PSD (dB/Hz)',
      hover: (axis) => '%{' + axis + ':.2f} dB/Hz',
      windowCorrection: (correction, resolution) => (correction.energy ** 2 * 0.5) / resolution,
      quantizationCorrection: (windowCorrection) => 1 / Math.sqrt(windowCorrection)
    }
  }
  if (options.dB === true) {
    return {
      kind: 'dB',
      transform: identity,
      scale: (x) => arrayScale(arrayLog10(x), 20.0),
      label: 'Amplitude (dB)',
      hover: (axis) => '%{' + axis + ':.2f} dB',
      windowCorrection: (correction) => correction.linear,
      quantizationCorrection: (windowCorrection) => 1 / windowCorrection
    }
  }
  return {
    kind: 'linear',
    transform: identity,
    scale: identity,
    label: 'Amplitude',
    hover: (axis) => '%{' + axis + ':.2f}',
    windowCorrection: (correction) => correction.linear,
    quantizationCorrection: (windowCorrection) => 1 / windowCorrection
  }
}

/** Recipe for presenting frequency bins on an axis. */
export interface FrequencyScale {
  /** Convert bin frequencies in Hz to axis units (identity or x60 for RPM). Upstream `fun`. */
  readonly transform: (hz: ArrayLike<number>) => Float64Array
  /** Axis label, e.g. "Frequency (Hz)". */
  readonly label: string
  /** Plotly hovertemplate fragment for the given axis letter ("x" or "y"). */
  readonly hover: (axis: string) => string
  /** Plotly axis type. */
  readonly type: 'log' | 'linear'
}

/** Options for `fftFrequencyScale`. */
export interface FrequencyScaleOptions {
  readonly rpm?: boolean
  readonly log?: boolean
}

/** Frequency axis recipe in Hz or RPM, on a linear or log axis. */
export function fftFrequencyScale(options: FrequencyScaleOptions = {}): FrequencyScale {
  const type = options.log === true ? 'log' : 'linear'
  if (options.rpm === true) {
    return {
      transform: (hz) => arrayScale(hz, 60.0),
      label: 'RPM',
      hover: (axis) => '%{' + axis + ':.2f} RPM',
      type
    }
  }
  return {
    transform: identity,
    label: 'Frequency (Hz)',
    hover: (axis) => '%{' + axis + ':.2f} Hz',
    type
  }
}
