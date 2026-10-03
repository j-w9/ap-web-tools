/**
 * How upstream's page stores an input value. Its inputs are DOM elements: number inputs keep only
 * text that is a valid HTML floating-point number (anything else becomes empty), and the
 * enumerated parameters are drop-downs that keep only one of their option values. The page reads
 * every input with `parseFloat`, so an emptied input is NaN in the maths. These helpers give the
 * value upstream would compute with after setting an input, with NaN for an empty one.
 */
import { PARAM_METADATA } from './metadata.js'
import { isSimInputName, type InputName } from './params.js'

/** Upstream's metadata loader turns enumerated parameters into drop-downs. */
export function isDropDown(name: InputName): boolean {
  return !isSimInputName(name) && PARAM_METADATA[name].kind === 'values'
}

function optionTexts(name: InputName): readonly string[] {
  if (isSimInputName(name)) return []
  const meta = PARAM_METADATA[name]
  return meta.kind === 'values' ? meta.values.map((o) => String(o.value)) : []
}

/** HTML "valid floating-point number": the text a number input keeps (anything else empties it). */
export function isValidFloatText(text: string): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)
}

/** Value read back after setting the input's value to `text` (`parameter_set_value(name, text)`). */
export function inputValueFromText(name: InputName, text: string): number {
  if (isDropDown(name)) return optionTexts(name).includes(text) ? Number(text) : NaN
  return isValidFloatText(text) ? parseFloat(text) : NaN
}

/** Value read back after setting the input to a number (the DOM stores `String(value)`). */
export function inputValueFromNumber(name: InputName, value: number): number {
  return inputValueFromText(name, String(value))
}
