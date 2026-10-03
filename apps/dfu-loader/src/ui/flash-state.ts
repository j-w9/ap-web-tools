import type { DfuFlashProgress, DfuProtectedSector } from '@arduconfig/firmware-flash'

/** Where a flash attempt is. Each state carries exactly what the UI needs to show it. */
export type FlashState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'flashing'; readonly progress: DfuFlashProgress | null }
  | { readonly phase: 'blocked'; readonly sectors: readonly DfuProtectedSector[] }
  | { readonly phase: 'done'; readonly deviceName: string }
  | { readonly phase: 'failed'; readonly error: string }

export const IDLE: FlashState = { phase: 'idle' }

/** Ordered flash phases from firmware-flash, with user-facing names. */
export const PHASES = [
  { id: 'erase', label: 'Erase' },
  { id: 'program', label: 'Write' },
  { id: 'verify', label: 'Verify' },
  { id: 'manifest', label: 'Restart' }
] as const satisfies readonly { id: DfuFlashProgress['phase']; label: string }[]
