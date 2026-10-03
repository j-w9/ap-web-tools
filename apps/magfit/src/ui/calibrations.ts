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

/** A fit that produced parameters outside the typical ranges. */
export interface InvalidCalibration extends CalibrationBase {
  readonly valid: false
  readonly params: CalParams
}

/** One selectable calibration of one compass. */
export type Calibration = ValidCalibration | InvalidCalibration

/** The existing calibration and every fit of a compass, in upstream order. */
export function compassCalibrations(result: CompassFitResult): Calibration[] {
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
      out.push(fit.valid ? { ...base, ...fit } : { ...base, valid: false, params: fit.params })
    }
  })
  return out
}

/** Which calibrations of a compass are shown, and the order they were picked in. */
export interface CompassSelection {
  readonly shown: ReadonlySet<CalibrationId>
  /** Most recently picked first; the first shown fit in this order is the one saved. */
  readonly order: readonly CalibrationId[]
}

function defaults(result: CompassFitResult): CalibrationId[] {
  return result.groups.flatMap((g, gi) => (g.defaultKind === undefined ? [] : [fitId(gi, g.defaultKind)]))
}

/** Upstream's initial selection: the existing calibration plus the default fit. */
export function initialSelection(result: CompassFitResult): CompassSelection {
  const ids = defaults(result)
  return { shown: new Set<CalibrationId>(['existing', ...ids]), order: ids }
}

/**
 * Selection after recalculating. Like upstream, picks survive and the default fit is ticked
 * again; picks whose fit is no longer valid are dropped. Deliberate improvement: upstream
 * forgets the pick order on recalculation, here the most recent pick stays the one saved.
 */
export function reconcileSelection(previous: CompassSelection | undefined, result: CompassFitResult): CompassSelection {
  if (previous === undefined) return initialSelection(result)
  const valid = new Set(compassCalibrations(result).flatMap((c) => (c.valid ? [c.id] : [])))
  const added = defaults(result)
  const shown = new Set([...previous.shown, ...added].filter((id) => valid.has(id)))
  const order = [...previous.order.filter((id) => valid.has(id)), ...added.filter((id) => !previous.order.includes(id))]
  return { shown, order }
}

/** Show or hide one calibration (upstream `update_hidden`: a newly shown one moves to the front). */
export function toggleCalibration(selection: CompassSelection, id: CalibrationId, show: boolean): CompassSelection {
  const shown = new Set(selection.shown)
  if (show) shown.add(id)
  else shown.delete(id)
  const order = show ? [id, ...selection.order.filter((o) => o !== id)] : selection.order
  return { shown, order }
}

/** The fit that will be saved for a compass: the most recently picked fit still shown. */
export function savedCalibration(
  selection: CompassSelection,
  calibrations: readonly Calibration[]
): ValidCalibration | undefined {
  for (const id of selection.order) {
    if (!selection.shown.has(id)) continue
    const c = calibrations.find((x) => x.id === id)
    if (c?.valid && c.params !== undefined) return c
  }
  return undefined
}
