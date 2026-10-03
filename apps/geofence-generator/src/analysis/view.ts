import type { Bounds, Ring } from './geo.js'

/** A map view to restore: centre and zoom. */
export interface MapView {
  readonly lat: number
  readonly lng: number
  readonly zoom: number
}

/** Upstream's view when nothing was remembered: London, zoomed out to show western Europe. */
export const DEFAULT_VIEW: MapView = { lat: 51.505, lng: -0.09, zoom: 5 }

/**
 * Parse a remembered view (upstream uses leaflet.restoreview, which stores the view in
 * localStorage). Anything malformed gives `null`.
 */
export function parseStoredView(text: string | null): MapView | null {
  if (text === null) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  if (!('lat' in value) || !('lng' in value) || !('zoom' in value)) return null
  const { lat, lng, zoom } = value
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof zoom !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(zoom) || Math.abs(lat) > 90) return null
  return { lat, lng, zoom }
}

function mercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
}

function inverseMercatorY(y: number): number {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI)
}

/**
 * Starting crop polygon for the visible area (upstream `add_crop`): a rectangle inset from the
 * map edges, computed in Web Mercator so it is a rectangle on screen. Corners run north-east,
 * south-east, south-west, north-west, as upstream. Deviation: upstream insets the top edge to 70%
 * to clear its floating menu; this layout has no overlay, so every edge uses the same `inset`.
 */
export function cropRectangle(bounds: Bounds, inset = 0.95): Ring {
  const top = mercatorY(bounds.north)
  const bottom = mercatorY(bounds.south)
  const midY = (top + bottom) / 2
  const halfY = ((top - bottom) / 2) * inset
  const midX = (bounds.east + bounds.west) / 2
  const halfX = ((bounds.east - bounds.west) / 2) * inset
  const north = inverseMercatorY(midY + halfY)
  const south = inverseMercatorY(midY - halfY)
  const east = midX + halfX
  const west = midX - halfX
  return [
    [east, north],
    [east, south],
    [west, south],
    [west, north]
  ]
}
