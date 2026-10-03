/**
 * Measured frequency responses from system identification time histories: Welch-averaged cross
 * and auto spectra give each response H and its coherence. Ported from upstream
 * `calculate_freq_resp` and `calculate_freq_resp_from_FFT`.
 */
import {
  RealFft,
  arrayAbs,
  arrayAdd,
  arrayDiv,
  arrayInverse,
  arrayMul,
  arrayScale,
  complexAbs,
  complexConj,
  complexMul,
  hanning,
  isPowerOfTwo,
  rfftFreq,
  runFft,
  type ComplexArray
} from '@apwt/signal'
import { chainResponse, designPid, frequencyGrid } from '@apwt/filters'
import type { TuneAxis } from './params.js'
import { SIGNAL_KEYS, type AirspeedScaling, type TimeHistory } from './time-history.js'

/** A frequency response with its coherence (0 to 1, how much of the output the input explains). */
export interface FrequencyResponse {
  readonly H: ComplexArray
  readonly coherence: Float64Array
}

/**
 * Response from per-window spectra of input and output, averaged over every window
 * (upstream `calculate_freq_resp_from_FFT` with the full window range).
 */
export function frequencyResponseFromFft(
  input: readonly ComplexArray[],
  output: readonly ComplexArray[],
  windowSize: number,
  sampleRate: number
): FrequencyResponse {
  const first = input[0]
  const firstOut = output[0]
  if (first === undefined || firstOut === undefined) throw new RangeError('No FFT windows to average')
  const meanLength = input.length

  const square = (x: ComplexArray) => {
    const abs = complexAbs(x)
    return arrayMul(abs, abs)
  }
  let sumIn = square(first)
  let sumOut = square(firstOut)
  const io0 = complexMul(complexConj(first), firstOut)
  let realSumInOut = io0.re
  let imSumInOut = io0.im

  for (let k = 1; k < meanLength; k++) {
    const inK = input[k]!
    const outK = output[k]!
    const io = complexMul(complexConj(inK), outK)
    sumIn = arrayAdd(sumIn, square(inK))
    sumOut = arrayAdd(sumOut, square(outK))
    realSumInOut = arrayAdd(realSumInOut, io.re)
    imSumInOut = arrayAdd(imSumInOut, io.im)
  }

  const twin = (windowSize - 1) * sampleRate
  const fftScale = 2 / (0.612 * meanLength * twin)
  const inputSqrAvg = arrayScale(sumIn, fftScale)
  const outputSqrAvg = arrayScale(sumOut, fftScale)
  const inputOutputAvg: ComplexArray = { re: arrayScale(realSumInOut, fftScale), im: arrayScale(imSumInOut, fftScale) }

  const inputSqrInv = arrayInverse(inputSqrAvg)
  const H: ComplexArray = { re: arrayMul(inputOutputAvg.re, inputSqrInv), im: arrayMul(inputOutputAvg.im, inputSqrInv) }

  const ioAbs = complexAbs(inputOutputAvg)
  const cohNum = arrayMul(ioAbs, ioAbs)
  const cohDen = arrayMul(arrayAbs(inputSqrAvg), arrayAbs(outputSqrAvg))
  return { H, coherence: arrayDiv(cohNum, cohDen) }
}

/** Every response identified from one analysis window, before choosing gyro or attitude feedback. */
export interface IdentifiedResponses {
  /** Bin frequencies (Hz), DC dropped. */
  readonly freq: Float64Array
  readonly sampleRate: number
  readonly windowSize: number
  readonly windowCount: number
  readonly airspeed: AirspeedScaling
  /** Pilot (SID target) input to attitude, or to rate on yaw. */
  readonly pilot: FrequencyResponse
  /** Mixer input to gyro rate and to attitude (the bare aircraft). */
  readonly aircraftGyro: FrequencyResponse
  readonly aircraftAttitude: FrequencyResponse
  /** Rate target to gyro rate and to attitude (closed rate loop). */
  readonly rateGyro: FrequencyResponse
  readonly rateAttitude: FrequencyResponse
  /** Attitude target to attitude. */
  readonly attitude: FrequencyResponse
  /** SID input to attitude error (disturbance rejection). */
  readonly disturbance: FrequencyResponse
  /** Mixer input to loop error (whole system broken loop). */
  readonly systemBrokenLoop: FrequencyResponse
}

