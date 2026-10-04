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
 * unticked on the next controller), and the spectrogram moves to Output when the selected
 * signal is one this controller does not offer.
 *
 * Proven upstream bug, fixed (docs/bug-proofs/pid-review.md, row 5): upstream ("Change to Out on
 * spectrogram if disabled option is set") moves to Output when the controller lacks any optional
 * signal and any of Error, P, I, D, FF or D FF is selected, so a PID log without D FF moved an
 * enabled P selection to Output.
 */
export function selectionsForAxis(
  axis: PidAxisData,
  shown: ReadonlySet<FftKey>,
  spectrogram: FftKey
): { shown: ReadonlySet<FftKey>; spectrogram: FftKey } {
  const { keys } = enabledKeys(axis)
  const nextShown = new Set([...shown].filter((k) => keys.has(k)))
  const nextSpectrogram = keys.has(spectrogram) ? spectrogram : 'Out'
  return { shown: nextShown, spectrogram: nextSpectrogram }
}

/** Which parameter sets have spectra, as the Tests table records them when a controller is set up. */
export function validSets(axis: PidAxisData, fft: PidAxisFft | null): boolean[] {
  return axis.sets.map((_, i) => fft?.sets[i] != null)
}
