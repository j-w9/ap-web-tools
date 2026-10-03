import { ControlGroup, RadioChips, RailCard } from '@apwt/tool-shell'
import { RotateCcw } from 'lucide-react'
import {
  PARAM_GROUPS,
  paramsInGroup,
  rangeHint,
  type Param,
  type ParamName,
  type ParamSpec,
  type ParamValues
} from '../analysis/params.js'
import { NumberField } from './NumberField.js'

export interface ParamRailProps {
  values: ParamValues
  onChange: (name: ParamName, value: number) => void
  onReset: () => void
  resetDisabled: boolean
}

function tooltip(spec: ParamSpec): string {
  return [spec.displayName, spec.description, rangeHint(spec)].filter((s) => s !== null).join('\n')
}

function ParamField({ spec, value, onChange }: { spec: Param; value: number; onChange: ParamRailProps['onChange'] }) {
  const name = spec.name
  switch (spec.kind) {
    case 'enum':
      return (
        <div className="scurve-param scurve-param--enum" title={tooltip(spec)}>
          <span className="scurve-param__name">{spec.name}</span>
          <RadioChips
            name={spec.name}
            options={spec.values.map((v) => ({ value: String(v.value), label: v.label }))}
            value={String(value)}
            onChange={(v) => onChange(name, Number(v))}
          />
        </div>
      )
    case 'number':
      return (
        <label className="apwt-field scurve-param" title={tooltip(spec)}>
          <span className="scurve-param__name">
            {spec.name}
            {spec.units !== undefined && <small>{spec.units}</small>}
          </span>
          <NumberField
            key={value}
            value={value}
            step={spec.increment ?? 'any'}
            ariaLabel={spec.displayName}
            onCommit={(v) => onChange(name, v)}
          />
        </label>
      )
  }
}

/** The rail: ArduPilot parameters that set the kinematic limits, grouped as upstream. */
export function ParamRail({ values, onChange, onReset, resetDisabled }: ParamRailProps) {
  return (
    <RailCard>
      {PARAM_GROUPS.map(({ group, label }) => (
        <ControlGroup key={group} label={label}>
          {paramsInGroup(group).map((spec) => (
            <ParamField key={spec.name} spec={spec} value={values[spec.name]} onChange={onChange} />
          ))}
        </ControlGroup>
      ))}
      <div className="apwt-group">
        <button type="button" className="apwt-btn apwt-btn--block" disabled={resetDisabled} onClick={onReset}>
          <RotateCcw />
          Reset to defaults
        </button>
      </div>
    </RailCard>
  )
}
