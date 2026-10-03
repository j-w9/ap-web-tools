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
  /** Window size as typed, so a half-typed value is not overwritten. */
  windowText: string
  onWindowTextChange: (text: string) => void
  windowValid: boolean
}

/** The control rail: log input, rate unit and averaging window (upstream "Setup"). */
export function Rail(p: RailProps) {
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
          <input
            type="number"
            min={0.1}
            step={1}
            value={p.windowText}
            aria-invalid={!p.windowValid}
            onChange={(e) => p.onWindowTextChange(e.target.value)}
          />
        </label>
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          {p.windowValid ? 'Rates are averaged over windows of this length.' : 'Enter a window size above zero.'}
        </p>
      </ControlGroup>
    </RailCard>
  )
}
