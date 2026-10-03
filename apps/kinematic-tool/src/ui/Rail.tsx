import { ControlGroup, RadioChips, RailCard } from '@apwt/tool-shell'
import {
  COPTER_PARAM_DOCS,
  PLANE_AXIS_PARAMS,
  PLANE_PARAM_DOCS,
  copterParamFields,
  type CopterParamName,
  type CopterParams,
  type ParamDoc,
  type ParamField,
  type PlaneParamName,
  type PlaneParams
} from '../analysis/params.js'
import {
  AXIS_NAMES,
  COPTER_AXES,
  COPTER_MODES,
  END_TIME_LIMITS,
  MODE_NAMES,
  PLANE_AXES,
  PLANE_MODES,
  usesAngle,
  usesRate,
  type CopterAxis,
  type CopterMode,
  type Demand,
  type PlaneAxis,
  type PlaneMode,
  type Vehicle
} from '../analysis/scenario.js'
import { NumberField } from './NumberField.js'

/** Per-vehicle choices; each vehicle keeps its own while the other is shown. */
export interface CopterChoices {
  axis: CopterAxis
  mode: CopterMode
  params: CopterParams
}

export interface PlaneChoices {
  axis: PlaneAxis
  mode: PlaneMode
  params: PlaneParams
}

export interface RailProps {
  vehicle: Vehicle
  onVehicleChange: (vehicle: Vehicle) => void
  copter: CopterChoices
  onCopterChange: (choices: CopterChoices) => void
  plane: PlaneChoices
  onPlaneChange: (choices: PlaneChoices) => void
  demand: Demand
  onDemandChange: (demand: Demand) => void
}

const VEHICLE_OPTIONS = [
  { value: 'copter', label: 'Copter' },
  { value: 'plane', label: 'Plane' }
] as const satisfies readonly { value: Vehicle; label: string }[]

const options = <T extends CopterAxis | CopterMode>(values: readonly T[], names: Readonly<Record<T, string>>) =>
  values.map((value) => ({ value, label: names[value] }))

function ParamFields<N extends string>(props: {
  fields: readonly ParamField<N>[]
  docs: ReadonlyMap<N, ParamDoc>
  values: Readonly<Record<N, number>>
  onChange: (name: N, value: number) => void
}) {
  return props.fields.map(({ name, enabled }) => {
    const doc = props.docs.get(name)
    return (
      <NumberField
        key={name}
        label={<span className="kt-param">{name}</span>}
        title={doc ? `${doc.displayName}: ${doc.description}` : undefined}
        value={props.values[name]}
        step={doc?.increment ?? undefined}
        suffix={doc?.units}
        disabled={!enabled}
        onChange={(v) => props.onChange(name, v)}
      />
    )
  })
}

function CopterControls({ choices, onChange }: { choices: CopterChoices; onChange: (c: CopterChoices) => void }) {
  return (
    <>
      <ControlGroup label="Axis">
        <RadioChips
          name="copter-axis"
          options={options(COPTER_AXES, AXIS_NAMES)}
          value={choices.axis}
          onChange={(axis) => onChange({ ...choices, axis })}
        />
      </ControlGroup>
      <ControlGroup label="Mode">
        <RadioChips
          name="copter-mode"
          options={options(COPTER_MODES, MODE_NAMES)}
          value={choices.mode}
          onChange={(mode) => onChange({ ...choices, mode })}
        />
      </ControlGroup>
    </>
  )
}

function PlaneControls({ choices, onChange }: { choices: PlaneChoices; onChange: (c: PlaneChoices) => void }) {
  return (
    <>
      <ControlGroup label="Axis">
        <RadioChips
          name="plane-axis"
          options={options(PLANE_AXES, AXIS_NAMES)}
          value={choices.axis}
          onChange={(axis) => onChange({ ...choices, axis })}
        />
      </ControlGroup>
      <ControlGroup label="Mode">
        <RadioChips
          name="plane-mode"
          options={options(PLANE_MODES, MODE_NAMES)}
          value={choices.mode}
          onChange={(mode) => onChange({ ...choices, mode })}
        />
      </ControlGroup>
    </>
  )
}

/** The control rail: vehicle, axis and mode, the demand, initial conditions and parameters. */
export function Rail(p: RailProps) {
  const mode = p.vehicle === 'copter' ? p.copter.mode : p.plane.mode
  const setDemand = (patch: Partial<Demand>) => p.onDemandChange({ ...p.demand, ...patch })

  return (
    <RailCard>
      <ControlGroup label="Vehicle">
        <RadioChips name="vehicle" options={VEHICLE_OPTIONS} value={p.vehicle} onChange={p.onVehicleChange} />
      </ControlGroup>

      {p.vehicle === 'copter' ? (
        <CopterControls choices={p.copter} onChange={p.onCopterChange} />
      ) : (
        <PlaneControls choices={p.plane} onChange={p.onPlaneChange} />
      )}

      <ControlGroup label="Inputs">
        <p className="kt-help">
          Desired angle and rate from the pilot or the {p.vehicle === 'copter' ? 'position' : 'navigation'} controller.
        </p>
        <NumberField
          label="Desired angle"
          suffix="deg"
          value={p.demand.desiredAngle}
          disabled={!usesAngle(mode)}
          onChange={(desiredAngle) => setDemand({ desiredAngle })}
        />
        <NumberField
          label="Desired rate"
          suffix="deg/s"
          value={p.demand.desiredRate}
          disabled={!usesRate(mode)}
          onChange={(desiredRate) => setDemand({ desiredRate })}
        />
        <NumberField
          label="End time"
          suffix="s"
          title="Minimum simulated time. The simulation always runs until the target is reached, then 0.5 s more."
          value={p.demand.endTime}
          min={END_TIME_LIMITS.min}
          max={END_TIME_LIMITS.max}
          step={END_TIME_LIMITS.step}
          onChange={(endTime) => setDemand({ endTime })}
        />
      </ControlGroup>

      <ControlGroup label="Initial conditions">
        <NumberField
          label="Starting angle"
          suffix="deg"
          value={p.demand.initialAngle}
          onChange={(initialAngle) => setDemand({ initialAngle })}
        />
        <NumberField
          label="Starting rate"
          suffix="deg/s"
          value={p.demand.initialRate}
          onChange={(initialRate) => setDemand({ initialRate })}
        />
      </ControlGroup>

      <ControlGroup label="Parameters">
        {p.vehicle === 'copter' ? (
          <>
            <p className="kt-help">
              Only valid with input shaping enabled by <code>ATC_RATE_FF_ENAB</code>. In some flight modes{' '}
              <code>ATC_SLEW_YAW</code> is a second yaw rate limit, and acro uses its own rate time constant.
            </p>
            <ParamFields<CopterParamName>
              fields={copterParamFields(p.copter.axis, p.copter.mode)}
              docs={COPTER_PARAM_DOCS}
              values={p.copter.params}
              onChange={(name, value) => p.onCopterChange({ ...p.copter, params: { ...p.copter.params, [name]: value } })}
            />
          </>
        ) : (
          <ParamFields<PlaneParamName>
            fields={PLANE_AXIS_PARAMS[p.plane.axis].map((name) => ({ name, enabled: true }))}
            docs={PLANE_PARAM_DOCS}
            values={p.plane.params}
            onChange={(name, value) => p.onPlaneChange({ ...p.plane, params: { ...p.plane.params, [name]: value } })}
          />
        )}
      </ControlGroup>
    </RailCard>
  )
}
