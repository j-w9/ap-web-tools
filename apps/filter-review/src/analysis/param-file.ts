import { paramLine } from '@apwt/ardupilot'
import {
  FILTER_PARAM_NAMES,
  assignedValue,
  isFilterParamName,
  sanitizeNumberInput,
  selectOptions,
  type FilterParamName,
  type PageValues
} from './page-values.js'

/** One `INS_*` input as upstream finds it on the page: id (= name) and its value string. */
export interface PageParam {
  readonly name: FilterParamName
  readonly value: string
}

/**
 * The `INS_*` inputs in the order upstream's `getElementsByTagName` finds them: the number
 * inputs in page order (low-pass, then each notch's numeric fields), then the drop-downs
 * (each notch's enable and mode). `SCHED_LOOP_RATE` is not an `INS_` input and is left out.
 */
export function pageParams(values: PageValues): PageParam[] {
  const ins = FILTER_PARAM_NAMES.filter((n) => n.startsWith('INS_'))
  const inputs = ins.filter((n) => selectOptions(n) === undefined)
  const selects = ins.filter((n) => selectOptions(n) !== undefined)
  return [...inputs, ...selects].map((name) => ({ name, value: values[name] }))
}

/**
 * Text of the `filter.param` file upstream's "Save Parameters" downloads (`save_parameters`):
 * lines in page order, each value through `param_to_string`, which reads an empty input as 0.
 */
export function filterParamFileText(values: PageValues): string {
  return pageParams(values)
    .map((p) => paramLine(p.name, Number(p.value)))
    .join('')
}

/** Other page inputs a parameter file can write, because upstream looks names up by element id. */
export type OtherPageInput = 'TimeStart' | 'TimeEnd' | 'FFTWindow_size' | 'FFTWindow_per_batch'

const OTHER_INPUTS: ReadonlySet<string> = new Set<OtherPageInput>([
  'TimeStart',
  'TimeEnd',
  'FFTWindow_size',
  'FFTWindow_per_batch'
])

/** File inputs on the upstream page; assigning them a non-empty value throws. */
const FILE_INPUTS: ReadonlySet<string> = new Set(['fileItem', 'LoadParamsbase'])

/** An input value written by a parameter file line. */
export type ParamFileAssignment =
  | { readonly kind: 'param'; readonly name: FilterParamName; readonly value: string }
  | { readonly kind: 'other'; readonly name: OtherPageInput; readonly value: string }

/** Result of reading a parameter file. */
export interface ParamFileResult {
  /** Input values written, in file order. */
  readonly assignments: readonly ParamFileAssignment[]
  /**
   * Set when upstream would have thrown part way through (a line naming one of the page's
   * file inputs). Lines before it were applied; upstream then skips the recalculation.
   */
  readonly error?: string
}

/**
 * Read a `.param` / `.parm` file the way upstream `load_parameters` does. Each line (not
 * trimmed) is split on runs of whitespace, `,` and `=`; a line with at least two parts sets the
 * page element whose id is the first part to the second part. An indented line therefore has
 * an empty name and is ignored. Values go through the input's own rules: a number input keeps
 * only a valid number string (else empty, read as NaN), a drop-down only one of its options.
 *
 * Names are page element ids, not only parameters: `TimeStart`, `TimeEnd`, `FFTWindow_size`
 * and `FFTWindow_per_batch` are written too. Other ids (checkboxes, buttons, plots) take the
 * value without effect.
 */
export function applyParamFile(text: string): ParamFileResult {
  const assignments: ParamFileAssignment[] = []
  const lines = text.split('\n')
  for (const line of lines) {
    const v = line.split(/[\s,=\t]+/)
    if (v.length < 2) continue
    const name = v[0]!
    const value = v[1]!
    if (isFilterParamName(name)) {
      assignments.push({ kind: 'param', name, value: assignedValue(name, value) })
    } else if (OTHER_INPUTS.has(name)) {
      assignments.push({ kind: 'other', name: name as OtherPageInput, value: sanitizeNumberInput(value) })
    } else if (FILE_INPUTS.has(name) && value !== '') {
      return {
        assignments,
        error: `Parameter file loading stopped at "${line}": ${name} is a file input and cannot be set (InvalidStateError)`
      }
    }
  }
  return { assignments }
}
