import type { DataflashLog } from '@apwt/dataflash'
import { analyseGyro, windowSizeWriteBack, type GyroAnalysis } from './analyse.js'
import type { FftWindowOptions } from './fft/batch-fft.js'
import { loadFilterReviewLog, type FilterReviewLog } from './load.js'
import { pageValuesFromLog, sanitizeNumberInput, type PageValues } from './page-values.js'
import { defaultSelections, type Selections } from './selections.js'

/** Page inputs that survive from one log to the next, as the strings the inputs hold. */
export interface PageInputs {
  readonly values: PageValues
  /** `FFTWindow_size` (raw logs). */
  readonly windowSize: string
  /** `FFTWindow_per_batch` (batch logs). */
  readonly windowsPerBatch: string
}

/** FFT settings as upstream `run_batch_fft` reads them: `parseInt` of each input. */
export function fftOptions(inputs: Pick<PageInputs, 'windowSize' | 'windowsPerBatch'>): FftWindowOptions {
  return { windowSize: parseInt(inputs.windowSize), windowsPerBatch: parseInt(inputs.windowsPerBatch) }
}

/** Result of an FFT calculation: the analysis, or the error upstream raised. */
export type AnalysisResult =
  { readonly analysis: GyroAnalysis; readonly error: null } | { readonly analysis: null; readonly error: string }

/** Run the FFTs (upstream `calculate()`); a non-power-of-two window is reported, not thrown. */
export function calculate(log: FilterReviewLog, inputs: Pick<PageInputs, 'windowSize' | 'windowsPerBatch'>): AnalysisResult {
  try {
    return { analysis: analyseGyro(log.gyro, log.targets.all, fftOptions(inputs)), error: null }
  } catch (e) {
    return { analysis: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Window size input after a calculation: upstream writes the mean window size of the lowest IMU
 * back into `FFTWindow_size` (also for batch logs, where it is not used until a raw log loads).
 */
export function windowSizeAfter(result: AnalysisResult, windowSize: string): string {
  if (result.analysis === null) return windowSize
  const size = windowSizeWriteBack(result.analysis)
  return size === undefined ? windowSize : sanitizeNumberInput(String(size))
}

/** Page state after a log is loaded. */
export interface LoadedPage {
  readonly log: FilterReviewLog
  readonly inputs: PageInputs
  readonly result: AnalysisResult
  /** `TimeStart` / `TimeEnd`. */
  readonly timeRange: readonly [number, number]
  readonly selections: Selections
}

/**
 * Upstream `load()` as a pure step from the previous page inputs: gyro data, filter inputs (with
 * whatever the previous log left in inputs this log does not set), default analysis window and
 * selections, then the FFTs. `preferBatch` is the log type choice (see `loadFilterReviewLog`).
 * Throws with upstream's message when the log cannot be used.
 */
export function loadIntoPage(previous: PageInputs, dataflash: DataflashLog, preferBatch = false): LoadedPage {
  const log = loadFilterReviewLog(dataflash, preferBatch)
  const values = pageValuesFromLog(previous.values, dataflash)
  const result = calculate(log, previous)
  return {
    log,
    inputs: { values, windowsPerBatch: previous.windowsPerBatch, windowSize: windowSizeAfter(result, previous.windowSize) },
    result,
    timeRange: [log.timeRange.start, log.timeRange.end],
    selections: defaultSelections(log)
  }
}
