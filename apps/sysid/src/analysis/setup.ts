/**
 * The identification setup the user edits, and how upstream's page changes it.
 *
 * Upstream builds its signal pickers as DOM fields with ids such as `input_name_1` and
 * `output_name_1`. The transfer function form and the state space form create fields with the
 * same ids, and `getElementById` returns the transfer function's, which come first in the page.
 * So once the transfer function form has been opened, the state space identification and its
 * presets use the transfer function's input and first output. This model keeps that rule in one
 * place ({@link sharedSlots}) so the same data is used.
 */
import { PRESETS, type PresetChoice, type PresetOutput } from './presets.js'
import type { CompensationAxis, OutputSource, SignalSource } from './prepare.js'

/** A message and field picker. Values follow `<select>` rules: '' when no option is selected. */
export interface SignalFields {
  readonly message: string
  readonly field: string
}

export interface OutputFields extends SignalFields {
  readonly multiplierOn: boolean
  readonly multiplier: string
  readonly compensationOn: boolean
  readonly compensationAxis: CompensationAxis
}

export interface TransferFunctionSignals {
  readonly input: SignalFields
  readonly output: OutputFields
}

export interface StateSpaceSignals {
  readonly input: SignalFields
  readonly outputs: readonly OutputFields[]
}

export type TextMatrix = readonly (readonly string[])[]

export interface StateSpaceMatrices {
  readonly a: TextMatrix
  readonly b: TextMatrix
  readonly h0: TextMatrix
  readonly h1: TextMatrix
}

export interface Bound {
  readonly min: string
  readonly max: string
}

export interface Constraint {
  readonly a: string
  readonly b: string
}

/** The state space form: size inputs, then the fields "Generate fields" creates. */
export interface StateSpaceForm {
  readonly preset: PresetChoice
  readonly outputs: string
  readonly order: string
  readonly params: string
  readonly constraints: string
  /** Signal fields, `null` until generated. */
  readonly signals: StateSpaceSignals | null
  readonly paramNames: readonly string[]
  readonly bounds: readonly Bound[]
  readonly constraintFields: readonly Constraint[]
  /** Matrix tables, `null` until generated with a valid order. */
  readonly matrices: StateSpaceMatrices | null
}

export interface TransferFunctionForm {
  readonly numerator: string
  readonly denominator: string
  readonly params: string
}

export type ModelType = 'transfer-function' | 'state-space'

export interface Setup {
  /** `null` until the user picks one, as upstream starts with neither radio checked. */
  readonly model: ModelType | null
  readonly startTime: string
  readonly endTime: string
  readonly startFreq: string
  readonly endFreq: string
  readonly cutoffFreq: string
  /** Transfer function signal fields, `null` until that form is first opened. */
  readonly tfSignals: TransferFunctionSignals | null
  readonly tf: TransferFunctionForm
  readonly ss: StateSpaceForm
}

/** What the pickers can offer: the loaded log's messages, or nothing before a log is loaded. */
export interface PickerOptions {
  readonly loaded: boolean
  readonly fieldsOf: (message: string) => readonly string[] | undefined
  readonly hasMessage: (message: string) => boolean
}

export const NO_LOG: PickerOptions = { loaded: false, fieldsOf: () => undefined, hasMessage: () => false }

export const NONE = 'None'

export const INITIAL_SETUP: Setup = {
  model: null,
  startTime: '0',
  endTime: '0',
  startFreq: '',
  endFreq: '',
  cutoffFreq: '',
  tfSignals: null,
  tf: { numerator: '', denominator: '', params: '' },
  ss: {
    preset: 'manual',
    outputs: '',
    order: '',
    params: '',
    constraints: '',
    signals: null,
    paramNames: [],
    bounds: [],
    constraintFields: [],
    matrices: null
  }
}

// ---------- Picker values ----------

/** A new, empty picker: "None" selected once a log has filled the options, else nothing. */
export function newSignal(options: PickerOptions): SignalFields {
  const value = options.loaded ? NONE : ''
  return { message: value, field: value }
}

export function newOutput(options: PickerOptions): OutputFields {
  return { ...newSignal(options), multiplierOn: false, multiplier: '', compensationOn: false, compensationAxis: 'Roll' }
}

/** Field options of a picker once its message is chosen: "None" then the message's fields. */
export function fieldOptions(options: PickerOptions, message: string): readonly string[] {
  if (!options.loaded) return []
  return [NONE, ...(options.fieldsOf(message) ?? [])]
}

export function messageOptions(options: PickerOptions, messages: readonly string[]): readonly string[] {
  return options.loaded ? [NONE, ...messages] : []
}

