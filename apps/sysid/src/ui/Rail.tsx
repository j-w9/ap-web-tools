import { Play } from 'lucide-react'
import { Chip, ControlGroup, LogInput, RailCard, type LogFact } from '@apwt/tool-shell'
import type { ModelType, Setup } from '../analysis/setup.js'

export type PythonStatus = 'loading' | 'ready' | 'failed'

const STATUS_TEXT: Readonly<Record<PythonStatus, string>> = {
  loading: 'Loading Python…',
  ready: 'Python ready',
  failed: 'Python failed to load'
}

const STATUS_BADGE: Readonly<Record<PythonStatus, string>> = {
  loading: 'apwt-badge apwt-badge--gray',
  ready: 'apwt-badge apwt-badge--green',
  failed: 'apwt-badge apwt-badge--red'
}

const MODEL_OPTIONS: readonly { value: ModelType; label: string }[] = [
  { value: 'transfer-function', label: 'Transfer function' },
  { value: 'state-space', label: 'State space' }
]

type TextKey = 'startTime' | 'endTime' | 'startFreq' | 'endFreq' | 'cutoffFreq'

export interface RailProps {
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  setup: Setup
  onTextChange: (key: TextKey, value: string) => void
  onModelChange: (model: ModelType) => void
  python: PythonStatus
  submitEnabled: boolean
  onSubmit: () => void
}

/** The control rail: log, analysis time, model type, frequency range and Submit. */
export function Rail(p: RailProps) {
  const number = (key: TextKey, label: string, step?: number) => (
    <label className="apwt-field">
      <span>{label}</span>
      <input
        type="number"
        min={step === undefined ? undefined : 0}
        step={step}
        value={p.setup[key]}
        onChange={(e) => p.onTextChange(key, e.target.value)}
      />
    </label>
  )
  return (
    <RailCard>
      <ControlGroup label="Log">
        <LogInput facts={p.facts} onFile={p.onFile} hint="A log with System ID mode flights" />
      </ControlGroup>

      <ControlGroup label="Analysis time">
        {number('startTime', 'Start (s)', 1)}
        {number('endTime', 'End (s)', 1)}
        <p className="apwt-section__help sysid-note">Or zoom the flight data plot to pick a window.</p>
      </ControlGroup>

      <ControlGroup label="Model">
        <div className="apwt-chips" role="radiogroup">
          {MODEL_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              type="radio"
              name="model"
              checked={p.setup.model === o.value}
              onChange={() => p.onModelChange(o.value)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup label="Frequency (rad/s)">
        {number('startFreq', 'Start frequency')}
        {number('endFreq', 'End frequency')}
        {number('cutoffFreq', 'LPF cutoff frequency')}
      </ControlGroup>

      <div className="apwt-group">
        <p className="sysid-status">
          <span className={STATUS_BADGE[p.python]}>{STATUS_TEXT[p.python]}</span>
        </p>
        <button
          type="button"
          className="apwt-btn apwt-btn--primary apwt-btn--block"
          disabled={!p.submitEnabled}
          onClick={p.onSubmit}
        >
          <Play />
          Submit
        </button>
      </div>
    </RailCard>
  )
}
