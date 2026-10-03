/**
 * Saving the parameter file (upstream `save_parameters`): one candidate per compass, a
 * confirmation for each candidate whose parameters are unusual, then the file.
 */
import type { CompassFitResult } from '../analysis/magfit.js'
import {
  buildParamFile,
  checkParams,
  compassParamLines,
  motorCompType,
  MOTOR_TYPE_CONFLICT,
  type ParamFileEntry,
  type ParamFileResult,
  type UseOverride
} from '../analysis/params.js'
import { compassCalibrations, savedCalibration, type Calibration, type CompassSelection } from './calibrations.js'

/** One compass's calibration that saving would write, with its upstream `check_params` text. */
export interface SaveCandidate {
  readonly entry: ParamFileEntry
  /** Text of upstream's confirm box, empty when there is nothing to confirm. */
  readonly warning: string
}

/** The calibrations saving would write right now, in compass order. */
export function saveCandidates(
  compasses: readonly (CompassFitResult | undefined)[],
  selections: readonly (CompassSelection | undefined)[],
  use: readonly UseOverride[],
  calibrations?: readonly (readonly Calibration[] | undefined)[]
): SaveCandidate[] {
  const out: SaveCandidate[] = []
  compasses.forEach((c, i) => {
    const selection = selections[i]
    if (c === undefined || selection === undefined) return
    const saved = savedCalibration(selection, calibrations?.[i] ?? compassCalibrations(c))
    if (saved?.params === undefined) return
    const names = c.prepared.compass.names
    out.push({
      entry: { compassIndex: i, names, params: saved.params, fitName: saved.label, use: use[i] ?? 'noChange' },
      warning: checkParams(i, names, saved.params, c.prepared.compass.params)
    })
  })
  return out
}

/** Next step of saving: ask a confirmation, or the finished file (or upstream's alert text). */
export type SaveStep =
  { readonly kind: 'confirm'; readonly text: string } | { readonly kind: 'done'; readonly file: ParamFileResult }

/**
 * Walk the candidates as upstream does: a candidate with a warning is confirmed first (declined
 * ones are skipped), and a motor type conflict stops the save at the compass that causes it.
 * `answers` are the replies to the confirmations asked so far, in order. Throws where upstream
 * throws (a parameter that cannot be written, e.g. a missing orientation).
 */
export function nextSaveStep(candidates: readonly SaveCandidate[], answers: readonly boolean[]): SaveStep {
  const accepted: ParamFileEntry[] = []
  let asked = 0
  for (const candidate of candidates) {
    if (candidate.warning !== '') {
      const answer = answers[asked++]
      if (answer === undefined) return { kind: 'confirm', text: candidate.warning }
      if (!answer) continue
    }
    accepted.push(candidate.entry)
    if (motorCompType(accepted).conflict) return { kind: 'done', file: { ok: false, error: MOTOR_TYPE_CONFLICT } }
    compassParamLines(candidate.entry.names, candidate.entry.params)
  }
  return { kind: 'done', file: buildParamFile(accepted) }
}
