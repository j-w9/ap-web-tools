// Vehicle location used to look up the earth field, ported from upstream MAGFit/magfit.js
// (`extractLatLon`).

import type { DataflashLog } from '@apwt/dataflash'

/** Where a location came from. */
export type LocationSource = 'ORGN' | 'POS' | 'GPS'

/** A latitude/longitude in degrees. */
export interface LogLocation {
  readonly lat: number
  readonly lon: number
  readonly source: LocationSource
}

const DEG_E7 = 10 ** -7

function last(col: ArrayLike<number> | undefined): number | undefined {
  return col === undefined || col.length === 0 ? undefined : col[col.length - 1]
}

function fromColumns(
  lat: ArrayLike<number> | undefined,
  lon: ArrayLike<number> | undefined,
  source: LocationSource
): LogLocation | undefined {
  const la = last(lat)
  const lo = last(lon)
  if (la === undefined || lo === undefined) return undefined
  return { lat: la * DEG_E7, lon: lo * DEG_E7, source }
}

/**
 * Location for the earth field: the last EKF origin (ORGN instance 0), else the last POS
 * record (upstream `extractLatLon`). Deliberate extension: when neither exists, fall back to
 * the last GPS instance 0 record with a 3D fix (Status >= 3); upstream gives up instead.
 */
export function logLocation(log: DataflashLog): LogLocation | undefined {
  if (log.instances('ORGN').includes(0)) {
    return fromColumns(log.getNumbers('ORGN', 'Lat', 0), log.getNumbers('ORGN', 'Lng', 0), 'ORGN')
  }
  if (log.has('POS')) {
    return fromColumns(log.getNumbers('POS', 'Lat'), log.getNumbers('POS', 'Lng'), 'POS')
  }
  const instance = log.instances('GPS').includes(0) ? 0 : undefined
  const status = log.getNumbers('GPS', 'Status', instance)
  const lat = log.getNumbers('GPS', 'Lat', instance)
  const lon = log.getNumbers('GPS', 'Lng', instance)
  if (status === undefined || lat === undefined || lon === undefined) return undefined
  for (let i = status.length - 1; i >= 0; i--) {
    if (status[i]! >= 3) return { lat: lat[i]! * DEG_E7, lon: lon[i]! * DEG_E7, source: 'GPS' }
  }
  return undefined
}
