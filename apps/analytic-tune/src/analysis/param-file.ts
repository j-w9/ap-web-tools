/**
 * Saving and loading `.param` files, and reading settings from the page URL. Ported from upstream
 * `save_parameters`, `load_parameters` and `load`.
 */
import { paramToString } from '@apwt/ardupilot'
import type { ControlLoop, DisplaySettings } from './display.js'
import { inputValueFromNumber, inputValueFromText, isDropDown, isValidFloatText } from './form-values.js'
import {
  INPUT_NAMES,
  controllerParams,
  isInputName,
  targetPrefixes,
  type InputName,
  type Inputs,
  type TuneTarget
} from './params.js'

/**
 * The inputs upstream saves for the target, in upstream's order: input shaping (roll and pitch
 * `INPUT_` or yaw pilot rate), the rate and angle controllers, the `FILTn_` notches the rate
 * controller selects, every `INS_` and `SCHED_` parameter.
 */
export function savedParamNames(inputs: Inputs, target: TuneTarget): InputName[] {
  const prefix = targetPrefixes(target)
  const rate = controllerParams(target).rate
  const nef = inputs[rate.NEF]
  const ntf = inputs[rate.NTF]
  const rollPitch = target.axis === 'Roll' || target.axis === 'Pitch'

  const select = (name: InputName): InputName[] => {
    const out: InputName[] = []
    if (name.startsWith(prefix.atc + 'INPUT_') && rollPitch) out.push(name)
    if (name.startsWith(prefix.pilot) && target.axis === 'Yaw') out.push(name)
    if (name.startsWith(prefix.rate)) out.push(name)
    if (name.startsWith(prefix.angle)) out.push(name)
    if (nef > 0 && name.startsWith(`FILT${nef}_`)) out.push(name)
    if (ntf > 0 && nef !== ntf && name.startsWith(`FILT${ntf}_`)) out.push(name)
    if (name.startsWith('INS_')) out.push(name)
    if (name.startsWith('SCHED_')) out.push(name)
    return out
  }
  return [...INPUT_NAMES.filter((n) => !isDropDown(n)), ...INPUT_NAMES.filter(isDropDown)].flatMap(select)
}

/**
 * `.param` text for the target (upstream `save_parameters`, saved as `filter.param`). An empty
 * (NaN) input is saved as 0: upstream passes the input's empty text to `param_to_string`, where
 * `Math.fround("")` is 0.
 */
export function saveParamText(inputs: Inputs, target: TuneTarget): string {
  return savedParamNames(inputs, target)
    .map((name) => {
      const value = inputs[name]
      return name + ',' + paramToString(Number.isNaN(value) ? 0 : value) + '\n'
    })
    .join('')
}

/**
 * What upstream's save does for fixed-wing yaw, which has no target here: its pilot-rate prefix
 * is empty there, so every element of the form matches, including the harmonic bitmask
 * check boxes, whose value "on" `param_to_string` cannot convert. It throws this and saves nothing.
 */
export const FIXED_WING_YAW_SAVE_ERROR = 'Could not convert on to float string'

/** What loading a `.param` file sets, as upstream `load_parameters` sets page elements by id. */
export interface LoadedParamFile {
  /** Inputs set, with the value upstream reads back (NaN where the element empties itself). */
  readonly values: ReadonlyMap<InputName, number>
  /** FFT window size text, when the file names `FFTWindow_size`. */
  readonly windowSizeText?: string
  /** Analysis start and end time (s), when the file names `starttime` or `endtime`. */
  readonly startTime?: number
  readonly endTime?: number
  /** "Use attitude" check box, when the file names an element of its fieldset. */
  readonly useAttitude?: boolean
  /** Lines naming no element of upstream's page, or one that cannot take the value (a file input). */
  readonly ignored: number
}

/**
 * Elements of upstream's "Control Loop" fieldset. `parameter_set_value` also sets every check box
 * in the element's parent as a bitmask bit; the only one there is "UseAttitude", whose missing
 * bit number makes the mask `1 << NaN`, which is 1.
 */
const CONTROL_LOOP_FIELDSET_IDS: ReadonlySet<string> = new Set([
  'type_Bare_AC',
  'UseAttitude',
  'type_Rate_Ctrlr',
  'type_Att_Ctrlr',
  'type_Att_Ctrlr_nff',
  'type_Pilot_Ctrlr',
  'type_Att_DRB',
  'type_Rate_Stab',
  'type_Att_Stab',
  'type_Sys_Stab'
])

/** Other elements of upstream's page whose value can be set without changing any result. */
const INERT_IDS: ReadonlySet<string> = new Set([
  'YAW_RATE_NTF',
  'YAW_RATE_NEF',
  'calculate',
  'SaveParams',
  'PID_ScaleLog',
  'PID_ScaleLinear',
  'PID_ScaleUnWrap',
  'PID_ScaleWrap',
  'PID_freq_ScaleLog',
  'PID_freq_ScaleLinear',
  'PID_freq_Scale_Hz',
  'PID_freq_Scale_RPS'
])

