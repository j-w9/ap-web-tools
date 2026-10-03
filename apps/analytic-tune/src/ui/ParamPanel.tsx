import { useRef } from 'react'
import { Download, Upload } from 'lucide-react'
import { ControlGroup, RailCard } from '@apwt/tool-shell'
import { notchEnabled, selectedFilters, trackingSourcesInUse } from '../analysis/form.js'
import {
  FILTER_FIELDS,
  INPUT_STEPS,
  NOTCH_FIELDS,
  RATE_GAIN_TERMS,
  RATE_NOTCH_TERMS,
  controllerParams,
  filterParam,
  notchParam,
  type InputName,
  type Inputs,
  type NotchPrefix,
  type ParamName,
  type SimInputName,
  type TuneTarget
} from '../analysis/params.js'
import { ParamField, PlainField } from './Fields.js'
import {
  FILTER_FIELD_LABELS,
  HARMONIC_BIT_LABELS,
  INPUT_TC_LABELS,
  NOTCH_FIELD_LABELS,
  RATE_TERM_LABELS,
  SIM_INPUTS
} from './field-specs.js'

const NOTCH_TITLES: Readonly<Record<NotchPrefix, string>> = { INS_HNTCH: 'First notch filter', INS_HNTC2: 'Second notch filter' }

/** What the parameter file control last did. */
export type FileStatus =
  { readonly kind: 'idle' } | { readonly kind: 'loaded'; readonly name: string; readonly count: number; readonly ignored: number }

export interface ParamPanelProps {
  inputs: Inputs
  onInput: (name: InputName, value: number) => void
  /** Controller whose parameters to show; null for the unsupported fixed-wing yaw axis. */
  target: TuneTarget | null
  logLoaded: boolean
  fileStatus: FileStatus
  onLoadFile: (file: File) => void
  onSaveFile: () => void
}

/** Every modelled parameter for the current controller, editable with live recalculation. */
export function ParamPanel(p: ParamPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { inputs, onInput, target } = p
  const param = (name: ParamName, label: string, options: { disabled?: boolean; bitLabels?: readonly string[] } = {}) => (
    <ParamField
      key={name}
      name={name}
      label={label}
      value={inputs[name]}
      step={INPUT_STEPS[name]}
      onChange={onInput}
      disabled={options.disabled}
      {...(options.bitLabels ? { bitLabels: options.bitLabels } : {})}
    />
  )
  const plain = (name: SimInputName) => {
    const s = SIM_INPUTS[name]
    return (
      <PlainField
        key={name}
        label={s.label}
        units={s.units}
        help={s.help}
        step={INPUT_STEPS[name]}
        value={inputs[name]}
        onChange={(v) => onInput(name, v)}
      />
    )
  }

  const notchGroup = (prefix: NotchPrefix) => {
    const enabled = notchEnabled(inputs, prefix)
    return (
      <ControlGroup key={prefix} label={NOTCH_TITLES[prefix]}>
        {NOTCH_FIELDS.map((field) =>
          param(notchParam(prefix, field), NOTCH_FIELD_LABELS[field], {
            disabled: field !== 'ENABLE' && !enabled,
            ...(field === 'HMNCS' ? { bitLabels: HARMONIC_BIT_LABELS } : {})
          })
        )}
      </ControlGroup>
    )
  }

  const controller = target ? controllerParams(target) : null
  const sources = trackingSourcesInUse(inputs)
  return (
    <RailCard>
      <ControlGroup label="Parameters">
        <div className="at-buttons">
          <button type="button" className="apwt-btn" onClick={() => fileRef.current?.click()}>
            <Upload />
            Load
          </button>
          <button
            type="button"
            className="apwt-btn"
            onClick={p.onSaveFile}
            title="Save this controller's parameters with the INS_ filters"
          >
            <Download />
            Save
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".param,.parm,.txt"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) p.onLoadFile(file)
            e.target.value = ''
          }}
        />
        {p.fileStatus.kind === 'loaded' ? (
          <p className="at-note">
            Read {p.fileStatus.count} parameters from {p.fileStatus.name}
            {p.fileStatus.ignored > 0 && `, ignored ${p.fileStatus.ignored} the tool does not model`}.
          </p>
        ) : (
          <p className="at-note">Changes update the predicted response straight away. Hover a field for its description.</p>
        )}
        {p.logLoaded && (
          <p className="at-note at-note--warn">
            Values come from the end of the log. If parameters changed during the flight, check them here.
          </p>
        )}
      </ControlGroup>

      <ControlGroup label="INS settings">
        {plain('GyroSampleRate')}
        {param('INS_GYRO_FILTER', 'Gyro low-pass cut-off')}
      </ControlGroup>

      {notchGroup('INS_HNTCH')}
      {notchGroup('INS_HNTC2')}

      {sources.size > 0 && (
        <ControlGroup label="Notch tracking">
          <p className="at-note">Where the tracking notches sit for the prediction.</p>
          {sources.has('throttle') && (
            <>
              <p className="at-subhead">Throttle based</p>
              {plain('Throttle')}
            </>
          )}
          {sources.has('esc') && (
            <>
              <p className="at-subhead">ESC telemetry</p>
              {plain('NUM_MOTORS')}
              {plain('ESC_RPM')}
            </>
          )}
          {sources.has('rpm') && (
            <>
              <p className="at-subhead">RPM/EFI based</p>
              {plain('RPM1')}
              {plain('RPM2')}
            </>
          )}
        </ControlGroup>
      )}

      <ControlGroup label="Loop rate">{param('SCHED_LOOP_RATE', 'Main loop rate')}</ControlGroup>

      {target && controller ? (
        <>
          <ControlGroup label={`${target.axis} controller`}>
            {controller.inputTc && param(controller.inputTc, INPUT_TC_LABELS[controller.inputTc])}
            {param(controller.angle.param, controller.angle.kind === 'gain' ? 'Angle P gain' : 'Angle time constant')}
            {RATE_GAIN_TERMS.map((term) => param(controller.rate[term], RATE_TERM_LABELS[term]))}
          </ControlGroup>
          <ControlGroup label="Controller notches">
            {RATE_NOTCH_TERMS.map((term) => param(controller.rate[term], RATE_TERM_LABELS[term]))}
            {selectedFilters(inputs, target).map((index) => (
              <div key={index}>
                <p className="at-subhead">Notch filter {index}</p>
                {FILTER_FIELDS.map((field) => param(filterParam(index, field), FILTER_FIELD_LABELS[field]))}
              </div>
            ))}
          </ControlGroup>
        </>
      ) : (
        <ControlGroup label="Controller">
          <p className="at-note at-note--warn">Fixed-wing yaw has no rate controller model. Pick a roll or pitch run.</p>
        </ControlGroup>
      )}
    </RailCard>
  )
}
