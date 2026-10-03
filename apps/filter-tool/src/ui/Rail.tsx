import { useRef } from 'react'
import { Download, Link, Upload } from 'lucide-react'
import { ControlGroup, RadioChips, RailCard } from '@apwt/tool-shell'
import { notchInputsEnabled, type TrackingSource } from '../analysis/config.js'
import {
  NOTCH_FIELDS,
  PID_AXES,
  PID_TERMS,
  notchParam,
  pidParam,
  type InputName,
  type Inputs,
  type NotchPrefix,
  type PidAxis,
  type SimInputName
} from '../analysis/params.js'
import { PARAM_METADATA } from '../analysis/metadata.js'
import { ParamField, PlainField } from './Fields.js'
import { RailGroup } from './RailGroup.js'
import { HARMONIC_BIT_LABELS, NOTCH_FIELD_LABELS, NOTCH_STEPS, PID_STEPS, PID_TERM_LABELS, SIM_INPUTS } from './field-specs.js'

export const AXIS_LABELS: Readonly<Record<PidAxis, string>> = { RLL: 'Roll', PIT: 'Pitch', YAW: 'Yaw' }

const NOTCH_TITLES: Readonly<Record<NotchPrefix, string>> = { INS_HNTCH: 'Harmonic notch 1', INS_HNTC2: 'Harmonic notch 2' }

/** A notch's state for its collapsed heading: off, or on with its tracking mode. */
function notchSummary(inputs: Inputs, prefix: NotchPrefix): string {
  if (!notchInputsEnabled(inputs, prefix)) return 'Off'
  const name = notchParam(prefix, 'MODE')
  const meta = PARAM_METADATA[name]
  const mode = meta.kind === 'values' ? meta.values.find((o) => o.value === inputs[name])?.label : undefined
  return mode === undefined ? 'On' : `On · ${mode}`
}

/** What the parameter file control last did. */
export type FileStatus = { readonly kind: 'idle' } | { readonly kind: 'loaded'; readonly name: string; readonly count: number }

export interface RailProps {
  inputs: Inputs
  onInput: (name: InputName, value: number) => void
  trackingSources: ReadonlySet<TrackingSource>
  axis: PidAxis
  onAxis: (axis: PidAxis) => void
  fileStatus: FileStatus
  onLoadFile: (file: File) => void
  onSaveFile: () => void
  linkCopied: boolean
  onCopyLink: (() => void) | null
}

/** The control rail: parameter file, gyro filters, both harmonic notches, tracking inputs and the rate PID. */
export function Rail(p: RailProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { inputs, onInput } = p
  const plain = (name: SimInputName) => {
    const s = SIM_INPUTS[name]
    return (
      <PlainField
        label={s.label}
        units={s.units}
        help={s.help}
        step={s.step}
        value={inputs[name]}
        onChange={(v) => onInput(name, v)}
      />
    )
  }

  const notchGroup = (prefix: NotchPrefix) => {
    const enabled = notchInputsEnabled(inputs, prefix)
    return (
      <RailGroup
        key={prefix}
        label={NOTCH_TITLES[prefix]}
        summary={notchSummary(inputs, prefix)}
        // A notch that is off starts folded; its Enable field is one click away.
        defaultOpen={enabled}
      >
        {NOTCH_FIELDS.map((field) => {
          const name = notchParam(prefix, field)
          return (
            <ParamField
              key={name}
              name={name}
              label={NOTCH_FIELD_LABELS[field]}
              value={inputs[name]}
              step={NOTCH_STEPS[field]}
              disabled={field !== 'ENABLE' && !enabled}
              onChange={onInput}
              {...(field === 'HMNCS' ? { bitLabels: HARMONIC_BIT_LABELS } : {})}
            />
          )
        })}
        {!enabled && <p className="ft-note">Set {prefix}_ENABLE to 1 to edit this notch.</p>}
      </RailGroup>
    )
  }

  const sources = p.trackingSources
  return (
    <RailCard>
      <ControlGroup label="Parameter file">
        <div className="ft-buttons">
          <button type="button" className="apwt-btn" onClick={() => fileRef.current?.click()}>
            <Upload />
            Load
          </button>
          <button type="button" className="apwt-btn" onClick={p.onSaveFile} title="Save the INS_ filter parameters">
            <Download />
            Save
          </button>
          <button
            type="button"
            className="apwt-btn"
            disabled={p.onCopyLink === null}
            onClick={p.onCopyLink ?? undefined}
            title="Copy a link to this exact setup"
          >
            <Link />
            {p.linkCopied ? 'Copied' : 'Copy link'}
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
        <p className="ft-note">
          {p.fileStatus.kind === 'loaded'
            ? `Read ${p.fileStatus.count} parameters from ${p.fileStatus.name}.`
            : 'Load a .param file or type values below. Hover a field for its full description.'}
        </p>
      </ControlGroup>

      <RailGroup label="Gyro">
        {plain('GyroSampleRate')}
        <ParamField
          name="INS_GYRO_FILTER"
          label="Low-pass cut-off"
          value={inputs.INS_GYRO_FILTER}
          step={0.1}
          onChange={onInput}
        />
      </RailGroup>

      {notchGroup('INS_HNTCH')}
      {notchGroup('INS_HNTC2')}

      {sources.size > 0 && (
        <RailGroup label="Tracking inputs">
          <p className="ft-note">Where the tracking notches sit for this simulation.</p>
          {sources.has('throttle') && (
            <>
              <p className="ft-subhead">Throttle based</p>
              {plain('Throttle')}
            </>
          )}
          {sources.has('esc') && (
            <>
              <p className="ft-subhead">ESC telemetry</p>
              {plain('NUM_MOTORS')}
              {plain('ESC_RPM')}
            </>
          )}
          {sources.has('rpm') && (
            <>
              <p className="ft-subhead">RPM/EFI based</p>
              {plain('RPM1')}
              {plain('RPM2')}
            </>
          )}
        </RailGroup>
      )}

      <RailGroup label="Rate controller" summary={AXIS_LABELS[p.axis]}>
        <ParamField
          name="SCHED_LOOP_RATE"
          label="Loop rate"
          value={inputs.SCHED_LOOP_RATE}
          step={1}
          freeValues
          onChange={onInput}
        />
        <p className="ft-subhead">Axis</p>
        <RadioChips
          name="pid-axis"
          value={p.axis}
          onChange={p.onAxis}
          options={PID_AXES.map((a) => ({ value: a, label: AXIS_LABELS[a] }))}
        />
        {PID_TERMS.map((term) => {
          const name = pidParam(p.axis, term)
          return (
            <ParamField
              key={name}
              name={name}
              label={PID_TERM_LABELS[term]}
              value={inputs[name]}
              step={PID_STEPS[term]}
              onChange={onInput}
            />
          )
        })}
      </RailGroup>
    </RailCard>
  )
}
