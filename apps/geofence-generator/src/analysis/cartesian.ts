import type { LatLon, Position } from './geo.js'

/**
 * Flat-earth conversion between GeoJSON positions and metres north/east of an origin, ported
 * from upstream `convertToCartesian` / `convertFromCartesian` (the same maths as ArduPilot's
 * `Location` class). `x` is north, `y` is east.
 */

/** Degrees of latitude to metres, from ArduPilot's `LATLON_TO_M`. */
export const LATLON_TO_M = 6378100 * (Math.PI / 180.0)

/**
 * Upstream `wrap_180`, `((angle + 180) % 360) - 180`, leaves angles below -180 unwrapped because
 * `%` keeps the dividend's sign; ArduPilot's `wrap_180` constrains to -180..180 (a proven bug, see
 * docs/bug-proofs/geofence-generator.md). Only negative remainders are corrected, so every angle
 * at or above -180 gives upstream's value bit for bit.
 */
export function wrap180(angle: number): number {
  let r = (angle + 180) % 360
  if (r < 0) r += 360
  return r - 180
}

/** Upstream `longitude_scale`: metres per degree of longitude relative to latitude, floored at 0.01. */
export function longitudeScale(lat: number): number {
  const scale = Math.cos(lat * (Math.PI / 180.0))
  return Math.max(scale, 0.01)
}

/** Metres north/east of an origin, one array per axis. */
export interface CartesianRing {
  readonly x: number[]
  readonly y: number[]
}

/** Positions to metres north (`x`) and east (`y`) of `origin`. */
export function toCartesian(points: readonly Position[], origin: Position): CartesianRing {
  const len = points.length
  const x = new Array<number>(len)
  const y = new Array<number>(len)
  for (let i = 0; i < len; i++) {
    const [lon, lat] = points[i]!
    x[i] = (lat - origin[1]) * LATLON_TO_M
    y[i] = wrap180(lon - origin[0]) * LATLON_TO_M * longitudeScale((lat + origin[1]) * 0.5)
  }
  return { x, y }
}

/** Metres north/east of `origin` back to latitude/longitude. */
export function fromCartesian(x: readonly number[], y: readonly number[], origin: Position): LatLon[] {
  const len = x.length
  const out: LatLon[] = new Array<LatLon>(len)
  for (let i = 0; i < len; i++) {
    const dlat = x[i]! / LATLON_TO_M
    out[i] = {
      lon: wrap180(origin[0] + y[i]! / LATLON_TO_M / longitudeScale(origin[1] + dlat / 2)),
      lat: origin[1] + dlat
    }
  }
  return out
}
