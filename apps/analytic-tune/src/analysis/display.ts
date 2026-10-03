/**
 * What the comparison plots show for each control loop: the measured response, the predicted one,
 * which coherence goes with each, and whether the run's excitation makes the measured response
 * meaningful. Ported from upstream `redraw_freq_resp`, `get_amplitude_scale` and
 * `get_frequency_scale`.
 */
import { phaseDegrees, unwrapPhase } from '@apwt/filters'
import { arrayLog10, arrayScale, complexAbs, type ComplexArray } from '@apwt/signal'
import type { FrequencyResponse, MeasuredResponses } from './freq-resp.js'
import type { PredictedResponses } from './predict.js'
import type { TuneVehicle } from './params.js'

/** The loops the tool compares, in upstream's order. */
export const CONTROL_LOOPS = [
  'bare-aircraft',
  'rate',
  'attitude-feedforward',
  'attitude-no-feedforward',
  'input-shaping',
  'disturbance-rejection',
  'rate-stability',
  'attitude-stability',
  'system-stability'
] as const
export type ControlLoop = (typeof CONTROL_LOOPS)[number]

export const CONTROL_LOOP_LABELS: Readonly<Record<ControlLoop, string>> = {
  'bare-aircraft': 'Bare aircraft',
  rate: 'Rate controller',
  'attitude-feedforward': 'Attitude controller with feedforward',
  'attitude-no-feedforward': 'Attitude controller without feedforward',
  'input-shaping': 'Input shaping',
  'disturbance-rejection': 'Attitude disturbance rejection',
  'rate-stability': 'Rate stability',
  'attitude-stability': 'Attitude stability',
  'system-stability': 'Entire system stability'
}

/** Fixed wing has no input shaping and its attitude loop is not modelled with feedforward. */
export function controlLoopAvailable(loop: ControlLoop, vehicle: TuneVehicle): boolean {
  return vehicle !== 'fixed-wing' || (loop !== 'attitude-feedforward' && loop !== 'input-shaping')
}

/** One plotted response: H and coherence, and whether to show it. */
export interface PlottedResponse {
  readonly H: ComplexArray
  readonly coherence: Float64Array
  readonly visible: boolean
}

export interface LoopComparison {
  readonly calculated: PlottedResponse
  readonly predicted: PlottedResponse
}

/**
 * Whether a run on `sidAxis` excites the loop, so its measured response means something
 * (upstream's `show_set_calc` rules).
 */
export function calculatedVisible(loop: ControlLoop, sidAxis: number): boolean {
  switch (loop) {
    case 'bare-aircraft':
      return true
    case 'input-shaping':
      return !(sidAxis > 3)
    case 'system-stability':
      return !(sidAxis < 10 || sidAxis > 12)
    case 'attitude-stability':
    case 'rate-stability':
      return false
    case 'disturbance-rejection':
      return !(sidAxis < 4 || sidAxis > 6)
    case 'attitude-no-feedforward':
      return !(sidAxis < 4 || (sidAxis > 6 && sidAxis < 20) || sidAxis > 22)
    case 'attitude-feedforward':
      return !((sidAxis > 3 && sidAxis < 7) || (sidAxis > 9 && sidAxis < 20))
    case 'rate':
      return !(sidAxis > 9 && sidAxis < 20)
  }
}

/** The measured and predicted responses to compare for a loop. The predicted coherence is the bare aircraft's. */
export function loopComparison(
  loop: ControlLoop,
  sidAxis: number,
  measured: MeasuredResponses,
  predicted: PredictedResponses
): LoopComparison {
  const calc = (r: FrequencyResponse): PlottedResponse => ({
    H: r.H,
    coherence: r.coherence,
    visible: calculatedVisible(loop, sidAxis)
  })
  const pred = (H: ComplexArray, visible = true): PlottedResponse => ({
    H,
    coherence: measured.bareAircraft.coherence,
    visible
  })
  switch (loop) {
    case 'input-shaping':
      return { calculated: calc(measured.pilot), predicted: pred(predicted.pilot) }
    case 'system-stability':
      return { calculated: calc(measured.systemBrokenLoop), predicted: pred(predicted.systemBrokenLoop) }
    case 'attitude-stability':
      return { calculated: calc(measured.systemBrokenLoop), predicted: pred(predicted.attitudeBrokenLoop) }
    case 'rate-stability':
      return { calculated: calc(measured.systemBrokenLoop), predicted: pred(predicted.rateBrokenLoop) }
    case 'disturbance-rejection':
      return { calculated: calc(measured.disturbance), predicted: pred(predicted.disturbance) }
    case 'attitude-no-feedforward':
      return { calculated: calc(measured.attitude), predicted: pred(predicted.attitudeNoFeedforward) }
    case 'attitude-feedforward':
      return { calculated: calc(measured.attitude), predicted: pred(predicted.attitudeFeedforward) }
    case 'rate':
      return { calculated: calc(measured.rate), predicted: pred(predicted.rate) }
    case 'bare-aircraft':
      return { calculated: calc(measured.bareAircraft), predicted: pred(predicted.rate, false) }
  }
}

// ---------- Axis scales ----------

export type GainScale = 'dB' | 'linear'
export type PhaseScale = 'wrapped' | 'unwrapped'
export type FrequencyUnit = 'Hz' | 'rad/s'
export type AxisType = 'log' | 'linear'

export interface DisplaySettings {
  readonly loop: ControlLoop
  readonly gain: GainScale
  readonly phase: PhaseScale
  readonly frequencyAxis: AxisType
  readonly frequencyUnit: FrequencyUnit
  readonly useAttitude: boolean
}

/** Upstream's initial selections. */
export const DEFAULT_DISPLAY: DisplaySettings = {
  loop: 'rate',
  gain: 'dB',
  phase: 'wrapped',
  frequencyAxis: 'log',
  frequencyUnit: 'Hz',
  useAttitude: false
}

export function gainLabel(scale: GainScale): string {
  return scale === 'dB' ? 'Amplitude (dB)' : 'Amplitude'
}

export function gainHover(scale: GainScale, axis: string): string {
  return scale === 'dB' ? '%{' + axis + ':.2f} dB' : '%{' + axis + ':.2f}'
}

/** |H|, as 20 log10 |H| in dB. */
export function gainOf(h: ComplexArray, scale: GainScale): Float64Array {
  const abs = complexAbs(h)
  return scale === 'dB' ? arrayScale(arrayLog10(abs), 20.0) : abs
}

/**
 * Phase of H in degrees.
 *
 * Deviation: upstream offers an un-wrapped phase option but forces it off when drawing; here the
 * option works.
 */
export function phaseOf(h: ComplexArray, scale: PhaseScale): Float64Array {
  const phase = phaseDegrees(h)
  return scale === 'unwrapped' ? unwrapPhase(phase) : phase
}

export function frequencyLabel(unit: FrequencyUnit): string {
  return unit === 'rad/s' ? 'Rad/s' : 'Frequency (Hz)'
}

export function frequencyHover(unit: FrequencyUnit, axis: string): string {
  return unit === 'rad/s' ? '%{' + axis + ':.2f} Rad/s' : '%{' + axis + ':.2f} Hz'
}

/** Bin frequencies in the chosen unit. */
export function frequencyIn(freqHz: Float64Array, unit: FrequencyUnit): Float64Array {
  return unit === 'rad/s' ? arrayScale(freqHz, Math.PI * 2) : freqHz
}
