/**
 * Suggested parameters and the `.param` file (upstream `update_saved_params` and
 * `save_parameters`; value formatting is the shared `param_to_string` port).
 */
import { paramLine } from '@apwt/ardupilot'
import type { CombinedFit } from './core.js'
import { fittedRatio } from './fit.js'
import type { AirspeedSensor, ArspdParam } from './load.js'

/** Ratios outside this range are flagged before saving. */
export const RATIO_TYPICAL_RANGE = [1.0, 3.0] as const

/** One suggested `ARSPDn_RATIO`. */
export interface RatioSuggestion {
  readonly name: ArspdParam<'RATIO'>
  /** Fitted ratio rounded to the 3 decimals shown; null when the fit gave a non-finite ratio. */
  readonly ratio: number | null
  readonly current: number | undefined
  /** Change from the current ratio, percent. */
  readonly changePercent: number | null
  readonly outOfRange: boolean
}

/** Per sensor: the suggestion, or null when the window had too few valid samples (no model). */
export function ratioSuggestions(
  sensors: readonly AirspeedSensor[],
  model: CombinedFit | null
): readonly (RatioSuggestion | null)[] {
  return sensors.map((sensor, i) => {
    const fitted = model?.sensors[i]
    if (fitted === undefined) return null
    const raw = fittedRatio(model, i)
    const ratio = raw === null ? null : Number(raw.toFixed(3))
    const current = sensor.currentRatio
    return {
      name: sensor.ratioName,
      ratio,
      current,
      // Upstream shows the change of the unrounded ratio (n/a when it is not finite).
      changePercent: current !== undefined ? (100 * (fitted.ratio - current)) / current : null,
      outOfRange: ratio !== null && (ratio < RATIO_TYPICAL_RANGE[0] || ratio > RATIO_TYPICAL_RANGE[1])
    }
  })
}

/** Suggestions that would be written to the file. */
function saved(suggestions: readonly (RatioSuggestion | null)[]): (RatioSuggestion & { readonly ratio: number })[] {
  return suggestions.flatMap((s) => (s !== null && s.ratio !== null ? [{ ...s, ratio: s.ratio }] : []))
}

/** Upstream's warning line for an out-of-range ratio. */
export function outOfRangeText(s: RatioSuggestion & { readonly ratio: number }): string {
  return `${s.name} = ${s.ratio.toFixed(3)} outside typical range ${RATIO_TYPICAL_RANGE[0]} to ${RATIO_TYPICAL_RANGE[1]}`
}

/**
 * Text of the `.param` file, one `NAME,value` line per suggestion in sensor order (not the
 * natural name order of the shared `paramFileText`, as upstream writes it).
 */
export function paramFileText(suggestions: readonly (RatioSuggestion | null)[]): string {
  return saved(suggestions)
    .map((s) => paramLine(s.name, s.ratio))
    .join('')
}

/** What Save does (upstream `save_parameters`): its alert, confirm and summary texts. */
export type SavePlan =
  | { readonly kind: 'nothing'; readonly message: string }
  | {
      readonly kind: 'save'
      readonly text: string
      /** Upstream's confirm text when a ratio is out of range (OK saves, Cancel does not). */
      readonly confirm: string | null
      /** Upstream's alert after saving. */
      readonly summary: string
    }

/** Plan the save for the current suggestions. */
export function planSave(suggestions: readonly (RatioSuggestion | null)[]): SavePlan {
  const list = saved(suggestions)
  if (list.length === 0) return { kind: 'nothing', message: 'No valid calibration to save' }
  const warning = list
    .filter((s) => s.outOfRange)
    .map((s) => outOfRangeText(s) + '\n')
    .join('')
  return {
    kind: 'save',
    text: paramFileText(suggestions),
    confirm: warning === '' ? null : 'Warning:\n' + warning + '\nSave anyway?',
    summary: 'Saved:\n' + list.map((s) => `\t${s.name}: ${s.ratio.toFixed(3)}\n`).join('')
  }
}

/** File name upstream saves to. */
export const PARAM_FILE_NAME = 'AirspeedFit.param'
