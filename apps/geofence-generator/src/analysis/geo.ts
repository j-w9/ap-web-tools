/**
 * Geographic primitives shared by the analysis modules. Coordinates follow GeoJSON order,
 * `[lon, lat]` in degrees, because that is what OpenStreetMap data and Turf use.
 *
 * Rings are mutable on purpose: upstream `generate_fence` edits the feature's own coordinate
 * arrays on every download (see `fence.ts`), and those arrays are shared between a feature and
 * the map polygons made from it, so the port keeps the same arrays and the same sharing.
 */

/** A GeoJSON position: longitude then latitude, in degrees. */
export type Position = [lon: number, lat: number]

/** A linear ring. Rings from GeoJSON are closed (first position repeated at the end). */
export type Ring = Position[]

/** A polygon: the outer ring first, then any holes. */
export type PolygonRings = Ring[]

/** A point in latitude/longitude order, as the fence file and Leaflet use it. */
export interface LatLon {
  readonly lat: number
  readonly lon: number
}

/** A latitude/longitude box, in degrees. */
export interface Bounds {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

/**
 * Whether a GeoJSON position has a numeric longitude and latitude. Narrowing keeps the very same
 * array (no copy), so later in-place edits still reach the feature it came from.
 */
export function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number'
}

/** Whether a value is a ring of positions (any length, as upstream accepts whatever osmtogeojson gives). */
export function isRing(value: unknown): value is Ring {
  return Array.isArray(value) && value.every(isPosition)
}

/** Whether a value is polygon coordinates: an array of rings. */
export function isPolygonRings(value: unknown): value is PolygonRings {
  return Array.isArray(value) && value.every(isRing)
}

/** True when the ring's last position repeats its first (upstream compares both coordinates with `==`). */
export function isClosed(ring: readonly Position[]): boolean {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
}

/** A copy of the ring without its closing duplicate. */
export function openRing(ring: readonly Position[]): Position[] {
  return isClosed(ring) ? ring.slice(0, -1) : [...ring]
}
