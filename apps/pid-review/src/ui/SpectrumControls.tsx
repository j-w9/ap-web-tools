import type { AmplitudeKind } from '@apwt/signal'
import { FFT_KEYS, KEY_LABELS, type FftKey } from '../analysis/keys.js'
import { Chip, RadioChips } from './Choice.js'

export interface FrequencyScaleSettings {
  log: boolean
  rpm: boolean
}

export interface SignalChipsProps {
  enabled: ReadonlySet<FftKey>
  shown: ReadonlySet<FftKey>
  onShownChange: (shown: ReadonlySet<FftKey>) => void
}

/** Which PID signals appear on the spectrum plot. */
export function SignalChips({ enabled, shown, onShownChange }: SignalChipsProps) {
  return (
    <div className="apwt-chips">
      {FFT_KEYS.map((k) => (
        <Chip
          key={k}
          type="checkbox"
          checked={shown.has(k)}
          disabled={!enabled.has(k)}
          onChange={(on) => {
            const next = new Set(shown)
            if (on) next.add(k)
            else next.delete(k)
            onShownChange(next)
          }}
          title={k === 'Out' ? 'P + I + D + FF + D FF' : undefined}
        >
          {KEY_LABELS[k]}
        </Chip>
      ))}
    </div>
  )
}

export interface ScaleChipsProps {
  amplitude: AmplitudeKind
  onAmplitudeChange: (kind: AmplitudeKind) => void
  frequency: FrequencyScaleSettings
  onFrequencyChange: (settings: FrequencyScaleSettings) => void
}

/** Amplitude and frequency axis scales. */
export function ScaleChips({ amplitude, onAmplitudeChange, frequency, onFrequencyChange }: ScaleChipsProps) {
  return (
    <>
      <RadioChips
        name="amplitude"
        value={amplitude}
        onChange={onAmplitudeChange}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'dB', label: 'dB' },
          { value: 'PSD', label: 'PSD' }
        ]}
      />
      <RadioChips
        name="freq-axis"
        value={frequency.log ? 'log' : 'linear'}
        onChange={(v) => onFrequencyChange({ ...frequency, log: v === 'log' })}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'log', label: 'Log' }
        ]}
      />
      <RadioChips
        name="freq-unit"
        value={frequency.rpm ? 'rpm' : 'hz'}
        onChange={(v) => onFrequencyChange({ ...frequency, rpm: v === 'rpm' })}
        options={[
          { value: 'hz', label: 'Hz' },
          { value: 'rpm', label: 'RPM' }
        ]}
      />
    </>
  )
}

export interface SpectrogramChipsProps {
  enabled: ReadonlySet<FftKey>
  selected: FftKey
  onSelect: (key: FftKey) => void
}

/** Which PID signal the spectrogram shows. */
export function SpectrogramChips({ enabled, selected, onSelect }: SpectrogramChipsProps) {
  return (
    <RadioChips
      name="spectrogram"
      value={selected}
      onChange={onSelect}
      options={FFT_KEYS.map((k) => ({ value: k, label: KEY_LABELS[k], disabled: !enabled.has(k) }))}
    />
  )
}
