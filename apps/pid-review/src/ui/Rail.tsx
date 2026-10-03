import { Calculator } from 'lucide-react'
import { ControlGroup, LogInput, RailCard, type LogFact, Chip } from '@apwt/tool-shell'
import { ALL_SPEC_KEYS, specLabel, type SpecKey } from '../analysis/vehicle.js'
import { CommitNumberInput } from './CommitNumberInput.js'

/** Text shown in a number input for a value; NaN (an empty or invalid entry) shows as empty. */
const numberText = (n: number): string => (Number.isNaN(n) ? '' : String(n))

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  /** Window size input text, as upstream keeps it (validated only when calculating). */
  windowSize: string
  /** Committed window size text (native change event). */
  onWindowSizeCommit: (raw: string) => void
  timeRange: [number, number]
  timeLimits: [number, number] | null
  onTimeRangeChange: (range: [number, number]) => void
  /** Controllers with data in the loaded log. */
  availableKeys: ReadonlySet<SpecKey>
  selectedKey: SpecKey | null
  onSelectKey: (key: SpecKey) => void
  calculateEnabled: boolean
  onCalculate: () => void
}

/** The control rail: log input, controller choice, analysis window and FFT size. */
export function Rail(p: RailProps) {
  const available = p.availableKeys
  const loaded = p.timeLimits != null
  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="Needs RATE or PID messages" />
      </ControlGroup>

      <ControlGroup label="Controller">
        <div className="apwt-chips">
          {ALL_SPEC_KEYS.filter((k) => !loaded || available.has(k)).map((key) => (
            <Chip
              key={key}
              type="radio"
              name="controller"
              checked={p.selectedKey === key}
              disabled={!available.has(key)}
              onChange={() => p.onSelectKey(key)}
            >
              {specLabel(key)}
            </Chip>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label="Analysis window">
        <label className="apwt-field">
          <span>Start (s)</span>
          <CommitNumberInput
            step={1}
            disabled={!loaded}
            min={p.timeLimits?.[0] ?? 0}
            max={p.timeLimits?.[1]}
            value={numberText(p.timeRange[0])}
            onCommit={(raw) => p.onTimeRangeChange([parseFloat(raw), p.timeRange[1]])}
          />
        </label>
        <label className="apwt-field">
          <span>End (s)</span>
          <CommitNumberInput
            step={1}
            disabled={!loaded}
            min={p.timeLimits?.[0] ?? 0}
            max={p.timeLimits?.[1]}
            value={numberText(p.timeRange[1])}
            onCommit={(raw) => p.onTimeRangeChange([p.timeRange[0], parseFloat(raw)])}
          />
        </label>
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          Or zoom the flight data plot to pick a window.
        </p>
      </ControlGroup>

      <ControlGroup label="FFT">
        <label className="apwt-field">
          <span>Window size</span>
          <CommitNumberInput min={1} step={1} value={p.windowSize} onCommit={p.onWindowSizeCommit} />
        </label>
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
      </div>
    </RailCard>
  )
}