const FILE_INPUT_IDS: ReadonlySet<string> = new Set(['fileItem', 'param_file'])

/**
 * Read a `.param` file as upstream `load_parameters` does: split on newlines, split each line on
 * runs of whitespace, commas and `=`, and for lines with at least two fields set the element whose
 * id is the first field to the second field's text. Nothing is trimmed, so an indented line has an
 * empty first field and sets nothing; text a number input or drop-down cannot hold empties it,
 * which reads as NaN (but see `inputValueFromText` for drop-downs).
 */
export function loadParamText(text: string): LoadedParamFile {
  const values = new Map<InputName, number>()
  const result: { -readonly [K in keyof LoadedParamFile]: LoadedParamFile[K] } = { values, ignored: 0 }
  for (const line of text.split('\n')) {
    const v = line.split(/[\s,=\t]+/)
    if (v.length < 2) continue
    const name = v[0]!
    const value = v[1]!
    if (isInputName(name)) {
      values.set(name, inputValueFromText(name, value))
    } else if (name === 'FFTWindow_size') {
      result.windowSizeText = isValidFloatText(value) ? value : ''
    } else if (name === 'starttime' || name === 'endtime') {
      // Upstream multiplies the trimmed text by 1e6; empty text is 0.
      const time = isValidFloatText(value) ? parseFloat(value) : 0
      if (name === 'starttime') result.startTime = time
      else result.endTime = time
    } else if (CONTROL_LOOP_FIELDSET_IDS.has(name)) {
      result.useAttitude = (Number(value) & 1) !== 0
    } else if (FILE_INPUT_IDS.has(name)) {
      // A file input only accepts an empty value. Proven upstream bug, fixed
      // (docs/bug-proofs/analytic-tune.md, row 117): upstream's setter throws for any other value,
      // which aborts the rest of the file although the loop is written to skip lines it cannot
      // apply. The port skips the line and carries on.
      if (value !== '') result.ignored++
    } else if (!INERT_IDS.has(name)) {
      result.ignored++
    }
  }
  return result
}

// ---------- URL ----------

/** Upstream radio values of each graph setting, lower case. */
const LOOP_VALUES: Readonly<Record<string, ControlLoop>> = {
  bare_ac: 'bare-aircraft',
  rate_ctrlr: 'rate',
  att_ctrlr: 'attitude-feedforward',
  att_ctrlr_nff: 'attitude-no-feedforward',
  pilot_ctrlr: 'input-shaping',
  att_drb: 'disturbance-rejection',
  rate_stab: 'rate-stability',
  att_stab: 'attitude-stability',
  sys_stab: 'system-stability'
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Settings given in the page URL. */
export interface UrlSettings {
  readonly inputs: ReadonlyMap<InputName, number>
  readonly display: Partial<DisplaySettings>
}

/**
 * Inputs and graph settings from URL query parameters (upstream `load`): names are matched
 * ignoring case, numbers with `parseFloat`, radios by value and the attitude checkbox by `true`.
 *
 * Upstream runs this on page load while its metadata loader may still be replacing the
 * enumerated parameters' inputs with drop-downs: if it has not yet, the value is copied into the
 * drop-down (kept only if it is an option); if it has, the drop-down is not an `input` and the
 * query is ignored. This follows the first order.
 */
export function urlSettings(href: string): UrlSettings {
  const inputs = new Map<InputName, number>()
  const display: Mutable<Partial<DisplaySettings>> = {}
  const url = href.toLowerCase()
  if (!url.includes('?')) return { inputs, display }
  const params = new URL(url).searchParams

  for (const name of INPUT_NAMES) {
    const text = params.get(name.toLowerCase())
    if (text === null) continue
    const value = parseFloat(text)
    // Set as a number; a drop-down keeps only its option values (empty, so NaN, otherwise).
    if (!Number.isNaN(value)) inputs.set(name, inputValueFromNumber(name, value))
  }

  const loopText = params.get('control_loop')
  const loop = loopText === null ? undefined : LOOP_VALUES[loopText]
  if (loop !== undefined) display.loop = loop
  const gain = params.get('pid_scale')
  if (gain === 'log') display.gain = 'dB'
  if (gain === 'linear') display.gain = 'linear'
  const phase = params.get('pid_phasescale')
  if (phase === 'unwrap') display.phase = 'unwrapped'
  if (phase === 'wrap') display.phase = 'wrapped'
  const freqScale = params.get('pid_feq_scale')
  if (freqScale === 'log') display.frequencyAxis = 'log'
  if (freqScale === 'linear') display.frequencyAxis = 'linear'
  const unit = params.get('pid_feq_unit')
  if (unit === 'hz') display.frequencyUnit = 'Hz'
  if (unit === 'rps') display.frequencyUnit = 'rad/s'
  const useAttitude = params.get('useattitude')
  if (useAttitude !== null) display.useAttitude = useAttitude === 'true'
  return { inputs, display }
}
