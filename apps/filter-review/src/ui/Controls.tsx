import { CheckChips, ChipGroup, RadioChips } from '@apwt/tool-shell'
import type { AmplitudeKind } from '@apwt/signal'
import { GYRO_AXES, type GyroAxis } from '../analysis/fft/batch-fft.js'
import type { AliasMode } from '../analysis/plots/alias.js'
import { SPECTRUM_KINDS, SPECTRUM_LABELS, spectrumTraceKey, type SpectrumTraceKey } from './traces.js'
import { toggleLines } from './toggle-lines.js'

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

export interface AliasChipsProps {
  value: AliasMode
  onChange: (mode: AliasMode) => void
}

/** How sensor-rate noise is shown against the loop rate. */
export function AliasChips({ value, onChange }: AliasChipsProps) {
  return (
    <RadioChips
      name="aliasing"
      label="Aliasing"
      value={value}
      onChange={onChange}
      options={[
        { value: 'none', label: 'Off' },
        { value: 'on', label: 'Fold to loop rate' },
        { value: 'only', label: 'Aliased only' }
      ]}
    />
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

/** A group label that shows or hides every line in its group. */
function GroupToggle(p: {
  label: string
  keys: readonly SpectrumTraceKey[]
  available: ReadonlySet<SpectrumTraceKey>
  shown: ReadonlySet<SpectrumTraceKey>
  onShownChange: (shown: ReadonlySet<SpectrumTraceKey>) => void
  title: string
}) {
  return (
    <button
      type="button"
      className="fr-group-toggle"
      title={p.title}
      disabled={!p.keys.some((k) => p.available.has(k))}
      onClick={() => p.onShownChange(toggleLines(p.keys, p.available, p.shown))}
    >
      {p.label}
    </button>
  )
}

/** Per gyro, which of the pre-filter, post-filter and estimated lines are drawn on each axis. */
export function TraceChips({ gyros, available, shown, onShownChange }: TraceChipsProps) {
  return (
    <div className="fr-trace-table">
      {gyros.map((g) => {
        const all = SPECTRUM_KINDS.flatMap((kind) => GYRO_AXES.map((axis) => spectrumTraceKey(g.sensor, kind, axis)))
        return (
          <div key={g.sensor} className="fr-trace-row" role="group" aria-label={g.label}>
            <GroupToggle
              label={g.label}
              keys={all}
              available={available}
              shown={shown}
              onShownChange={onShownChange}
              title={`Show or hide every line of ${g.label}`}
            />
            {SPECTRUM_KINDS.map((kind) => {
              const keys = GYRO_AXES.map((axis) => spectrumTraceKey(g.sensor, kind, axis))
              return (
                <div key={kind} className="apwt-chip-group" role="group" aria-label={`${g.label} ${SPECTRUM_LABELS[kind]}`}>
                  <GroupToggle
                    label={SPECTRUM_LABELS[kind]}
                    keys={keys}
                    available={available}
                    shown={shown}
                    onShownChange={onShownChange}
                    title={`Show or hide the ${SPECTRUM_LABELS[kind].toLowerCase()} lines of ${g.label}`}
                  />
                  <CheckChips
                    options={GYRO_AXES.map((axis, i) => ({
                      value: keys[i] ?? spectrumTraceKey(g.sensor, kind, axis),
                      label: axis.toUpperCase(),
                      disabled: !available.has(keys[i] ?? spectrumTraceKey(g.sensor, kind, axis)),
                      title: `${SPECTRUM_LABELS[kind]}, ${axis.toUpperCase()} axis`
                    }))}
                    value={shown}
                    onChange={onShownChange}
                  />
                </div>
              )
            })}
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
    <CheckChips
      label="Notches"
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
      label="Axis"
      value={value}
      onChange={onChange}
      options={GYRO_AXES.map((a) => ({ value: a, label: a.toUpperCase() }))}
    />
  )
}

export interface GyroChipsProps {
  name: string
  label?: string
  gyros: readonly { sensor: number; label: string; disabled?: boolean }[]
  value: number
  onChange: (sensor: number) => void
}

/** Gyro (IMU) picker. */
export function GyroChips({ name, label, gyros, value, onChange }: GyroChipsProps) {
  return (
    <RadioChips
      name={name}
      label={label}
      value={`${value}`}
      onChange={(v) => onChange(Number(v))}
      options={gyros.map((g) => ({ value: `${g.sensor}`, label: g.label, disabled: g.disabled ?? false }))}
    />
  )
}
