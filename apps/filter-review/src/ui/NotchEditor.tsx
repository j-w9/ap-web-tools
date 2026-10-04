import { CheckChips, Chip, ChipLabel } from '@apwt/tool-shell'
import {
  bitmaskBits,
  bitmaskFromBits,
  notchInputName,
  pageNumber,
  type FilterParamName,
  type PageValues
} from '../analysis/page-values.js'
import { TextNumberField } from './NumberField.js'

/** `_MODE` values and what they track (the drop-down options upstream builds from `params.json`). */
const MODES = [
  { value: '0', label: 'Fixed frequency' },
  { value: '1', label: 'Throttle' },
  { value: '2', label: 'RPM sensor' },
  { value: '3', label: 'ESC telemetry' },
  { value: '4', label: 'Dynamic FFT' },
  { value: '5', label: 'Second RPM sensor' }
] as const

/** `_OPTS` bits offered by `params.json`. */
const OPTION_BITS = [
  { bit: 0, label: 'Double notch' },
  { bit: 1, label: 'Multi-source' },
  { bit: 2, label: 'Update at loop rate' },
  { bit: 3, label: 'All IMUs' },
  { bit: 4, label: 'Triple notch' },
  { bit: 5, label: 'Min freq on RPM failure' },
  { bit: 6, label: 'Quintuple notch' }
] as const

/** `_REF` meaning per mode, shown as the field label. */
function referenceLabel(mode: number): string {
  switch (mode) {
    case 1:
      return 'Hover throttle'
    case 2:
    case 5:
      return 'RPM scale'
    default:
      return 'Reference'
  }
}

type BitKey = `${number}`

const bitKey = (bit: number): BitKey => `${bit}`

/** Ticked bits, as upstream sets its checkboxes from the input value. */
function bitsToSet(value: number, bits: readonly number[]): ReadonlySet<BitKey> {
  const out = new Set<BitKey>()
  for (const b of bits) if ((value & (1 << b)) !== 0) out.add(bitKey(b))
  return out
}

export interface NotchEditorProps {
  index: number
  values: PageValues
  onChange: (name: FilterParamName, value: string | number) => void
  /** Whether `_HMNCS` is 32-bit (16 harmonics shown) rather than 8-bit. */
  sixteenHarmonics: boolean
  /** Modes with tracking data in the log. */
  availableModes: ReadonlySet<number>
  disabled: boolean
}

/** Every parameter of one harmonic notch, holding the input strings upstream's page holds. */
export function NotchEditor({ index, values, onChange, sixteenHarmonics, availableModes, disabled }: NotchEditorProps) {
  const name = (key: Parameters<typeof notchInputName>[1]): FilterParamName => notchInputName(index, key)
  const enable = name('enable')
  const mode = name('mode')
  const harmonics = name('harmonics')
  const options = name('options')
  // Upstream filter_param_read disables the group unless parseFloat(_ENABLE) > 0
  const off = disabled || !(parseFloat(values[enable]) > 0)
  const harmonicBits = Array.from({ length: sixteenHarmonics ? 16 : 8 }, (_, b) => b)
  const optionBits = OPTION_BITS.map((o) => o.bit)

  const numberField = (key: 'freq' | 'bandwidth' | 'attenuation' | 'ref' | 'minRatio', label: string, step: number) => (
    <TextNumberField
      label={label}
      title={name(key)}
      value={values[name(key)]}
      step={step}
      disabled={off}
      onChange={(v) => onChange(name(key), v)}
    />
  )

  return (
    <>
      <div className="apwt-chips">
        <Chip
          type="checkbox"
          checked={parseFloat(values[enable]) > 0}
          disabled={disabled}
          onChange={(on) => onChange(enable, on ? 1 : 0)}
          title={enable}
        >
          Enabled
        </Chip>
      </div>
      <label className="apwt-field" title={mode}>
        <span>Tracking</span>
        <select value={values[mode]} disabled={off} onChange={(e) => onChange(mode, e.target.value)}>
          {!MODES.some((m) => m.value === values[mode]) && <option value={values[mode]}>{values[mode]}</option>}
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
              {m.value !== '0' && !availableModes.has(Number(m.value)) ? ' (no data)' : ''}
            </option>
          ))}
        </select>
      </label>
      {numberField('freq', 'Frequency (Hz)', 0.1)}
      {numberField('bandwidth', 'Bandwidth (Hz)', 0.1)}
      {numberField('attenuation', 'Attenuation (dB)', 0.1)}
      {numberField('ref', referenceLabel(parseFloat(values[mode])), 0.01)}
      {numberField('minRatio', 'Min frequency ratio', 0.01)}
      <div className="fr-subgroup" title={harmonics}>
        <ChipLabel>Harmonics</ChipLabel>
        <CheckChips
          options={harmonicBits.map((b) => ({ value: bitKey(b), label: String(b + 1), disabled: off }))}
          value={bitsToSet(pageNumber(values, harmonics, sixteenHarmonics), harmonicBits)}
          onChange={(s) =>
            onChange(
              harmonics,
              bitmaskFromBits(
                [...s].map((k) => Number(k)),
                bitmaskBits(harmonics, sixteenHarmonics) ?? 32
              )
            )
          }
        />
        <TextNumberField
          label="Value"
          title={harmonics}
          value={values[harmonics]}
          step={1}
          disabled={off}
          onChange={(v) => onChange(harmonics, v)}
        />
      </div>
      <div className="fr-subgroup" title={options}>
        <ChipLabel>Options</ChipLabel>
        <CheckChips
          options={OPTION_BITS.map((o) => ({ value: bitKey(o.bit), label: o.label, disabled: off }))}
          value={bitsToSet(pageNumber(values, options, sixteenHarmonics), optionBits)}
          onChange={(s) =>
            onChange(
              options,
              bitmaskFromBits(
                [...s].map((k) => Number(k)),
                32
              )
            )
          }
        />
        <TextNumberField
          label="Value"
          title={options}
          value={values[options]}
          step={1}
          disabled={off}
          onChange={(v) => onChange(options, v)}
        />
      </div>
    </>
  )
}
