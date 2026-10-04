/**
 * The Thrust Expo page as a state machine: what each input shows, the `params` values upstream
 * computes and saves from, the test stand table and the last plot update.
 *
 * Upstream keeps an input's displayed text and its `params` value apart, and several of its
 * results depend on that (docs/upstream-bugs.md):
 *
 * - `MOT_SPIN_MIN` updates its value only on `input` events (typing), where it is also held at or
 *   above `MOT_SPIN_ARM`; its `change` event only replots. Two proven upstream bugs are fixed here
 *   (docs/bug-proofs/thrust-expo.md): upstream compares the two texts as strings (here as numbers),
 *   and a `MOT_SPIN_MIN` loaded from a parameter file is shown but not used (here it is used).
 * - Every plot update writes the chosen expo (unrounded) to `params` and shows it to 3 decimals.
 * - `MOT_THST_HOVER` is saved once any estimate has been made, with the last value it was given,
 *   until Reset.
 *
 * Each exported event function is one upstream event handler; each returns a new session.
 */
import { paramToString } from '@apwt/ardupilot'
import { estimateHover, linearise, type HoverEstimate, type Linearisation, type SpinParams } from './linearisation.js'
import { INPUTS, type InputName, type MotorParamName } from './params.js'
import {
  EXAMPLE_ALL_UP_WEIGHT,
  EXAMPLE_SAMPLES,
  emptyRows,
  rowsFromSamples,
  thrustData,
  usableRows,
  type TableRow
} from './thrust-table.js'

/** index.html `.param-row input` ids, in document order: the inputs plus the read-only hover estimate. */
export const FIELD_NAMES = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX',
  'MOT_THST_EXPO',
  'MOTOR_COUNT',
  'MOT_THST_HOVER',
  'COPTER_AUW'
] as const satisfies readonly (InputName | 'MOT_THST_HOVER')[]
export type FieldName = (typeof FIELD_NAMES)[number]

/**
 * Upstream `params` with `save` set, in declaration order (the order of the file):
 * `MOT_THST_HOVER` only once estimated; `MOTOR_COUNT` and `COPTER_AUW` never.
 */
const SAVED_ORDER = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX',
  'MOT_THST_EXPO',
  'MOT_THST_HOVER'
] as const satisfies readonly (FieldName & MotorParamName)[]

export function isFieldName(name: string): name is FieldName {
  return (FIELD_NAMES as readonly string[]).includes(name)
}

/** Upstream `params[name].default`; `MOT_THST_HOVER` has none. */
function defaultValue(name: FieldName): number | null {
  return name === 'MOT_THST_HOVER' ? null : INPUTS[name].default
}

/** What the last plot update drew. */
export type PlotState =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'data'
      /** Usable table rows, unparsed: the PWM plot draws their raw values. */
      readonly rows: readonly TableRow[]
      readonly lin: Linearisation
      readonly hover: HoverEstimate | null
      /** Output range at the time of the update (spin markers and PWM axis). */
      readonly spin: SpinParams
    }

export interface ThrustExpoSession {
  /** Text each input shows (a browser number input's `value`). */
  readonly display: Readonly<Record<FieldName, string>>
  /** Upstream `params[name].value`. */
  readonly params: Readonly<Record<FieldName, number | null>>
  /** Upstream `params.MOT_THST_HOVER.save`. */
  readonly hoverSave: boolean
  readonly rows: readonly TableRow[]
  readonly plot: PlotState
  /** Increases with every event, so inputs re-sync their text even when it is unchanged. */
  readonly revision: number
  /** Error the last event stopped with (upstream throws and shows its error alert), or null. */
  readonly error: string | null
}

interface Draft {
  display: Record<FieldName, string>
  params: Record<FieldName, number | null>
  hoverSave: boolean
  rows: readonly TableRow[]
  plot: PlotState
  revision: number
  error: string | null
}

function draftOf(s: ThrustExpoSession): Draft {
  return { ...s, display: { ...s.display }, params: { ...s.params }, revision: s.revision + 1, error: null }
}

/** HTML "valid floating-point number", the only text a number input keeps. */
const VALID_FLOAT = /^-?(?:\d+|\d*\.\d+)(?:[eE][-+]?\d+)?$/

/** What a number input shows after `input.value = value` (anything else is sanitised to ""). */
export function numberInputText(value: number | string | null): string {
  const text = value === null ? '' : String(value)
  return VALID_FLOAT.test(text) ? text : ''
}

/** Upstream `params[name].value` of a number, for the computations (they are never null there). */
function num(d: Draft, name: FieldName): number {
  return d.params[name] ?? Number.NaN
}

