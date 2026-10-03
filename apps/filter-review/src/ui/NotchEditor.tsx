import { CheckChips, Chip, ChipLabel } from '@apwt/tool-shell'
import type { NotchParams } from '../analysis/filter-params.js'
import { notchParamNames } from '../analysis/filter-params.js'
import { NumberField } from './NumberField.js'

/** `_MODE` values and what they track. */
const MODES = [
  { value: 0, label: 'Fixed frequency' },
  { value: 1, label: 'Throttle' },
  { value: 2, label: 'RPM sensor' },
  { value: 3, label: 'ESC telemetry' },
  { value: 4, label: 'Dynamic FFT' },
  { value: 5, label: 'Second RPM sensor' }
] as const

/** `_OPTS` bits. */
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

function bitsToSet(value: number, count: number): ReadonlySet<BitKey> {
  const out = new Set<BitKey>()
  for (let b = 0; b < count; b++) if ((value & (1 << b)) !== 0) out.add(bitKey(b))
  return out
}

function setToBits(set: ReadonlySet<BitKey>, previous: number, count: number): number {
  let value = previous
  for (let b = 0; b < count; b++) {
    if (set.has(bitKey(b))) value |= 1 << b
    else value &= ~(1 << b)
  }
  return value >>> 0
}

export interface NotchEditorProps {
  index: number
  params: NotchParams
  onChange: (params: NotchParams) => void
  /** 16 harmonics on newer firmware, 8 before. */
  harmonicCount: number
  /** Modes with tracking data in the log. */
  availableModes: ReadonlySet<number>
  disabled: boolean
}

/** Every parameter of one harmonic notch. */
export function NotchEditor({ index, params, onChange, harmonicCount, availableModes, disabled }: NotchEditorProps) {
  const names = notchParamNames(index)
  const set = <K extends keyof NotchParams>(key: K, value: NotchParams[K]) => onChange({ ...params, [key]: value })
  const off = disabled || params.enable <= 0
  const knownMode = MODES.some((m) => m.value === params.mode)

  return (
    <>
      <div className="apwt-chips">
        <Chip
          type="checkbox"
          checked={params.enable > 0}
          disabled={disabled}
          onChange={(on) => set('enable', on ? 1 : 0)}
          title={names.enable}
        >
          Enabled
        </Chip>
      </div>
      <label className="apwt-field" title={names.mode}>
        <span>Tracking</span>
        <select value={params.mode} disabled={off} onChange={(e) => set('mode', Number(e.target.value))}>
          {!knownMode && <option value={params.mode}>Unknown ({params.mode})</option>}
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
              {m.value !== 0 && !availableModes.has(m.value) ? ' (no data)' : ''}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="Frequency (Hz)"
        title={names.freq}
        value={params.freq}
        step={0.1}
        disabled={off}
        onChange={(v) => set('freq', v)}
      />
      <NumberField
        label="Bandwidth (Hz)"
        title={names.bandwidth}
        value={params.bandwidth}
        step={0.1}
        disabled={off}
        onChange={(v) => set('bandwidth', v)}
      />
      <NumberField
        label="Attenuation (dB)"
        title={names.attenuation}
        value={params.attenuation}
        step={0.1}
        disabled={off}
        onChange={(v) => set('attenuation', v)}
      />
      <NumberField
        label={referenceLabel(params.mode)}
        title={names.ref}
        value={params.ref}
        step={0.01}
        disabled={off}
        onChange={(v) => set('ref', v)}
      />
      <NumberField
        label="Min frequency ratio"
        title={names.minRatio}
        value={params.minRatio}
        step={0.01}
        disabled={off}
        onChange={(v) => set('minRatio', v)}
      />
      <div className="fr-subgroup" title={names.harmonics}>
        <ChipLabel>Harmonics</ChipLabel>
        <CheckChips
          options={Array.from({ length: harmonicCount }, (_, b) => ({ value: bitKey(b), label: String(b + 1), disabled: off }))}
          value={bitsToSet(params.harmonics, harmonicCount)}
          onChange={(s) => set('harmonics', setToBits(s, params.harmonics, harmonicCount))}
        />
      </div>
      <div className="fr-subgroup" title={names.options}>
        <ChipLabel>Options</ChipLabel>
        <CheckChips
          options={OPTION_BITS.map((o) => ({ value: bitKey(o.bit), label: o.label, disabled: off }))}
          value={bitsToSet(params.options, OPTION_BITS.length)}
          onChange={(s) => set('options', setToBits(s, params.options, OPTION_BITS.length))}
        />
      </div>
    </>
  )
}
