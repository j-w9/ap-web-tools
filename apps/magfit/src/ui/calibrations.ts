/**
 * Calibrations offered for each compass (the existing one plus every fit) and the user's
 * selection of which to show and which to save. Pure, so the React components stay thin.
 */
import { FIT_KINDS, FIT_KIND_NAMES, type FitKind } from '../analysis/fit.js'
import type { CompassFitResult } from '../analysis/magfit.js'
import type { CalParams } from '../analysis/params.js'
import type { Vec3Series } from '../analysis/vector.js'

/** `existing`, or `<group index>:<fit kind>`. */
export type CalibrationId = 'existing' | `${number}:${FitKind}`

/** Identifier of one fit of one interference-source group. */
export function fitId(group: number, kind: FitKind): CalibrationId {
  return `${group}:${kind}`
}

interface CalibrationBase {
  readonly id: CalibrationId
  /** Full name, e.g. "Offsets and iron, Battery 1 current" (upstream saved-name format). */
  readonly label: string
  /** Name within its group, e.g. "Offsets and iron". */
  readonly kindLabel: string
  /** Group heading, e.g. "No motor comp". */
  readonly group: string
}

/** A calibration that can be plotted. */
export interface ValidCalibration extends CalibrationBase {
  readonly valid: true
  /** Parameters to save; `undefined` for the existing calibration. */
  readonly params: CalParams | undefined
  readonly field: Vec3Series
  readonly error: Float64Array
  readonly meanError: number
  readonly yaw: Float64Array
}

/** Plot data of a calibration. */
export interface CalibrationData {
  readonly field: Vec3Series
  readonly error: Float64Array
  readonly yaw: Float64Array
}

/** A fit that produced parameters outside the typical ranges. */
export interface InvalidCalibration extends CalibrationBase {
  readonly valid: false
  readonly params: CalParams
  /**
   * Plot data from the last calculation in which this fit was valid. Upstream merges an invalid
   * result into the previous one (`Object.assign`), so a fit that is still ticked keeps drawing
   * its old traces; reproduced (see docs/upstream-bugs.md).
   */
  readonly stale: CalibrationData | undefined
}

/** One selectable calibration of one compass. */
export type Calibration = ValidCalibration | InvalidCalibration

/** Data to plot for a calibration: its own, or the stale data of an invalid fit. */
export function plotData(c: Calibration): CalibrationData | undefined {
  return c.valid ? c : c.stale
}

/**
 * The existing calibration and every fit of a compass, in upstream order. `previous` is the
 * same compass's calibrations from the last calculation, for the stale data of invalid fits.
 */
export function compassCalibrations(result: CompassFitResult, previous?: readonly Calibration[]): Calibration[] {
  const p = result.prepared
  const out: Calibration[] = [
    {
      id: 'existing',
      label: 'Existing calibration',
      kindLabel: 'Existing',
      group: 'Existing',
      valid: true,
      params: undefined,
      field: p.compass.logged,
      error: p.existingError,
      meanError: result.existingMeanError,
      yaw: p.existingYaw
    }
  ]
  result.groups.forEach((g, gi) => {
    for (const kind of FIT_KINDS) {
      const fit = g.fits[kind]
      const base = {
        id: fitId(gi, kind),
        label: `${FIT_KIND_NAMES[kind]}, ${g.name}`,
        kindLabel: FIT_KIND_NAMES[kind],
        group: g.name
      }
      if (fit.valid) {
        out.push({ ...base, ...fit })
      } else {
        const before = previous?.find((c) => c.id === base.id)
        out.push({ ...base, valid: false, params: fit.params, stale: before ? plotData(before) : undefined })
      }
    }
  })
  return out
}

/** Which calibrations of a compass are shown, and the order they were picked in. */
export interface CompassSelection {
  readonly shown: ReadonlySet<CalibrationId>
  /** Fits in priority order; the first shown fit in this order is the one saved. */
  readonly order: readonly CalibrationId[]
  /**
   * A tick was changed since the last calculation. Upstream shows every compass's error bars
   * after a calculation and only hides those with nothing ticked when a tick changes.
   */
  readonly toggled: boolean
}

function defaults(result: CompassFitResult): CalibrationId[] {
  return result.groups.flatMap((g, gi) => (g.defaultKind === undefined ? [] : [fitId(gi, g.defaultKind)]))
}

/** Every fit of a compass in upstream order (the order `redraw` rebuilds `param_selection` in). */
function fitOrder(result: CompassFitResult): CalibrationId[] {
  return result.groups.flatMap((_g, gi) => FIT_KINDS.map((kind) => fitId(gi, kind)))
}

/** Upstream's initial selection: the existing calibration plus the default fit. */
export function initialSelection(result: CompassFitResult): CompassSelection {
  return { shown: new Set<CalibrationId>(['existing', ...defaults(result)]), order: fitOrder(result), toggled: false }
}

/**
 * Selection after recalculating, as upstream: ticks survive (also on fits that are no longer
 * valid, whose boxes are disabled but stay ticked), the default fit is ticked again, and the
 * priority order goes back to the upstream order, forgetting the order of picks.
 */
export function reconcileSelection(previous: CompassSelection | undefined, result: CompassFitResult): CompassSelection {
  if (previous === undefined) return initialSelection(result)
  return { shown: new Set([...previous.shown, ...defaults(result)]), order: fitOrder(result), toggled: false }
}

/** Show or hide one calibration (upstream `update_hidden`: a newly shown one moves to the front). */
export function toggleCalibration(selection: CompassSelection, id: CalibrationId, show: boolean): CompassSelection {
  const shown = new Set(selection.shown)
  if (show) shown.add(id)
  else shown.delete(id)
  const order = show ? [id, ...selection.order.filter((o) => o !== id)] : selection.order
  return { shown, order, toggled: true }
}

/** Whether a compass's bar group is visible in the mean error plot (upstream `update_hidden`). */
export function errorBarsVisible(selection: CompassSelection): boolean {
  return !selection.toggled || selection.shown.size > 0
}

/**
 * The fit that will be saved for a compass: the first shown fit in priority order. Like
 * upstream this can be a fit that became invalid after recalculating but is still ticked.
 */
export function savedCalibration(selection: CompassSelection, calibrations: readonly Calibration[]): Calibration | undefined {
  for (const id of selection.order) {
    if (!selection.shown.has(id)) continue
    const c = calibrations.find((x) => x.id === id)
    if (c?.params !== undefined) return c
  }
  return undefined
}
