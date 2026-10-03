// Expected earth magnetic field from the lookup tables, ported from upstream MAGFit/wmm.js
// (itself a port of pymavlink mavextra.py).

import { quatFromEuler, quatRotate } from './quaternion.js'
import type { Vec3 } from './vector.js'
import {
  DECLINATION_TABLE,
  INCLINATION_TABLE,
  INTENSITY_TABLE,
  SAMPLING_MAX_LAT,
  SAMPLING_MAX_LON,
  SAMPLING_MIN_LAT,
  SAMPLING_MIN_LON,
  SAMPLING_RES,
  type FieldTable
} from './wmm-tables.js'

/** Field angles and strength at a location. */
export interface EarthFieldAngles {
  /** Declination in degrees, positive east. */
  readonly declination: number
  /** Inclination in degrees, positive down. */
  readonly inclination: number
  /** Total intensity in gauss. */
  readonly intensity: number
}

/** Expected earth field at a location, including the NED field vector. */
export interface EarthField extends EarthFieldAngles {
  /** Earth-frame (north, east, down) field vector in milligauss. */
  readonly vector: Vec3
}

function cell(table: FieldTable, lat: number, lon: number): number {
  return table[lat]![lon]!
}

/** Bilinear interpolation of a table at a latitude/longitude in degrees (upstream `interpolate_table`). */
export function interpolateTable(table: FieldTable, latitudeDeg: number, longitudeDeg: number): number {
  // round down to nearest sampling resolution
  const minLat = Math.floor(latitudeDeg / SAMPLING_RES) * SAMPLING_RES
  const minLon = Math.floor(longitudeDeg / SAMPLING_RES) * SAMPLING_RES

  // find index of nearest low sampling point
  const minLatIndex = Math.floor(-SAMPLING_MIN_LAT + minLat) / SAMPLING_RES
  const minLonIndex = Math.floor(-SAMPLING_MIN_LON + minLon) / SAMPLING_RES

  const dataSw = cell(table, minLatIndex, minLonIndex)
  const dataSe = cell(table, minLatIndex, minLonIndex + 1)
  const dataNe = cell(table, minLatIndex + 1, minLonIndex + 1)
  const dataNw = cell(table, minLatIndex + 1, minLonIndex)

  // perform bilinear interpolation on the four grid corners
  const dataMin = ((longitudeDeg - minLon) / SAMPLING_RES) * (dataSe - dataSw) + dataSw
  const dataMax = ((longitudeDeg - minLon) / SAMPLING_RES) * (dataNe - dataNw) + dataNw

  return ((latitudeDeg - minLat) / SAMPLING_RES) * (dataMax - dataMin) + dataMin
}

/**
 * Declination, inclination and intensity at a location (upstream `get_mag_field_ef`), or
 * `undefined` outside the table bounds (latitude in [-90, 90), longitude in [-180, 180)).
 */
export function earthFieldAngles(latitudeDeg: number, longitudeDeg: number): EarthFieldAngles | undefined {
  // Deviation: upstream lets NaN through the range checks and then throws on the table lookup.
  if (Number.isNaN(latitudeDeg) || Number.isNaN(longitudeDeg)) return undefined
  if (latitudeDeg < SAMPLING_MIN_LAT) return undefined
  if (latitudeDeg >= SAMPLING_MAX_LAT) return undefined
  if (longitudeDeg < SAMPLING_MIN_LON) return undefined
  if (longitudeDeg >= SAMPLING_MAX_LON) return undefined
  return {
    intensity: interpolateTable(INTENSITY_TABLE, latitudeDeg, longitudeDeg),
    declination: interpolateTable(DECLINATION_TABLE, latitudeDeg, longitudeDeg),
    inclination: interpolateTable(INCLINATION_TABLE, latitudeDeg, longitudeDeg)
  }
}

/**
 * Expected earth field for a location (upstream `expected_earth_field_lat_lon`). Returns
 * `undefined` when the location is missing or off the table.
 */
export function expectedEarthField(lat: number | undefined, lon: number | undefined): EarthField | undefined {
  if (lat === undefined || lon === undefined) return undefined
  const field = earthFieldAngles(lat, lon)
  if (field === undefined) return undefined
  const q = quatFromEuler(0.0, -field.inclination * (Math.PI / 180), field.declination * (Math.PI / 180))
  return { ...field, vector: quatRotate(q, [field.intensity * 1000.0, 0.0, 0.0]) }
}
