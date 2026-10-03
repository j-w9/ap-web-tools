import { useEffect, useRef } from 'react'
import { ControlGroup, LogInput, RadioChips, RailCard, type LogFact } from '@apwt/tool-shell'
import { ACCEPTED_EXTENSIONS } from '../analysis/load.js'
import type { RateUnit } from '../analysis/stats.js'

const UNIT_OPTIONS = [
  { value: 'bits', label: 'Bits per second' },
  { value: 'messages', label: 'Messages per second' }
] as const satisfies readonly { value: RateUnit; label: string }[]

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  unit: RateUnit
  onUnitChange: (unit: RateUnit) => void
  /** Initial window size text. */
  defaultWindowText: string
  /**
   * Called with the input's value on its native `change` event (Enter, blur or the spinner), as
   * upstream's `onchange="replot()"`, so half-typed values such as `0.` are never used.
   */
  onWindowCommit: (text: string) => void
}

/** The control rail: log input, rate unit and averaging window (upstream "Setup"). */
export function Rail(p: RailProps) {
  const windowInput = useRef<HTMLInputElement>(null)
  const { onWindowCommit } = p
  useEffect(() => {
    const input = windowInput.current
    if (input === null) return
    const commit = () => onWindowCommit(input.value)
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [onWindowCommit])

  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput
          facts={p.facts}
          onFile={p.onFile}
          accept={ACCEPTED_EXTENSIONS}
          hint={
            <>
              A MAVLink telemetry log (<code>.tlog</code>) or a DataFlash log (<code>.bin</code>)
            </>
          }
        />
      </ControlGroup>

      <ControlGroup label="Rate unit">
        <RadioChips name="unit" options={UNIT_OPTIONS} value={p.unit} onChange={p.onUnitChange} />
      </ControlGroup>

      <ControlGroup label="Window">
        <label className="apwt-field">
          <span>Window size (s)</span>
          <input ref={windowInput} type="number" min={0.1} step={1} defaultValue={p.defaultWindowText} />
        </label>
        <p className="ss-note">Rates are averaged over windows of this length.</p>
      </ControlGroup>
    </RailCard>
  )
}
