import { CheckCircle2 } from 'lucide-react'
import { describeProtectedSectors } from '@arduconfig/firmware-flash'
import { ErrorBanner } from '@apwt/tool-shell'
import { PHASES, type FlashState } from './flash-state.js'

export interface ProgressProps {
  state: FlashState
  onFlashAnyway: () => void
}

/** Phase steps, a progress bar and the outcome of the current flash. */
export function Progress({ state, onFlashAnyway }: ProgressProps) {
  switch (state.phase) {
    case 'idle':
      return null
    case 'failed':
      return <ErrorBanner message={state.error} />
    case 'blocked':
      return (
        <div className="apwt-section__body">
          <ErrorBanner
            message={`The board reports that sectors this bootloader needs are write protected. ${describeProtectedSectors(state.sectors)}`}
          />
          <p className="apwt-section__help">
            Flashing anyway usually fails part way, after the old bootloader has been erased. Only continue if you have cleared
            the protection.
          </p>
          <button type="button" className="apwt-btn" onClick={onFlashAnyway}>
            Flash anyway
          </button>
        </div>
      )
    case 'done':
      return (
        <p className="apwt-flash-done">
          <CheckCircle2 />
          Bootloader written to {state.deviceName}. Power cycle the board, then load firmware with your ground station.
        </p>
      )
    case 'flashing': {
      const current = state.progress?.phase
      const index = current === undefined ? -1 : PHASES.findIndex((p) => p.id === current)
      return (
        <div className="apwt-section__body">
          <ol className="apwt-flash-steps">
            {PHASES.map((p, i) => (
              <li key={p.id} data-state={i < index ? 'done' : i === index ? 'active' : 'todo'}>
                {p.label}
              </li>
            ))}
          </ol>
          <div
            className="apwt-flash-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((state.progress?.ratio ?? 0) * 100)}
          >
            <div style={{ width: `${String((state.progress?.ratio ?? 0) * 100)}%` }} />
          </div>
          <p className="apwt-section__help">{state.progress?.label ?? 'Preparing'}</p>
        </div>
      )
    }
  }
}