/** Picking a message resets the field to "None", as upstream's `onchange` rebuilds its options. */
export function withMessage<T extends SignalFields>(signal: T, message: string): T {
  return { ...signal, message, field: NONE }
}

/** Fill the pickers of a newly loaded log: empty ones now show "None"; chosen values stay. */
export function onLogLoaded(setup: Setup): Setup {
  const fill = <T extends SignalFields>(s: T): T => ({
    ...s,
    message: s.message === '' ? NONE : s.message,
    field: s.field === '' ? NONE : s.field
  })
  return {
    ...setup,
    tfSignals: setup.tfSignals && { input: fill(setup.tfSignals.input), output: fill(setup.tfSignals.output) },
    ss: {
      ...setup.ss,
      signals: setup.ss.signals && { input: fill(setup.ss.signals.input), outputs: setup.ss.signals.outputs.map(fill) }
    }
  }
}

// ---------- Mode switching ----------

/** Upstream radio change handlers: opening a form recreates its fields. */
export function selectModel(setup: Setup, model: ModelType, options: PickerOptions): Setup {
  if (model === setup.model) return setup
  switch (model) {
    case 'transfer-function':
      return { ...setup, model, tfSignals: { input: newSignal(options), output: newOutput(options) } }
    case 'state-space':
      // The preset dropdown is recreated (back to manual); generated fields are kept.
      return { ...setup, model, ss: { ...setup.ss, preset: 'manual' } }
  }
}

// ---------- The input and output slots, resolved as upstream's getElementById does ----------

export type Slot = { readonly kind: 'input' } | { readonly kind: 'output'; readonly index: number }

/** Which form's fields a slot resolves to: the transfer function's when it has that slot. */
export function slotOwner(setup: Setup, slot: Slot): 'tf' | 'ss' {
  const tfHasSlot = setup.tfSignals !== null && (slot.kind === 'input' || slot.index === 0)
  return tfHasSlot ? 'tf' : 'ss'
}

/** The fields a slot resolves to, or `undefined` where upstream finds no element. */
export function readSlot(setup: Setup, slot: { kind: 'input' }): SignalFields | undefined
export function readSlot(setup: Setup, slot: { kind: 'output'; index: number }): OutputFields | undefined
export function readSlot(setup: Setup, slot: Slot): SignalFields | OutputFields | undefined {
  const tf = setup.tfSignals
  if (slotOwner(setup, slot) === 'tf' && tf) return slot.kind === 'input' ? tf.input : tf.output
  const ss = setup.ss.signals
  if (!ss) return undefined
  return slot.kind === 'input' ? ss.input : ss.outputs[slot.index]
}

/** Replace the fields a slot resolves to. */
export function writeSlot(setup: Setup, slot: Slot, update: (fields: OutputFields) => OutputFields): Setup {
  const tf = setup.tfSignals
  if (slotOwner(setup, slot) === 'tf' && tf) {
    return slot.kind === 'input'
      ? { ...setup, tfSignals: { ...tf, input: signalOnly(update(asOutput(tf.input))) } }
      : { ...setup, tfSignals: { ...tf, output: update(tf.output) } }
  }
  const ss = setup.ss.signals
  if (!ss) return setup
  const signals: StateSpaceSignals =
    slot.kind === 'input'
      ? { ...ss, input: signalOnly(update(asOutput(ss.input))) }
      : { ...ss, outputs: ss.outputs.map((o, i) => (i === slot.index ? update(o) : o)) }
  return { ...setup, ss: { ...setup.ss, signals } }
}

function asOutput(signal: SignalFields): OutputFields {
  return { ...signal, multiplierOn: false, multiplier: '', compensationOn: false, compensationAxis: 'Roll' }
}

function signalOnly(fields: OutputFields): SignalFields {
  return { message: fields.message, field: fields.field }
}

/** Signal fields as the data preparation reads them (`getFieldValues`, values trimmed). */
export function inputSource(fields: SignalFields): SignalSource {
  return { message: fields.message.trim(), field: fields.field.trim() }
}

export function outputSource(fields: OutputFields): OutputSource {
  return {
    ...inputSource(fields),
    multiplier: fields.multiplierOn ? fields.multiplier.trim() : null,
    compensation: fields.compensationOn ? fields.compensationAxis : null
  }
}

// ---------- "Generate fields" ----------

/** Upstream's alert text for bad sizes, shown in the page. */
export const SIZE_ALERT = 'Please enter valid numbers for inputs and outputs.'

export interface GenerateOutcome {
  readonly setup: Setup
  /** In-page replacement for upstream's `alert()`. */
  readonly alert: string | null
  /** Set where upstream throws part way (a preset with no log loaded); the setup holds what was done. */
  readonly error: string | null
}

