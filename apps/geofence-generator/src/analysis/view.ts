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

/** A point in Leaflet's projected pixel space at the current zoom. */
export interface PixelPoint {
  readonly x: number
  readonly y: number
}

/**
 * Corners of the starting crop polygon (upstream `add_crop`), in pixels: the view's projected
 * north-east and south-west corners, inset to 95% of the half-size on the left, right and bottom
 * and to 70% at the top (upstream leaves room for its floating menu; the port keeps the same
 * rectangle so the same area is cropped). Order as upstream: right-top, right-bottom, left-bottom,
 * left-top. The map unprojects them back to latitude/longitude.
 */
export function cropCornersPx(northEast: PixelPoint, southWest: PixelPoint): [x: number, y: number][] {
  const radius = { x: (northEast.x - southWest.x) * 0.5, y: (southWest.y - northEast.y) * 0.5 }
  const center = { x: (northEast.x + southWest.x) * 0.5, y: (northEast.y + southWest.y) * 0.5 }
  const top = center.y - radius.y * 0.7
  const bottom = center.y + radius.y * 0.95
  const left = center.x - radius.x * 0.95
  const right = center.x + radius.x * 0.95
  return [
    [right, top],
    [right, bottom],
    [left, bottom],
    [left, top]
  ]
}
