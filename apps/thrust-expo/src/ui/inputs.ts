/**
 * Text state of the rail inputs. Inputs hold text so a half-typed number is not lost; values
 * are parsed with `parseFloat`, as upstream does, so an empty input is NaN.
 */
import type { ParamFileValues } from '../analysis/param-file.js'
import { INPUT_NAMES, defaultInputs, type InputName } from '../analysis/params.js'

export type InputText = Readonly<Record<InputName, string>>
export type InputValues = Readonly<Record<InputName, number>>

/** Number to input text; NaN becomes an empty input, as a browser number input shows it. */
function toText(value: number): string {
  return Number.isNaN(value) ? '' : String(value)
}

export function defaultInputText(): InputText {
  const d = defaultInputs()
  const text: Record<InputName, string> = { ...EMPTY_TEXT }
  for (const name of INPUT_NAMES) text[name] = toText(d[name])
  return text
}

const EMPTY_TEXT: InputText = {
  MOT_SPIN_ARM: '',
  MOT_SPIN_MIN: '',
  MOT_SPIN_MAX: '',
  MOT_PWM_MIN: '',
  MOT_PWM_MAX: '',
  MOT_THST_EXPO: '',
  MOTOR_COUNT: '',
  COPTER_AUW: ''
}

export function parseInputs(text: InputText): InputValues {
  const values: Record<InputName, number> = defaultInputs()
  for (const name of INPUT_NAMES) values[name] = parseFloat(text[name])
  return values
}

/**
 * Keep `MOT_SPIN_MIN` at or above `MOT_SPIN_ARM` (upstream constrains it on every input
 * event). Deviation: applied when either field loses focus rather than on every keystroke, so
 * typing is not interrupted, and compared as numbers (upstream compares the input strings).
 */
export function constrainSpinMin(text: InputText): InputText {
  const arm = parseFloat(text.MOT_SPIN_ARM)
  const min = parseFloat(text.MOT_SPIN_MIN)
  return min < arm ? { ...text, MOT_SPIN_MIN: text.MOT_SPIN_ARM } : text
}

/** Apply the values a parameter file sets. */
export function withParamFile(text: InputText, file: ParamFileValues): InputText {
  const next: Record<InputName, string> = { ...text }
  for (const name of INPUT_NAMES) {
    const value = file.values[name]
    if (value !== undefined) next[name] = toText(value)
  }
  return next
}
