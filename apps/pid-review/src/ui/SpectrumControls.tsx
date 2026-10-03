import { Chip, ChipGroup, RadioChips } from '@apwt/tool-shell'
import type { AmplitudeKind } from '@apwt/signal'
import { FFT_KEYS, KEY_LABELS, type FftKey } from '../analysis/keys.js'

export interface FrequencyScaleSettings {
  log: boolean
  rpm: boolean
}

export interface SignalChipsProps {
  enabled: ReadonlySet<FftKey>
  shown: ReadonlySet<FftKey>
  onShownChange: (shown: ReadonlySet<FftKey>) => void
}

/** Upstream's signal fieldsets: Inputs, Components and Output. */
const SIGNAL_GROUPS: readonly { label: string; keys: readonly FftKey[] }[] = [
  { label: 'Inputs', keys: ['Tar', 'Act', 'Err'] },
  { label: 'Components', keys: ['P', 'I', 'D', 'FF', 'DFF'] },
  { label: 'Output', keys: ['Out'] }
]

/**
 * Upstream's double-click on a group legend: tick every chip of the group when fewer than half
 * of its enabled chips are ticked, otherwise untick them all.
 */
export function toggleGroup(keys: readonly FftKey[], enabled: ReadonlySet<FftKey>, shown: ReadonlySet<FftKey>): Set<FftKey> {
  const checked = keys.filter((k) => shown.has(k)).length
  const enabledCount = keys.filter((k) => enabled.has(k)).length
  const check = checked < enabledCount * 0.5
  const next = new Set(shown)
  for (const k of keys) {
    if (check) next.add(k)
    else next.delete(k)
  }
  return next
}

/** Which PID signals appear on the spectrum plot, in upstream's three groups. */
export function SignalChips({ enabled, shown, onShownChange }: SignalChipsProps) {
  return (
    <div className="pr-signal-groups">
      {SIGNAL_GROUPS.map((group) => (
        <div key={group.label} className="apwt-chip-group" role="group" aria-label={group.label}>
          <button
            type="button"
            className="pr-group-toggle"
            title={`Show or hide every ${group.label.toLowerCase()} signal`}
            disabled={!group.keys.some((k) => enabled.has(k))}
            onClick={() => onShownChange(toggleGroup(group.keys, enabled, shown))}
          >
            {group.label}
          </button>
          {group.keys.map((k) => (
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
        label="Amplitude"
        value={amplitude}
        onChange={onAmplitudeChange}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'dB', label: 'dB' },
          { value: 'PSD', label: 'PSD' }
        ]}
      />
      <ChipGroup label="Frequency">
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
      </ChipGroup>
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
      label="Signal"
      value={selected}
      onChange={onSelect}
      options={FFT_KEYS.map((k) => ({ value: k, label: KEY_LABELS[k], disabled: !enabled.has(k) }))}
    />
  )
}