function emptyMatrix(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () => new Array<string>(cols).fill(''))
}

function count(n: number): number {
  return Number.isNaN(n) ? 0 : Math.max(0, n)
}

/** `select.value = v`: keeps `v` only if it is one of the options. */
function selectValue(options: readonly string[], value: string): string {
  return options.includes(value) ? value : ''
}

/** Upstream `set_select` / `input.onchange()` then setting the field: the field must be offered. */
function choose<T extends SignalFields>(fields: T, message: string, field: string, options: PickerOptions): T {
  const m = selectValue(messageOptions(options, options.hasMessage(message) ? [message] : []), message)
  return { ...fields, message: m, field: selectValue(fieldOptions(options, m), field) }
}

function applyPresetOutput(fields: OutputFields, preset: PresetOutput, options: PickerOptions): OutputFields {
  let out = choose(fields, preset.message, preset.field, options)
  if (preset.multiplier !== undefined) out = { ...out, multiplierOn: true, multiplier: preset.multiplier }
  if (preset.compensation !== undefined) out = { ...out, compensationOn: true, compensationAxis: preset.compensation }
  return out
}

/**
 * Upstream's "Generate fields" handler. A preset first writes the sizes; the signal, parameter,
 * bound and constraint fields are recreated from the sizes and the preset fills them; only then is
 * the matrix order checked, so a bad order leaves the previous matrix tables in place.
 */
export function generateFields(setup: Setup, options: PickerOptions): GenerateOutcome {
  const presetId = setup.ss.preset
  const preset = presetId === 'manual' ? null : PRESETS[presetId]
  let ss: StateSpaceForm = preset
    ? {
        ...setup.ss,
        outputs: preset.sizes.outputs,
        params: preset.sizes.params,
        order: preset.sizes.order,
        constraints: preset.sizes.constraints
      }
    : setup.ss

  const numOutputs = parseInt(ss.outputs, 10)
  const numParams = parseInt(ss.params, 10)
  const numConstraints = parseInt(ss.constraints, 10)

  // Upstream: `populate == "manual" && isNaN(numOutputs) || numOutputs <= 0`.
  if ((presetId === 'manual' && Number.isNaN(numOutputs)) || numOutputs <= 0) {
    return { setup: { ...setup, ss }, alert: SIZE_ALERT, error: null }
  }

  ss = {
    ...ss,
    signals: { input: newSignal(options), outputs: Array.from({ length: count(numOutputs) }, () => newOutput(options)) },
    paramNames: new Array<string>(count(numParams)).fill(''),
    bounds: Array.from({ length: count(numParams) }, () => ({ min: '', max: '' })),
    constraintFields: Array.from({ length: count(numConstraints) }, () => ({ a: '', b: '' }))
  }
  let next: Setup = { ...setup, ss }

  if (preset) {
    next = {
      ...next,
      ss: {
        ...next.ss,
        paramNames: next.ss.paramNames.map((name, i) => preset.params[i] ?? name),
        constraintFields: next.ss.constraintFields.map((c, i) => {
          const p = preset.constraints[i]
          return p ? { a: p[0], b: p[1] } : c
        })
      }
    }
    // `input.onchange()` is only installed once a log has filled the pickers; without one upstream throws here.
    if (!options.loaded) {
      return { setup: next, alert: null, error: 'Load a log before generating preset fields: the presets pick messages from it.' }
    }
    next = writeSlot(next, { kind: 'input' }, (f) => choose(f, preset.input.message, preset.input.field, options))
    preset.outputs.forEach((output, index) => {
      next = writeSlot(next, { kind: 'output', index }, (f) => applyPresetOutput(f, output, options))
    })
  }

  const order = parseInt(next.ss.order, 10)
  if (Number.isNaN(order) || order < 1) return { setup: next, alert: SIZE_ALERT, error: null }

  let matrices: StateSpaceMatrices = {
    a: emptyMatrix(order, order),
    b: emptyMatrix(order, 1),
    h0: emptyMatrix(count(numOutputs), order),
    h1: emptyMatrix(count(numOutputs), order)
  }
  let bounds = next.ss.bounds
  if (preset) {
    matrices = { a: preset.a, b: preset.b, h0: preset.h0, h1: preset.h1 }
    bounds = bounds.map((b, i) => {
      const p = preset.bounds[i]
      return p ? { min: p[0], max: p[1] } : b
    })
  }
  return { setup: { ...next, ss: { ...next.ss, matrices, bounds } }, alert: null, error: null }
}