/** Upstream `updatePlotData(thrustExpo)`: refit (or use the given expo), replot, re-estimate hover. */
function updatePlotData(d: Draft, thrustExpo: number | null): void {
  const usable = usableRows(d.rows)
  if (usable.length === 0) {
    // Upstream clears the plots but leaves the expo and hover inputs as they were.
    d.plot = { kind: 'empty' }
    return
  }
  const lin = linearise(
    thrustData(d.rows),
    {
      spinMin: num(d, 'MOT_SPIN_MIN'),
      spinMax: num(d, 'MOT_SPIN_MAX'),
      pwmMin: num(d, 'MOT_PWM_MIN'),
      pwmMax: num(d, 'MOT_PWM_MAX')
    },
    thrustExpo === null ? { kind: 'fit' } : { kind: 'fixed', expo: thrustExpo }
  )
  if (lin === null) throw new Error('unreachable: usable rows without data')

  d.params.MOT_THST_EXPO = lin.result.expo
  d.display.MOT_THST_EXPO = numberInputText(lin.result.expo.toFixed(3))

  d.display.MOT_THST_HOVER = ''
  const hover = estimateHover(lin, num(d, 'COPTER_AUW'), num(d, 'MOTOR_COUNT'))
  if (hover !== null) {
    d.params.MOT_THST_HOVER = hover.motThstHover
    d.hoverSave = true
    d.display.MOT_THST_HOVER = numberInputText(hover.motThstHover.toFixed(3))
  }

  d.plot = {
    kind: 'data',
    rows: usable,
    lin,
    hover,
    spin: {
      spinArm: num(d, 'MOT_SPIN_ARM'),
      spinMin: num(d, 'MOT_SPIN_MIN'),
      spinMax: num(d, 'MOT_SPIN_MAX'),
      pwmMin: num(d, 'MOT_PWM_MIN'),
      pwmMax: num(d, 'MOT_PWM_MAX')
    }
  }
}

/**
 * `MOT_SPIN_MIN` `input` handler: raise it to the arm value when below it, then store the value.
 * Proven upstream bug fixed: upstream compares the two texts as strings (so arm 10 lets min 2 stand,
 * and min ".2" is lowered to arm 0.1); here they are compared as numbers. With either box empty the
 * outcome is upstream's (an empty min takes the arm text, an empty arm never raises min).
 */
function spinMinInput(d: Draft): void {
  const min = d.display.MOT_SPIN_MIN
  const arm = d.display.MOT_SPIN_ARM
  const below = min === '' || arm === '' ? min < arm : Number.parseFloat(min) < Number.parseFloat(arm)
  if (below) d.display.MOT_SPIN_MIN = arm
  d.params.MOT_SPIN_MIN = Number.parseFloat(d.display.MOT_SPIN_MIN)
}

/** A `change` event on input `name`, whose text is already in `d.display`. */
function change(d: Draft, name: FieldName): void {
  const value = Number.parseFloat(d.display[name])
  switch (name) {
    case 'MOT_SPIN_ARM':
      d.params[name] = value
      spinMinInput(d)
      updatePlotData(d, null)
      return
    case 'MOT_SPIN_MIN':
      updatePlotData(d, null)
      return
    case 'MOT_THST_EXPO':
      d.params[name] = value
      updatePlotData(d, value)
      return
    case 'MOT_SPIN_MAX':
    case 'MOT_PWM_MIN':
    case 'MOT_PWM_MAX':
    case 'MOTOR_COUNT':
    case 'MOT_THST_HOVER':
    case 'COPTER_AUW':
      d.params[name] = value
      updatePlotData(d, null)
      return
  }
}

function resetDraft(d: Draft): void {
  d.hoverSave = false
  for (const name of FIELD_NAMES) {
    const value = defaultValue(name)
    d.display[name] = numberInputText(value)
    d.params[name] = value
  }
  d.rows = emptyRows()
  updatePlotData(d, null)
}

/** The page after loading (upstream resets once the table is built). */
export function createSession(): ThrustExpoSession {
  const display: Record<FieldName, string> = {
    MOT_SPIN_ARM: '',
    MOT_SPIN_MIN: '',
    MOT_SPIN_MAX: '',
    MOT_PWM_MIN: '',
    MOT_PWM_MAX: '',
    MOT_THST_EXPO: '',
    MOTOR_COUNT: '',
    MOT_THST_HOVER: '',
    COPTER_AUW: ''
  }
  const d: Draft = {
    display,
    params: nullParams(),
    hoverSave: false,
    rows: [],
    plot: { kind: 'empty' },
    revision: 0,
    error: null
  }
  resetDraft(d)
  return d
}

function nullParams(): Record<FieldName, number | null> {
  return {
    MOT_SPIN_ARM: null,
    MOT_SPIN_MIN: null,
    MOT_SPIN_MAX: null,
    MOT_PWM_MIN: null,
    MOT_PWM_MAX: null,
    MOT_THST_EXPO: null,
    MOTOR_COUNT: null,
    MOT_THST_HOVER: null,
    COPTER_AUW: null
  }
}

