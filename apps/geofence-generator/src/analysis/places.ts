import type { Bounds } from './geo.js'

/**
 * Place search through Nominatim, the default geocoder of the leaflet-control-geocoder plugin
 * upstream puts on its map.
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

/** A geocoder result. */
export interface Place {
  readonly name: string
  readonly bounds: Bounds
}

/** Search URL for `query`, with the parameters leaflet-control-geocoder sends. */
export function nominatimSearchUrl(query: string): string {
  const params = new URLSearchParams({ q: query, limit: '5', format: 'json', addressdetails: '1' })
  return `${NOMINATIM_URL}?${params.toString()}`
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Parse a Nominatim JSON response. `boundingbox` is `[south, north, west, east]` as strings. */
export function parseNominatimResponse(json: unknown): Place[] {
  if (!Array.isArray(json)) return []
  const items: readonly unknown[] = json
  const places: Place[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    if (!('display_name' in item) || typeof item.display_name !== 'string') continue
    if (!('boundingbox' in item) || !Array.isArray(item.boundingbox)) continue
    const box: readonly unknown[] = item.boundingbox
    const [south, north, west, east] = box.map(toNumber)
    if (south == null || north == null || west == null || east == null) continue
    places.push({ name: item.display_name, bounds: { south, west, north, east } })
  }
  return places
}
