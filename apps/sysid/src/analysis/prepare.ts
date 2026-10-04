/**
 * Signal preparation shared by both identifications: the JavaScript half of upstream
 * `run_transfer_function_ID` and `run_SS_ID`, which cut the input and outputs to the analysis
 * window, scale outputs and add gravity compensation before handing plain arrays to Python.
 */
import type { DataflashLog } from '@apwt/dataflash'
import { nearestIndex, requireColumn } from './columns.js'

export type CompensationAxis = 'Roll' | 'Pitch'

export interface SignalSource {
  readonly message: string
  readonly field: string
}

export interface OutputSource extends SignalSource {
  /** Multiplier text when its box is ticked; an empty text applies nothing, as upstream. */
  readonly multiplier: string | null
  readonly compensation: CompensationAxis | null
}

/** What Python receives. Times stay in microseconds; the scripts divide by 1e6. */
export interface PreparedSignals {
  readonly timeUs: number[]
  readonly input: number[]
  readonly outputs: number[][]
}

const US_PER_S = 1000000
const G = 9.81

/** Upstream's truthiness test on the multiplier text, then `parseFloat`. */
function multiplierValue(text: string | null): number | null {
  return text ? parseFloat(text) : null
}

interface Window {
  readonly timeUs: number[]
  readonly values: number[]
}

function sliceWindow(log: DataflashLog, source: SignalSource, startS: number, endS: number): Window {
  const time = requireColumn(log, source.message, 'TimeUS')
  const values = requireColumn(log, source.message, source.field)
  const first = nearestIndex(time, startS * US_PER_S)
  const last = nearestIndex(time, endS * US_PER_S)
  return { timeUs: Array.from(time).slice(first, last), values: Array.from(values).slice(first, last) }
}

/**
 * Upstream gravity compensation, with the proven indexing bug fixed (docs/bug-proofs/sysid.md,
 * row 3). Upstream finds the ATT window by time but then reads ATT at the window start plus the
 * output's sample index, which leaves the window (and the array, giving NaN) whenever the output
 * is logged more often than ATT. Here each output sample whose time lies within ATT's logged span
 * uses the ATT sample nearest to it in time. Where ATT is logged with the output (the System ID
 * case) that is the same sample upstream reads. Samples outside ATT's span keep upstream's value,
 * including NaN past the end of ATT.
 */
function compensate(
  log: DataflashLog,
  data: number[],
  dataTimeUs: readonly number[],
  axis: CompensationAxis,
  mult: number,
  startS: number
): void {
  const attTime = requireColumn(log, 'ATT', 'TimeUS')
  const attStart = nearestIndex(attTime, startS * US_PER_S)
  const angle = Array.from(requireColumn(log, 'ATT', axis))
  const firstAtt = attTime[0] ?? NaN
  const lastAtt = attTime[attTime.length - 1] ?? NaN
  const sign = axis === 'Roll' ? 1 : -1
  for (let j = 0; j < data.length; j++) {
    const t = dataTimeUs[j] ?? NaN
    const index = t >= firstAtt && t <= lastAtt ? nearestIndex(attTime, t) : attStart + j
    const term = (Math.PI / 180) * mult * G * (angle[index] ?? NaN)
    data[j] = sign > 0 ? data[j]! + term : data[j]! - term
  }
}

/**
 * Cut every signal to `[startS, endS]` by its own message's timestamps (end exclusive), scale and
 * compensate the outputs. Throws `MissingDataError` where upstream would crash.
 */
export function prepareSignals(
  log: DataflashLog,
  input: SignalSource,
  outputs: readonly OutputSource[],
  startS: number,
  endS: number
): PreparedSignals {
  const inputTime = requireColumn(log, input.message, 'TimeUS')
  const first = nearestIndex(inputTime, startS * US_PER_S)
  const last = nearestIndex(inputTime, endS * US_PER_S)
  const timeUs = Array.from(inputTime).slice(first, last)
  const inputData = Array.from(requireColumn(log, input.message, input.field)).slice(first, last)

  const outputData = outputs.map((output) => {
    const window = sliceWindow(log, output, startS, endS)
    let data = window.values
    const multiplier = multiplierValue(output.multiplier)
    if (multiplier !== null) data = data.map((value) => value * multiplier)
    if (output.compensation !== null) compensate(log, data, window.timeUs, output.compensation, multiplier ?? 1, startS)
    return data
  })

  return { timeUs, input: inputData, outputs: outputData }
}
