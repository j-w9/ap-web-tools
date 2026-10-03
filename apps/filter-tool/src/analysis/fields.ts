/**
 * How upstream's form turns text into the numbers the filter maths reads.
 *
 * Upstream keeps every value in a DOM control and reads it back with `parseFloat(element.value)`
 * (`get_form`). Two browser rules therefore decide what a loaded file, share link or cookie
 * value becomes:
 *
 * - A number `<input>` only keeps a valid HTML floating-point number; anything else (`5.`, `+1`,
 *   `Infinity`, an empty string) becomes `""`, which reads back as `NaN`.
 * - Parameters whose metadata lists `Values` are replaced by a `<select>` (`load_param_inputs`),
 *   except `SCHED_LOOP_RATE` (`data-paramValues="false"`). Setting a select to text that is not
 *   exactly one of its option values selects nothing, which also reads back as `NaN`. So
 *   `INS_HNTCH_MODE,1.000000` (MAVProxy's format) reads as `NaN`, i.e. a fixed notch.
 */
import { PARAM_METADATA } from './metadata.js'
import { isParamName, type InputName, type ParamName } from './params.js'

/** Parameters upstream shows as a `<select>` of their metadata values. */
export function isSelectField(name: InputName): name is ParamName {
  return isParamName(name) && name !== 'SCHED_LOOP_RATE' && PARAM_METADATA[name].kind === 'values'
}

/** Option values of a select field, as the `value` attribute strings upstream writes. */
function optionValues(name: ParamName): readonly string[] {
  const meta = PARAM_METADATA[name]
  return meta.kind === 'values' ? meta.values.map((o) => String(o.value)) : []
}

/** HTML "valid floating-point number", the only text a number input keeps. */
const VALID_FLOAT = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/

/** The number upstream reads back after `element.value = text` (`parameter_set_value` then `get_form`). */
export function assignFieldText(name: InputName, text: string): number {
  if (isSelectField(name)) return optionValues(name).includes(text) ? parseFloat(text) : NaN
  return VALID_FLOAT.test(text) ? parseFloat(text) : NaN
}

/** The same for a number assigned to the control (share link and cookie loading): `String(value)` is the text. */
export function assignFieldValue(name: InputName, value: number): number {
  return assignFieldText(name, String(value))
}
