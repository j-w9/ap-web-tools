/**
 * Geographic primitives shared by the analysis modules. Coordinates follow GeoJSON order,
 * `[lon, lat]` in degrees, because that is what OpenStreetMap data and Turf use.
 */

/** A GeoJSON position: longitude then latitude, in degrees. */
export type Position = readonly [lon: number, lat: number]

/** A linear ring. Rings from GeoJSON are closed (first position repeated at the end). */
export type Ring = readonly Position[]

/** A polygon: the outer ring first, then any holes. */
export type PolygonRings = readonly Ring[]

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Narrow an untyped GeoJSON position to a `Position`, or `null` if it is not one. */
export function toPosition(value: unknown): Position | null {
  if (!Array.isArray(value)) return null
  const lon: unknown = value[0]
  const lat: unknown = value[1]
  return isFiniteNumber(lon) && isFiniteNumber(lat) ? [lon, lat] : null
}

/** Narrow an untyped GeoJSON ring, or `null` if any position is malformed or it has under 4 positions. */
export function toRing(value: unknown): Ring | null {
  if (!Array.isArray(value) || value.length < 4) return null
  const ring: Position[] = []
  for (const p of value) {
    const position = toPosition(p)
    if (position === null) return null
    ring.push(position)
  }
  return ring
}

/** Narrow untyped GeoJSON polygon coordinates; rings that are malformed drop the whole polygon. */
export function toPolygonRings(value: unknown): PolygonRings | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rings: Ring[] = []
  for (const r of value) {
    const ring = toRing(r)
    if (ring === null) return null
    rings.push(ring)
  }
  return rings
}

/** True when the ring's last position repeats its first. */
export function isClosed(ring: Ring): boolean {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]
}

/** The ring with its closing duplicate removed (upstream `generate_fence` drops it before simplifying). */
export function openRing(ring: Ring): Ring {
  return isClosed(ring) ? ring.slice(0, -1) : ring
}

/** The ring closed by repeating its first position, as GeoJSON requires. */
export function closeRing(ring: Ring): Ring {
  const first = ring[0]
  return first === undefined || isClosed(ring) ? ring : [...ring, first]
}
