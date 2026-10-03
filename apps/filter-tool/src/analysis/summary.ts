import type { HarmonicNotchFilter } from './filters.js'

/** What a harmonic notch is doing, for a one-line status under its settings. */
export type NotchStatus =
  | { readonly kind: 'disabled' }
  /** Enabled but producing no notch: no harmonics selected or every centre above Nyquist. */
  | { readonly kind: 'empty' }
  | { readonly kind: 'active'; readonly notchCount: number; readonly fundamentalHz: number }

export function notchStatus(filter: HarmonicNotchFilter): NotchStatus {
  if (!filter.enabled) return { kind: 'disabled' }
  if (filter.notches.length === 0) return { kind: 'empty' }
  return { kind: 'active', notchCount: filter.notches.length, fundamentalHz: filter.fundamentalHz }
}
