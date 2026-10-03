/** Assemble the parameter file from the selected calibrations (upstream `save_parameters`). */
import type { CompassFitResult } from '../analysis/magfit.js'
import { buildParamFile, checkParams, type ParamFileEntry, type ParamFileResult, type UseOverride } from '../analysis/params.js'
import { compassCalibrations, savedCalibration, type CompassSelection } from './calibrations.js'

/** What saving would produce right now, and the warnings to show before the user saves. */
export interface SavePlan {
  readonly entries: readonly ParamFileEntry[]
  readonly file: ParamFileResult
  /** One upstream `check_params` warning per compass that has something to report. */
  readonly warnings: readonly string[]
}

/** Plan the parameter file for the current selections and "use sensor" choices. */
export function planSave(
  compasses: readonly (CompassFitResult | undefined)[],
  selections: readonly (CompassSelection | undefined)[],
  use: readonly UseOverride[]
): SavePlan {
  const entries: ParamFileEntry[] = []
  const warnings: string[] = []
  compasses.forEach((c, i) => {
    const selection = selections[i]
    if (c === undefined || selection === undefined) return
    const saved = savedCalibration(selection, compassCalibrations(c))
    if (saved?.params === undefined) return
    const names = c.prepared.compass.names
    entries.push({ compassIndex: i, names, params: saved.params, fitName: saved.label, use: use[i] ?? 'noChange' })
    const warning = checkParams(i, names, saved.params, c.prepared.compass.params)
    if (warning !== '') warnings.push(warning)
  })
  return { entries, file: buildParamFile(entries), warnings }
}

/** Offer `text` as a file download through a temporary Blob link. */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