/** Reset button. */
export function reset(s: ThrustExpoSession): ThrustExpoSession {
  const d = draftOf(s)
  resetDraft(d)
  return d
}

/** The user committed `text` in an input (its `change` event: Enter, leaving the field or the spinner). */
export function commitInput(s: ThrustExpoSession, name: FieldName, text: string): ThrustExpoSession {
  const d = draftOf(s)
  d.display[name] = text
  change(d, name)
  return d
}

/** A keystroke in `MOT_SPIN_MIN` (its `input` event); `text` is the input's value. */
export function typeSpinMin(s: ThrustExpoSession, text: string): ThrustExpoSession {
  const d = draftOf(s)
  d.display.MOT_SPIN_MIN = text
  spinMinInput(d)
  return d
}

/**
 * Load a parameter file (upstream `loadParamFile`): split into lines on `\n`, each line on
 * commas; the first field is an element id as written (not trimmed) and the second its value,
 * read with `parseFloat`. For each line naming one of the inputs, the input's text is set and its
 * `change` handler runs, in file order. Other lines are ignored, except one naming the page's
 * file input (`paramFile`): setting a file input's value throws, so upstream stops there with
 * the earlier lines applied.
 */
export function loadParamFile(s: ThrustExpoSession, text: string): ThrustExpoSession {
  const d = draftOf(s)
  for (const line of text.split('\n')) {
    const [param = '', value] = line.split(',')
    if (param === FILE_INPUT_ID) {
      d.error = FILE_INPUT_ERROR
      break
    }
    if (!isFieldName(param)) continue
    d.display[param] = numberInputText(Number.parseFloat(String(value)))
    // Proven upstream bug fixed: upstream sets MOT_SPIN_MIN's value only on `input`, so a loaded
    // MOT_SPIN_MIN was shown but not used or saved (docs/bug-proofs/thrust-expo.md).
    if (param === 'MOT_SPIN_MIN') d.params.MOT_SPIN_MIN = Number.parseFloat(d.display.MOT_SPIN_MIN)
    change(d, param)
  }
  return d
}

/** Id of the page's parameter file input, which a parameter file line can name. */
const FILE_INPUT_ID = 'paramFile'
/** What the browser throws when a script sets a file input's value to anything but "". */
const FILE_INPUT_ERROR =
  "Failed to set the 'value' property on 'HTMLInputElement': This input element accepts a filename, which may only be programmatically set to the empty string."

/** Example button: example table, replot, then all-up weight 2.5 with its `change` event. */
export function loadExample(s: ThrustExpoSession): ThrustExpoSession {
  const d = draftOf(s)
  d.rows = rowsFromSamples(EXAMPLE_SAMPLES)
  updatePlotData(d, null)
  d.display.COPTER_AUW = numberInputText(EXAMPLE_ALL_UP_WEIGHT)
  change(d, 'COPTER_AUW')
  return d
}

/** The table data changed (upstream's debounced `dataChanged` handler replots and refits). */
export function setRows(s: ThrustExpoSession, rows: readonly TableRow[]): ThrustExpoSession {
  const d = draftOf(s)
  d.rows = rows
  updatePlotData(d, null)
  return d
}

/**
 * Fit to data button (convenience): the same `updatePlotData()` upstream runs after a change to
 * any input other than the expo.
 */
export function refit(s: ThrustExpoSession): ThrustExpoSession {
  const d = draftOf(s)
  updatePlotData(d, null)
  return d
}

/** Parameters the file will contain, in order, with their values. */
export function savedParams(s: ThrustExpoSession): { readonly name: MotorParamName; readonly value: number | null }[] {
  return SAVED_ORDER.filter((name) => name !== 'MOT_THST_HOVER' || s.hoverSave).map((name) => ({ name, value: s.params[name] }))
}

/**
 * Text of `ThrustExpo.param` (upstream `saveParamFile`): `NAME,value` lines, no trailing newline.
 *
 * @throws {Error} when a saved value is not a number (an empty input). Upstream's `param_to_string`
 *   throws "Could not convert NaN to float string" without saying which input; this message names
 *   the empty inputs and keeps upstream's text (docs/bug-proofs/thrust-expo.md).
 */
export function paramFileText(s: ThrustExpoSession): string {
  const saved = savedParams(s)
  const empty = saved.filter(({ value }) => value !== null && Number.isNaN(value)).map(({ name }) => name)
  if (empty.length > 0) {
    throw new Error(`${empty.join(', ')} ${empty.length > 1 ? 'are' : 'is'} empty. Could not convert NaN to float string`)
  }
  // `param_to_string(null)` is "0" upstream (Math.fround(null) is 0).
  return saved.map(({ name, value }) => `${name},${paramToString(value ?? 0)}`).join('\n')
}

/** File name upstream saves as. */
export const PARAM_FILE_NAME = 'ThrustExpo.param'
