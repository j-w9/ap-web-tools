import osmtogeojson from 'osmtogeojson'
import { geometryPolygons, type Tags, type WaterFeature } from './features.js'
import type { Bounds } from './geo.js'

/** Public Overpass API endpoint upstream queries. */
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/** Searching is only allowed from this zoom in, which bounds the size of the Overpass request. */
export const MIN_SEARCH_ZOOM = 11

/** The OSM tags searched for, as the upstream Readme lists them. */
export const WATER_TAGS = [
  'landuse=reservoir',
  'natural=water (without a water tag)',
  'water=lake',
  'water=reservoir',
  'water=basin',
  'water=lagoon',
  'water=pond'
] as const

// Query bodies verbatim from upstream `request()`: multipolygon relations of water areas, then
// closed ways with the same tags, both with full geometry.
const AREAS = `(area[landuse=reservoir];
         area[natural=water][!water];
         area[water=lake];
         area[water=reservoir];
         area[water=basin];
         area[water=lagoon];
         area[water=pond];)-> .water;
         relation(pivot.water);
        out geom;`

const WAYS = `(way[landuse=reservoir];
         way[natural=water][!water];
         way[water=lake];
         way[water=pond];
         way[water=basin];
         way[water=lagoon];
         way[water=reservoir];);
        out geom;`

/**
 * Overpass QL for water bodies in `bounds`. Deviation: `[out:json]` is added so the response is
 * parsed as JSON rather than XML; osmtogeojson converts either into the same GeoJSON.
 */
export function buildOverpassQuery(bounds: Bounds): string {
  const bbox = `[bbox:${bounds.south},${bounds.west},${bounds.north},${bounds.east}];`
  return `[out:json]${bbox}${AREAS}${WAYS}`
}

/** Form body for the Overpass POST request, as upstream sends it. */
export function overpassRequestBody(bounds: Bounds): string {
  return `data=${encodeURIComponent(buildOverpassQuery(bounds))}`
}

export type OverpassResult =
  { readonly ok: true; readonly features: WaterFeature[] } | { readonly ok: false; readonly error: string }

function stringTags(properties: unknown): Tags {
  const tags: Record<string, string> = {}
  if (typeof properties !== 'object' || properties === null) return tags
  for (const [k, v] of Object.entries(properties)) {
    if (typeof v === 'string') tags[k] = v
  }
  return tags
}

/** Water features from a GeoJSON FeatureCollection; only Polygon and MultiPolygon features are kept. */
export function waterFeaturesFromGeoJson(features: readonly unknown[]): WaterFeature[] {
  const out: WaterFeature[] = []
  for (const f of features) {
    if (typeof f !== 'object' || f === null || !('geometry' in f)) continue
    const polygons = geometryPolygons(f.geometry)
    if (polygons === null) continue
    const id = 'id' in f && (typeof f.id === 'string' || typeof f.id === 'number') ? String(f.id) : ''
    out.push({ id, tags: stringTags('properties' in f ? f.properties : null), polygons })
  }
  return out
}

/**
 * Parse an Overpass JSON response into water features (upstream converts the XML response with
 * osmtogeojson, which assembles multipolygon relations into rings).
 */
export function parseOverpassResponse(json: unknown): OverpassResult {
  if (typeof json !== 'object' || json === null || !('elements' in json) || !Array.isArray(json.elements)) {
    return { ok: false, error: 'The Overpass API returned an unexpected response.' }
  }
  // Overpass reports timeouts and memory limits as a `remark` with a 200 status.
  if ('remark' in json && typeof json.remark === 'string' && /error/i.test(json.remark)) {
    return { ok: false, error: `The Overpass API could not finish the search (${json.remark.trim()}). Try a smaller area.` }
  }
  const geojson = osmtogeojson(json)
  return { ok: true, features: waterFeaturesFromGeoJson(geojson.features) }
}
