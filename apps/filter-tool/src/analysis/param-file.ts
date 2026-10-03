/**
 * Reading and writing ArduPilot `.param` files exactly as upstream `load_parameters` and
 * `save_parameters` do.
 */
import { paramToString } from '@apwt/ardupilot'
import { assignFieldText, isSelectField } from './fields.js'
import { INPUT_NAMES, PARAM_NAMES, type InputName, type Inputs } from './params.js'

const INPUT_NAME_SET: ReadonlySet<string> = new Set(INPUT_NAMES)

function isInputName(name: string): name is InputName {
  return INPUT_NAME_SET.has(name)
}

/**
 * Values a `.param` file sets (upstream `load_parameters`). Lines are split on `\n` and not
 * trimmed; the first `Q_A_RAT_` in a line becomes `ATC_RAT_`; the line is split on runs of
 * whitespace, `,` and `=`, and any line with two or more fields sets the input whose id is the
 * first field to the second field's text. So an indented line (first field empty) is ignored,
 * `NAME,` sets `NaN`, the operating-point inputs (`GyroSampleRate`, `Throttle`, `RPM1`, ...) can be
 * set too, and the value text goes through the form control's rules ({@link assignFieldText}).
 * Later lines win.
 */
export function parseParamFile(text: string): Partial<Record<InputName, number>> {
  const values: Partial<Record<InputName, number>> = {}
  for (const rawLine of text.split('\n')) {
    const fields = rawLine.replace('Q_A_RAT_', 'ATC_RAT_').split(/[\s,=\t]+/)
    if (fields.length < 2) continue
    const name = fields[0]!
    if (isInputName(name)) values[name] = assignFieldText(name, fields[1]!)
  }
  return values
}

/**
 * The `INS_*` parameters in the order upstream writes them: its form's number inputs first, then
 * its selects (`getElementsByTagName("input")` followed by `("select")`), so `_ENABLE` and `_MODE`
 * come last.
 */
export const SAVED_PARAMS: readonly InputName[] = (() => {
  const ins = PARAM_NAMES.filter((name) => name.startsWith('INS_'))
  return [...ins.filter((n) => !isSelectField(n)), ...ins.filter((n) => isSelectField(n))]
})()

/**
 * The `filter.param` text upstream builds: `NAME,param_to_string(value)` per line. Upstream
 * passes the control's text, so an empty control (`NaN` here) is written as `0`
 * (`Math.fround("")` is 0).
 */
export function formatParamFile(inputs: Inputs): string {
  return SAVED_PARAMS.map((name) => {
    const value = inputs[name]
    return `${name},${paramToString(Number.isNaN(value) ? 0 : value)}\n`
  }).join('')
}
