import { CheckChips, Chip, ChipLabel, RadioChips } from '@apwt/tool-shell'
import type { AmplitudeKind } from '@apwt/signal'
import { GYRO_AXES, type GyroAxis } from '../analysis/fft/batch-fft.js'
import type { AliasMode } from '../analysis/plots/alias.js'
import { SPECTRUM_KINDS, SPECTRUM_LABELS, spectrumTraceKey, type SpectrumKind, type SpectrumTraceKey } from './traces.js'

/** Frequency axis settings. */
export interface FrequencyScaleSettings {
  log: boolean
  rpm: boolean
}

export interface ScaleChipsProps {
  amplitude: AmplitudeKind
  onAmplitudeChange: (kind: AmplitudeKind) => void
  frequency: FrequencyScaleSettings
  onFrequencyChange: (settings: FrequencyScaleSettings) => void
}

/** Amplitude and frequency axis scales, shared by every frequency plot. */
export function ScaleChips({ amplitude, onAmplitudeChange, frequency, onFrequencyChange }: ScaleChipsProps) {
  return (
    <>
      <ChipLabel>Amplitude</ChipLabel>
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
      <ChipLabel>Frequency</ChipLabel>
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

export interface AliasChipsProps {
  value: AliasMode
  onChange: (mode: AliasMode) => void
}

/** How sensor-rate noise is shown against the loop rate. */
export function AliasChips({ value, onChange }: AliasChipsProps) {
  return (
    <>
      <ChipLabel>Aliasing</ChipLabel>
      <RadioChips
        name="aliasing"
        value={value}
        onChange={onChange}
        options={[
          { value: 'none', label: 'Off' },
          { value: 'on', label: 'Fold to loop rate' },
          { value: 'only', label: 'Aliased only' }
        ]}
      />
    </>
  )
}

export interface TraceChipsProps {
  /** Gyros with data, with a display label each. */
  gyros: readonly { sensor: number; label: string }[]
  /** Lines that have data. */
  available: ReadonlySet<SpectrumTraceKey>
  shown: ReadonlySet<SpectrumTraceKey>
  onShownChange: (shown: ReadonlySet<SpectrumTraceKey>) => void
}

const SHORT: Readonly<Record<SpectrumKind, string>> = { pre: 'Pre', post: 'Post', est: 'Est.' }

/** Per gyro, which of the pre-filter, post-filter and estimated lines are drawn on each axis. */
export function TraceChips({ gyros, available, shown, onShownChange }: TraceChipsProps) {
  return (
    <div>
      {gyros.map((g) => {
        const keys = SPECTRUM_KINDS.flatMap((kind) =>
          GYRO_AXES.map((axis) => ({ kind, axis, key: spectrumTraceKey(g.sensor, kind, axis) }))
        )
        const enabled = keys.filter((k) => available.has(k.key))
        const allShown = enabled.length > 0 && enabled.every((k) => shown.has(k.key))
        return (
          <div key={g.sensor} className="fr-trace-row">
            <ChipLabel>{g.label}</ChipLabel>
            <Chip
              type="checkbox"
              checked={allShown}
              disabled={enabled.length === 0}
              title="Show or hide every line of this gyro"
              onChange={(on) => {
                const next = new Set(shown)
                for (const k of enabled) {
                  if (on) next.add(k.key)
                  else next.delete(k.key)
                }
                onShownChange(next)
              }}
            >
              All
            </Chip>
            <CheckChips
              options={keys.map((k) => ({
                value: k.key,
                label: `${SHORT[k.kind]} ${k.axis.toUpperCase()}`,
                disabled: !available.has(k.key),
                title: `${SPECTRUM_LABELS[k.kind]}, ${k.axis.toUpperCase()} axis`
              }))}
              value={shown}
              onChange={onShownChange}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Notch overlay toggles: one per harmonic notch, plus the logged notch frequencies. */
export type NotchToggle = 'notch1' | 'notch2' | 'logged'

export interface NotchChipsProps {
  value: ReadonlySet<NotchToggle>
  onChange: (value: ReadonlySet<NotchToggle>) => void
  enabled: readonly [boolean, boolean]
  /** Offer the logged notch toggle (spectrogram only). */
  logged?: { available: boolean }
}

/** Which notch frequencies are overlaid on a plot. */
export function NotchChips({ value, onChange, enabled, logged }: NotchChipsProps) {
  return (
    <>
      <ChipLabel>Notches</ChipLabel>
      <CheckChips
        options={[
          { value: 'notch1', label: 'Notch 1', disabled: !enabled[0] },
          { value: 'notch2', label: 'Notch 2', disabled: !enabled[1] },
          ...(logged
            ? [
                {
                  value: 'logged' as const,
                  label: 'Logged',
                  disabled: !logged.available,
                  title: 'Notch frequencies the firmware logged'
                }
              ]
            : [])
        ]}
        value={value}
        onChange={onChange}
      />
    </>
  )
}

export interface AxisChipsProps {
  value: GyroAxis
  onChange: (axis: GyroAxis) => void
}

/** Gyro axis picker. */
export function AxisChips({ value, onChange }: AxisChipsProps) {
  return (
    <RadioChips
      name="spec-axis"
      value={value}
      onChange={onChange}
      options={GYRO_AXES.map((a) => ({ value: a, label: a.toUpperCase() }))}
    />
  )
}

export interface GyroChipsProps {
  name: string
  gyros: readonly { sensor: number; label: string; disabled?: boolean }[]
  value: number
  onChange: (sensor: number) => void
}

/** Gyro (IMU) picker. */
export function GyroChips({ name, gyros, value, onChange }: GyroChipsProps) {
  return (
    <RadioChips
      name={name}
      value={`${value}`}
      onChange={(v) => onChange(Number(v))}
      options={gyros.map((g) => ({ value: `${g.sensor}`, label: g.label, disabled: g.disabled ?? false }))}
    />
  )
}
