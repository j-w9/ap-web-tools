import { Calculator } from 'lucide-react'
import { stepWindowSize } from '@apwt/signal'
import { ControlGroup, LogInput, RailCard, type LogFact, Chip } from '@apwt/tool-shell'
import { ALL_SPEC_KEYS, specLabel, type SpecKey } from '../analysis/vehicle.js'

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  windowSize: number
  onWindowSizeChange: (size: number) => void
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
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          Or zoom the flight data plot to pick a window.
        </p>
      </ControlGroup>

      <ControlGroup label="FFT">
        <label className="apwt-field">
          <span>Window size</span>
          <input
            type="number"
            min={2}
            step={1}
            value={p.windowSize}
            onChange={(e) => {
              const v = Number(e.target.value)
              p.onWindowSizeChange(stepWindowSize(v, v > p.windowSize ? 'up' : 'down'))
            }}
          />
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
          Recalculate
        </button>
      </div>
    </RailCard>
  )
}
