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
 *   exactly one of its option values selects nothing, which also reads back as `NaN`. So upstream
 *   reads `INS_HNTCH_MODE,1.000000` (MAVProxy's format) as `NaN`, i.e. a fixed notch, and
 *   `INS_HNTCH_ENABLE,0.000000` as an enabled notch. That is a proven upstream bug
 *   (docs/bug-proofs/filter-tool.md, row 2), fixed here: a number whose value is an option (`1.000000`,
 *   `1e0`) selects that option. Any other text that is not an option still reads as `NaN`.
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
  if (isSelectField(name)) {
    const options = optionValues(name)
    if (options.includes(text)) return parseFloat(text)
    // Proven upstream bug fixed (see above): numeric text equal to an option's value selects it.
    const option = VALID_FLOAT.test(text) ? String(parseFloat(text)) : ''
    return options.includes(option) ? parseFloat(option) : NaN
  }
  return VALID_FLOAT.test(text) ? parseFloat(text) : NaN
}

/** The same for a number assigned to the control (share link and cookie loading): `String(value)` is the text. */
export function assignFieldValue(name: InputName, value: number): number {
  return assignFieldText(name, String(value))
}
