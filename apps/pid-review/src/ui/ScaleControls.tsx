export type AmplitudeScaleKind = 'linear' | 'dB' | 'psd'

export interface FrequencyScaleSettings {
  log: boolean
  rpm: boolean
}

export interface ScaleControlsProps {
  amplitude: AmplitudeScaleKind
  onAmplitudeChange: (kind: AmplitudeScaleKind) => void
  frequency: FrequencyScaleSettings
  onFrequencyChange: (settings: FrequencyScaleSettings) => void
}

function Radio<T extends string>(props: {
  name: string
  value: T
  current: T
  label: string
  onChange: (v: T) => void
}) {
  return (
    <label style={{ marginRight: 8 }}>
      <input
        type="radio"
        name={props.name}
        checked={props.current === props.value}
        onChange={() => props.onChange(props.value)}
      />{' '}
      {props.label}
    </label>
  )
}

/** Amplitude (linear / dB / PSD) and frequency (linear / log, Hz / RPM) scale selectors. */
export function ScaleControls({ amplitude, onAmplitudeChange, frequency, onFrequencyChange }: ScaleControlsProps) {
  const freqType = frequency.log ? 'log' : 'linear'
  const freqUnit = frequency.rpm ? 'rpm' : 'hz'
  return (
    <div className="apwt-row" style={{ marginLeft: 250 }}>
      <fieldset style={{ width: 300, height: 40 }}>
        <legend>Amplitude scale</legend>
        <Radio name="amp" value="linear" current={amplitude} label="Linear" onChange={onAmplitudeChange} />
        <Radio name="amp" value="dB" current={amplitude} label="dB" onChange={onAmplitudeChange} />
        <Radio name="amp" value="psd" current={amplitude} label="Power Spectral Density" onChange={onAmplitudeChange} />
      </fieldset>
      <fieldset style={{ width: 260, height: 40 }}>
        <legend>Frequency scale</legend>
        <Radio name="ftype" value="linear" current={freqType} label="Linear" onChange={() => onFrequencyChange({ ...frequency, log: false })} />
        <Radio name="ftype" value="log" current={freqType} label="Log" onChange={() => onFrequencyChange({ ...frequency, log: true })} />
        <span style={{ marginRight: 16 }} />
        <Radio name="funit" value="hz" current={freqUnit} label="Hz" onChange={() => onFrequencyChange({ ...frequency, rpm: false })} />
        <Radio name="funit" value="rpm" current={freqUnit} label="RPM" onChange={() => onFrequencyChange({ ...frequency, rpm: true })} />
      </fieldset>
    </div>
  )
}
