import { Calculator } from 'lucide-react'
import { stepWindowSize } from '@apwt/signal'
import { Chip, ControlGroup, LogInput, RailCard, type LogFact } from '@apwt/tool-shell'

export interface AnalysisRailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  loaded: boolean
  timeRange: readonly [number, number]
  onTimeRangeChange: (range: [number, number]) => void
  windowSize: number
  onWindowSizeChange: (size: number) => void
  useAttitude: boolean
  onUseAttitudeChange: (use: boolean) => void
  calculateEnabled: boolean
  onCalculate: () => void
}

/** The log input and analysis settings: window, FFT size, feedback signal and recalculation. */
export function AnalysisRail(p: AnalysisRailProps) {
  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="Needs SIDS and SIDD from SystemID mode" />
      </ControlGroup>

      <ControlGroup label="Analysis window">
        <label className="apwt-field">
          <span>Start (s)</span>
          <input
            type="number"
            step={1}
            min={0}
            disabled={!p.loaded}
            value={p.timeRange[0]}
            onChange={(e) => p.onTimeRangeChange([Number(e.target.value), p.timeRange[1]])}
          />
        </label>
        <label className="apwt-field">
          <span>End (s)</span>
          <input
            type="number"
            step={1}
            min={0}
            disabled={!p.loaded}
            value={p.timeRange[1]}
            onChange={(e) => p.onTimeRangeChange([p.timeRange[0], Number(e.target.value)])}
          />
        </label>
        <p className="at-note">Pick a run below the plots, or zoom the flight data plot.</p>
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
        <div className="apwt-chips">
          <Chip
            type="checkbox"
            checked={p.useAttitude}
            onChange={p.onUseAttitudeChange}
            title="Identify the aircraft and rate loop from attitude instead of gyro rate, which can improve coherence"
          >
            Use attitude to improve coherence
          </Chip>
        </div>
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
