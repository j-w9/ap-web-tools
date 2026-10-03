/** PID signal keys as stored per batch, in plot order. */
export const FFT_KEYS = ['Tar', 'Act', 'Err', 'P', 'I', 'D', 'FF', 'DFF', 'Out'] as const
export type FftKey = (typeof FFT_KEYS)[number]

/** Display names for each key, in the same order as `FFT_KEYS`. */
export const KEY_LABELS: Readonly<Record<FftKey, string>> = {
  Tar: 'Target',
  Act: 'Actual',
  Err: 'Error',
  P: 'P',
  I: 'I',
  D: 'D',
  FF: 'FF',
  DFF: 'D FF',
  Out: 'Output'
}

/** Keys only present in full PID messages, not in the RATE message. */
export const FULL_PID_ONLY_KEYS: readonly FftKey[] = ['Err', 'P', 'I', 'D', 'FF']
