import { Chip, ChipLabel, RadioChips } from '@apwt/tool-shell'
import type { BodeSettings, PidSettings } from '../analysis/settings.js'

export interface BodeChipsProps<S extends BodeSettings> {
  /** Distinguishes the radio groups of the two plots. */
  id: string
  settings: S
  onChange: (settings: S) => void
  componentsLabel: string
  /** Why the components option currently has no effect, if it has none (it stays settable, as upstream's checkbox). */
  componentsUnavailable?: string | undefined
}

/** Scale and component options for a Bode plot. */
export function BodeChips<S extends BodeSettings>({
  id,
  settings,
  onChange,
  componentsLabel,
  componentsUnavailable
}: BodeChipsProps<S>) {
  return (
    <>
      <ChipLabel>Magnitude</ChipLabel>
      <RadioChips
        name={`${id}-magnitude`}
        value={settings.magnitude}
        onChange={(magnitude) => onChange({ ...settings, magnitude })}
        options={[
          { value: 'dB', label: 'dB' },
          { value: 'linear', label: 'Linear' }
        ]}
      />
      <ChipLabel>Phase</ChipLabel>
      <RadioChips
        name={`${id}-phase`}
        value={settings.phase}
        onChange={(phase) => onChange({ ...settings, phase })}
        options={[
          { value: 'unwrapped', label: 'Unwrapped' },
          { value: 'wrapped', label: '±180°' }
        ]}
      />
      <ChipLabel>Frequency</ChipLabel>
      <RadioChips
        name={`${id}-freq-axis`}
        value={settings.frequencyAxis}
        onChange={(frequencyAxis) => onChange({ ...settings, frequencyAxis })}
        options={[
          { value: 'log', label: 'Log' },
          { value: 'linear', label: 'Linear' }
        ]}
      />
      <RadioChips
        name={`${id}-freq-unit`}
        value={settings.frequencyUnit}
        onChange={(frequencyUnit) => onChange({ ...settings, frequencyUnit })}
        options={[
          { value: 'Hz', label: 'Hz' },
          { value: 'RPM', label: 'RPM' }
        ]}
      />
      <div className="apwt-chips">
        <Chip
          type="checkbox"
          checked={settings.showComponents}
          title={componentsUnavailable}
          onChange={(showComponents) => onChange({ ...settings, showComponents })}
        >
          {componentsLabel}
        </Chip>
      </div>
    </>
  )
}

export interface FilteringChipsProps {
  settings: PidSettings
  onChange: (settings: PidSettings) => void
}

/** Whether the PID plot includes the gyro filters (upstream "Filtering: Pre / Post"). */
export function FilteringChips({ settings, onChange }: FilteringChipsProps) {
  return (
    <>
      <ChipLabel>Gyro filters</ChipLabel>
      <RadioChips
        name="pid-filtering"
        value={settings.filtering}
        onChange={(filtering) => onChange({ ...settings, filtering })}
        options={[
          { value: 'pre', label: 'Excluded' },
          { value: 'post', label: 'Included' }
        ]}
      />
    </>
  )
}
