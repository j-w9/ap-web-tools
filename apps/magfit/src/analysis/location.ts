// Vehicle location used to look up the earth field, ported from upstream MAGFit/magfit.js
// (`extractLatLon`).

import type { DataflashLog } from '@apwt/dataflash'

/** Where a location came from. */
export type LocationSource = 'ORGN' | 'POS'

/** A latitude/longitude in degrees. */
export interface LogLocation {
  readonly lat: number
  readonly lon: number
  readonly source: LocationSource
}

const DEG_E7 = 10 ** -7

/** Last value of a column; like upstream an empty column gives `undefined * 1e-7`, i.e. NaN. */
function last(col: ArrayLike<number> | undefined): number {
  return col === undefined || col.length === 0 ? NaN : col[col.length - 1]! * DEG_E7
}

/**
 * Location for the earth field: the last EKF origin (ORGN instance 0), else the last POS
 * record (upstream `extractLatLon`). `undefined` when neither exists (upstream returns
 * `[undefined, undefined]` and reports that it could not get the earth field).
 */
export function logLocation(log: DataflashLog): LogLocation | undefined {
  if (log.instances('ORGN').includes(0)) {
    return { lat: last(log.getNumbers('ORGN', 'Lat', 0)), lon: last(log.getNumbers('ORGN', 'Lng', 0)), source: 'ORGN' }
  }
  if (log.has('POS')) {
    return { lat: last(log.getNumbers('POS', 'Lat')), lon: last(log.getNumbers('POS', 'Lng')), source: 'POS' }
  }
  return undefined
}
