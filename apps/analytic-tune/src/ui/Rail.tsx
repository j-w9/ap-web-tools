import { useEffect, useRef } from 'react'
import { Calculator } from 'lucide-react'
import { fftWindowSizeInc } from '@apwt/signal'
import { Chip, ControlGroup, LogInput, RailCard, type LogFact } from '@apwt/tool-shell'

export interface AnalysisRailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  loaded: boolean
  timeRange: readonly [number, number]
  onTimeRangeChange: (range: [number, number]) => void
  /** Committed text of the FFT window size input. */
  windowSizeText: string
  onWindowSizeCommit: (text: string) => void
  useAttitude: boolean
  onUseAttitudeChange: (use: boolean) => void
  calculateEnabled: boolean
  onCalculate: () => void
}

/**
 * Upstream's FFT window size input: on each committed change (`window_size_inc`, a native change
 * event, which the spinner fires straight away) a change of exactly one from the last committed
 * size steps to the next power of two in that direction; anything else is kept as typed. The
 * last size starts from the input's default, 1024, and is not touched by values set from a file.
 */
function WindowSizeInput({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const last = useRef<number | null>(null)
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
  })
  useEffect(() => {
    const el = ref.current
    if (el && el.value !== text) el.value = text
  }, [text])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => {
      const previous = last.current ?? parseFloat(el.defaultValue)
      const entered = parseFloat(el.value)
      const stepped = Math.abs(entered - previous) === 1
      const next = fftWindowSizeInc(previous, entered)
      last.current = next
      const committed = stepped ? String(next) : el.value
      el.value = committed
      commit.current(committed)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  return <input ref={ref} type="number" min={1} step={1} defaultValue="1024" />
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
        <p className="at-note">Pick a run in System ID runs, or zoom the flight data plot.</p>
      </ControlGroup>

      <ControlGroup label="FFT">
        <label className="apwt-field">
          <span>Window size</span>
          <WindowSizeInput text={p.windowSizeText} onCommit={p.onWindowSizeCommit} />
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
