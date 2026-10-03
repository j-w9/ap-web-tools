import { Grid3x3 } from 'lucide-react'
import { RadioChips } from '@apwt/tool-shell'
import { PRESET_IDS, PRESET_LABELS, type PresetChoice } from '../analysis/presets.js'
import type { Bound, Constraint, OutputFields, SignalFields, StateSpaceForm, StateSpaceMatrices } from '../analysis/setup.js'
import { MatrixTable } from './MatrixTable.js'
import { InputPicker, OutputPicker, type PickerContext } from './SignalPicker.js'

const PRESET_OPTIONS: readonly { value: PresetChoice; label: string }[] = (['manual', ...PRESET_IDS] as const).map((value) => ({
  value,
  label: PRESET_LABELS[value]
}))

export interface StateSpaceSetupProps {
  context: PickerContext
  form: StateSpaceForm
  /** Input 1 and each output as resolved for this form (see `readSlot`); `null` before generating. */
  input: SignalFields | null
  outputs: readonly (OutputFields | null)[]
  onFormChange: (form: StateSpaceForm) => void
  onInputChange: (fields: SignalFields) => void
  onOutputChange: (index: number, fields: OutputFields) => void
  onGenerate: () => void
}

type SizeKey = 'outputs' | 'order' | 'params' | 'constraints'

const SIZES: readonly { key: SizeKey; label: string }[] = [
  { key: 'outputs', label: 'Outputs' },
  { key: 'order', label: 'Matrix A order' },
  { key: 'params', label: 'Number of params' },
  { key: 'constraints', label: 'Number of constraints' }
]

const MATRICES: readonly { key: keyof StateSpaceMatrices; name: string; label: string }[] = [
  { key: 'a', name: 'A', label: 'Matrix A' },
  { key: 'b', name: 'B', label: 'Matrix B' },
  { key: 'h0', name: 'H0', label: 'H0' },
  { key: 'h1', name: 'H1', label: 'H1' }
]

/** Upstream state space form: preset, sizes, "Generate fields", then the generated fields. */
export function StateSpaceSetup(p: StateSpaceSetupProps) {
  const f = p.form
  const update = (patch: Partial<StateSpaceForm>) => p.onFormChange({ ...f, ...patch })
  const setBound = (i: number, bound: Bound) => update({ bounds: f.bounds.map((b, k) => (k === i ? bound : b)) })
  const setConstraint = (i: number, c: Constraint) =>
    update({ constraintFields: f.constraintFields.map((x, k) => (k === i ? c : x)) })
  const matrices = f.matrices

  return (
    <div className="sysid-setup">
      <div>
        <div className="sysid-picker__label">Enter fields or select to pre-populate fields</div>
        <RadioChips name="ss-preset" options={PRESET_OPTIONS} value={f.preset} onChange={(preset) => update({ preset })} />
      </div>

      <div className="sysid-sizes">
        {SIZES.map((s) => (
          <label key={s.key} className="apwt-field">
            <span>{s.label}</span>
            <input type="number" value={f[s.key]} onChange={(e) => update({ [s.key]: e.target.value })} />
          </label>
        ))}
        <button type="button" className="apwt-btn" onClick={p.onGenerate}>
          <Grid3x3 />
          Generate fields
        </button>
      </div>

      {(p.input || p.outputs.length > 0) && (
        <div className="sysid-pickers">
          {p.input && <InputPicker label="Input 1" context={p.context} fields={p.input} onChange={p.onInputChange} />}
          {p.outputs.map(
            (o, i) =>
              o && (
                <OutputPicker
                  key={i}
                  label={`Output ${i + 1}`}
                  context={p.context}
                  fields={o}
                  onChange={(fields) => p.onOutputChange(i, fields)}
                />
              )
          )}
        </div>
      )}

      {f.paramNames.length > 0 && (
        <div className="apwt-table-wrap">
          <table className="apwt-table sysid-params">
            <thead>
              <tr>
                <th>Param</th>
                <th>Name</th>
                <th>Bound min</th>
                <th>Bound max</th>
              </tr>
            </thead>
            <tbody>
              {f.paramNames.map((name, i) => {
                const bound = f.bounds[i] ?? { min: '', max: '' }
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        className="apwt-input"
                        aria-label={`Param ${i + 1}`}
                        value={name}
                        onChange={(e) => update({ paramNames: f.paramNames.map((n, k) => (k === i ? e.target.value : n)) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="apwt-input"
                        aria-label={`Bound ${i + 1} min`}
                        value={bound.min}
                        onChange={(e) => setBound(i, { ...bound, min: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="apwt-input"
                        aria-label={`Bound ${i + 1} max`}
                        value={bound.max}
                        onChange={(e) => setBound(i, { ...bound, max: e.target.value })}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {matrices && (
        <div className="sysid-matrices">
          {MATRICES.map((m) => (
            <MatrixTable
              key={m.key}
              name={m.name}
              label={m.label}
              matrix={matrices[m.key]}
              onChange={(matrix) => update({ matrices: { ...matrices, [m.key]: matrix } })}
            />
          ))}
        </div>
      )}

      {f.constraintFields.length > 0 && (
        <div className="sysid-constraints">
          <div className="sysid-picker__label">Constraints (parameter = parameter, or = -parameter)</div>
          {f.constraintFields.map((c, i) => (
            <div key={i} className="sysid-constraint">
              <span>Constraint {i + 1}</span>
              <input
                type="text"
                className="apwt-input"
                aria-label={`Constraint ${i + 1} A`}
                value={c.a}
                onChange={(e) => setConstraint(i, { ...c, a: e.target.value })}
              />
              <input
                type="text"
                className="apwt-input"
                aria-label={`Constraint ${i + 1} B`}
                value={c.b}
                onChange={(e) => setConstraint(i, { ...c, b: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
