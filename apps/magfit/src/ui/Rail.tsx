import { Calculator, Download } from 'lucide-react'
import { ControlGroup, LogInput, RadioChips, RailCard, type LogFact } from '@apwt/tool-shell'
import type { AttitudeSource } from '../analysis/attitude.js'

/** Props of {@link Rail}. */
export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  sources: readonly AttitudeSource[]
  sourceIndex: number | undefined
  onSourceChange: (index: number) => void
  timeRange: readonly [number, number]
  timeLimits: readonly [number, number] | null
  onTimeRangeChange: (range: [number, number]) => void
  calculateEnabled: boolean
  onCalculate: () => void
  saveEnabled: boolean
  onSave: () => void
}

/** The control rail: log input, attitude source, analysis window, calculate and save. */
export function Rail(p: RailProps) {
  const loaded = p.timeLimits != null
  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="Needs MAG, attitude (XKQ, NKQ or AHR2) and ORGN or POS messages" />
      </ControlGroup>

      <ControlGroup label="Attitude source">
        {p.sources.length > 0 ? (
          <RadioChips
            name="attitude-source"
            options={p.sources.map((s, i) => ({ value: String(i), label: s.name }))}
            value={p.sourceIndex === undefined ? '' : String(p.sourceIndex)}
            onChange={(v) => p.onSourceChange(Number(v))}
          />
        ) : (
          <p className="magfit-note">Available once a log is open.</p>
        )}
        <p className="magfit-note">
          The estimate that best represents the true attitude; the default is usually right. Try DCM if the EKF had problems.
        </p>
      </ControlGroup>

      <ControlGroup label="Analysis window">
        <label className="apwt-field">
          <span>Start (s)</span>
          <input
            type="number"
            step={1}
            disabled={!loaded}
            min={p.timeLimits?.[0]}
            max={p.timeLimits?.[1]}
            value={p.timeRange[0]}
            onChange={(e) => p.onTimeRangeChange([Number(e.target.value), p.timeRange[1]])}
          />
        </label>
        <label className="apwt-field">
          <span>End (s)</span>
          <input
            type="number"
            step={1}
            disabled={!loaded}
            min={p.timeLimits?.[0]}
            max={p.timeLimits?.[1]}
            value={p.timeRange[1]}
            onChange={(e) => p.onTimeRangeChange([p.timeRange[0], Number(e.target.value)])}
          />
        </label>
        <p className="magfit-note">Or zoom the flight data plot to the flying part of the log.</p>
      </ControlGroup>

      <div className="apwt-group">
        <button
          type="button"
          className="apwt-btn apwt-btn--primary apwt-btn--block"
          disabled={!p.calculateEnabled}
          onClick={p.onCalculate}
        >
          <Calculator />
          Calculate
        </button>
        <button type="button" className="apwt-btn apwt-btn--block magfit-save" disabled={!p.saveEnabled} onClick={p.onSave}>
          <Download />
          Save parameters
        </button>
      </div>
    </RailCard>
  )
}
