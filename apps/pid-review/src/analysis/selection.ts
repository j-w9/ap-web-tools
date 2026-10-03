import type { PidAxisData, PidAxisFft } from './data.js'
import { FULL_PID_ONLY_KEYS, type FftKey } from './keys.js'

/** Spectrum signals ticked after a log loads (upstream `reset()`: Target and Actual). */
export const DEFAULT_SHOWN_KEYS: readonly FftKey[] = ['Tar', 'Act']
/** Spectrogram signal after a log loads (upstream `reset()`). */
export const DEFAULT_SPECTROGRAM_KEY: FftKey = 'Out'

/**
 * Signals a controller offers (upstream `add_param_sets`): Target, Actual and Output always;
 * Error, P, I, D and FF only from a full PID message (not RATE); D FF only when a batch logs it.
 */
export function enabledKeys(axis: PidAxisData): { keys: ReadonlySet<FftKey>; haveAll: boolean; haveDff: boolean } {
  const haveAll = axis.spec.source.message !== 'RATE'
  const haveDff = haveAll && axis.sets.some((set) => set != null && set.some((batch) => batch.signals.DFF != null))
  const keys = new Set<FftKey>(['Tar', 'Act', 'Out'])
  if (haveAll) for (const k of FULL_PID_ONLY_KEYS) keys.add(k)
  if (haveDff) keys.add('DFF')
  return { keys, haveAll, haveDff }
}

/**
 * Selections after a controller is set up (load or controller change), as upstream
 * `add_param_sets` leaves its checkboxes: disabled spectrum signals are unticked (and stay
 * unticked on the next controller), and the spectrogram moves to Output when the controller
 * lacks any optional signal and one of Error, P, I, D, FF or D FF was selected — even one this
 * controller has (a PID log without D FF moves a P selection to Output).
 */
export function selectionsForAxis(
  axis: PidAxisData,
  shown: ReadonlySet<FftKey>,
  spectrogram: FftKey
): { shown: ReadonlySet<FftKey>; spectrogram: FftKey } {
  const { keys, haveAll, haveDff } = enabledKeys(axis)
  const nextShown = new Set([...shown].filter((k) => keys.has(k)))
  const optionalSelected = spectrogram !== 'Tar' && spectrogram !== 'Act' && spectrogram !== 'Out'
  const nextSpectrogram = (!haveAll || !haveDff) && optionalSelected ? 'Out' : spectrogram
  return { shown: nextShown, spectrogram: nextSpectrogram }
}

/** Which parameter sets have spectra, as the Tests table records them when a controller is set up. */
export function validSets(axis: PidAxisData, fft: PidAxisFft | null): boolean[] {
  return axis.sets.map((_, i) => fft?.sets[i] != null)
}