export class WindowSizeError extends Error {
  override readonly name = 'WindowSizeError'
}

/** Drop the DC bin (upstream's `_tf` resampling to the predicted response length). */
function dropDc(r: FrequencyResponse): FrequencyResponse {
  return { H: { re: r.H.re.slice(1), im: r.H.im.slice(1) }, coherence: r.coherence.slice(1) }
}

/** Identify every response from a time history with FFT windows of `windowSize` at 50% overlap. */
export function identifyResponses(history: TimeHistory, axis: TuneAxis, windowSize: number): IdentifiedResponses {
  if (!isPowerOfTwo(windowSize)) throw new WindowSizeError('Window size must be a power of two')
  const windowSpacing = Math.round(windowSize * (1 - 0.5))
  const fft = runFft(history.signals, SIGNAL_KEYS, {
    windowSize,
    windowSpacing,
    window: hanning(windowSize),
    fft: new RealFft(windowSize)
  })
  const windowCount = fft.center.length
  if (windowCount === 0) {
    throw new WindowSizeError('The analysis window is shorter than one FFT window. Pick a longer window or a smaller FFT size.')
  }
  const { sampleRate } = history
  const s = fft.spectra
  const response = (input: ComplexArray[], output: ComplexArray[]) =>
    dropDc(frequencyResponseFromFft(input, output, windowSize, sampleRate))

  return {
    freq: rfftFreq(windowSize, 1 / sampleRate).slice(1, windowSize / 2 + 1),
    sampleRate,
    windowSize,
    windowCount,
    airspeed: history.airspeed,
    pilot: response(s.PilotInput, axis === 'Yaw' ? s.Rate : s.Att),
    aircraftGyro: response(s.ActInput, s.GyroRaw),
    aircraftAttitude: response(s.ActInput, s.Att),
    rateGyro: response(s.RateTgt, s.GyroRaw),
    rateAttitude: response(s.RateTgt, s.Att),
    attitude: response(s.AttTgt, s.Att),
    disturbance: response(s.DRBin, s.DRBresp),
    systemBrokenLoop: response(s.SysBLInput, s.SysBLOutput)
  }
}

/** The measured responses the plots compare against. */
export interface MeasuredResponses {
  readonly freq: Float64Array
  readonly pilot: FrequencyResponse
  readonly bareAircraft: FrequencyResponse
  readonly rate: FrequencyResponse
  readonly attitude: FrequencyResponse
  readonly disturbance: FrequencyResponse
  readonly systemBrokenLoop: FrequencyResponse
}

/**
 * Choose the feedback signal for the bare aircraft and rate loop responses. With attitude
 * feedback (which often improves coherence) the attitude responses are differentiated, by a
 * pure derivative modelled at the loop rate, to turn them back into rate responses.
 */
export function measuredResponses(identified: IdentifiedResponses, useAttitude: boolean, loopRate: number): MeasuredResponses {
  const common = {
    freq: identified.freq,
    pilot: identified.pilot,
    attitude: identified.attitude,
    disturbance: identified.disturbance,
    systemBrokenLoop: identified.systemBrokenLoop
  }
  if (!useAttitude) return { ...common, bareAircraft: identified.aircraftGyro, rate: identified.rateGyro }

  const { sampleRate, windowSize } = identified
  const derivative = designPid(loopRate, { kP: 0, kI: 0, kD: 1, errorCutoffHz: 0, derivativeCutoffHz: 0 })
  const s = chainResponse(frequencyGrid(sampleRate * 0.5, sampleRate / windowSize), [[derivative]])
  return {
    ...common,
    bareAircraft: { H: complexMul(identified.aircraftAttitude.H, s), coherence: identified.aircraftAttitude.coherence },
    rate: { H: complexMul(identified.rateAttitude.H, s), coherence: identified.rateAttitude.coherence }
  }
}
