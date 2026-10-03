import { FFT_KEYS, KEY_LABELS, type FftKey } from '../analysis/keys.js'

export interface ComponentSelectorProps {
  /** Keys that have data for the selected controller. */
  enabled: ReadonlySet<FftKey>
  /** Keys currently shown on the spectrum plot. */
  shown: ReadonlySet<FftKey>
  onShownChange: (shown: ReadonlySet<FftKey>) => void
  loggingRateHz: number | null
  windowSize: number | null
}

const GROUPS: readonly { title: string; keys: readonly FftKey[] }[] = [
  { title: 'Inputs', keys: ['Tar', 'Act', 'Err'] },
  { title: 'Components', keys: ['P', 'I', 'D', 'FF', 'DFF'] },
  { title: 'Output', keys: ['Out'] }
]

/**
 * Checkboxes choosing which PID signals appear on the spectrum plot. Double-clicking a
 * group legend toggles the whole group (inverting the majority), as upstream does.
 */
export function ComponentSelector(p: ComponentSelectorProps) {
  const toggle = (key: FftKey, on: boolean) => {
    const next = new Set(p.shown)
    if (on) next.add(key)
    else next.delete(key)
    p.onShownChange(next)
  }
  const toggleGroup = (keys: readonly FftKey[]) => {
    const enabled = keys.filter((k) => p.enabled.has(k))
    const checked = enabled.filter((k) => p.shown.has(k)).length
    const on = checked < enabled.length * 0.5
    const next = new Set(p.shown)
    for (const k of enabled) {
      if (on) next.add(k)
      else next.delete(k)
    }
    p.onShownChange(next)
  }
  return (
    <fieldset>
      <legend>PID</legend>
      {GROUPS.map((g) => (
        <fieldset key={g.title} style={{ width: 215, marginBottom: 8 }}>
          <legend onDoubleClick={() => toggleGroup(g.keys)} style={{ cursor: 'pointer' }}>
            {g.title}
          </legend>
          {g.keys.map((k) => (
            <label key={k} style={{ marginRight: 8 }}>
              <input
                type="checkbox"
                disabled={!p.enabled.has(k)}
                checked={p.shown.has(k)}
                onChange={(e) => toggle(k, e.target.checked)}
              />{' '}
              {k === 'Out' ? 'PID + FF + D FF' : KEY_LABELS[k]}
            </label>
          ))}
        </fieldset>
      ))}
      Logging rate: <b>{p.loggingRateHz?.toFixed(2) ?? ''}</b> Hz
      <br />
      <br />
      Frequency resolution: <b>{p.loggingRateHz && p.windowSize ? (p.loggingRateHz / p.windowSize).toFixed(2) : ''}</b> Hz
    </fieldset>
  )
}

export interface SpectrogramComponentProps {
  enabled: ReadonlySet<FftKey>
  selected: FftKey
  onSelect: (key: FftKey) => void
}

/** Radio buttons choosing which PID signal the spectrogram shows. */
export function SpectrogramComponent({ enabled, selected, onSelect }: SpectrogramComponentProps) {
  return (
    <fieldset style={{ width: 500, height: 40, marginLeft: 375 }}>
      <legend>PID component</legend>
      {FFT_KEYS.map((k) => (
        <label key={k} style={{ marginRight: 8 }}>
          <input
            type="radio"
            name="spec"
            disabled={!enabled.has(k)}
            checked={selected === k}
            onChange={() => onSelect(k)}
          />{' '}
          {KEY_LABELS[k]}
        </label>
      ))}
    </fieldset>
  )
}
