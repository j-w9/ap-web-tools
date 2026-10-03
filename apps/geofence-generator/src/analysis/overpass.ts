import osmtogeojson from 'osmtogeojson/osmtogeojson.js'
import type { OsmFeature } from './features.js'
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

/** Overpass QL for water bodies in `bounds`, exactly as upstream `request()` builds it. */
export function buildOverpassQuery(bounds: Bounds): string {
  // Upstream concatenates the raw numbers, so their default string form is used here too.
  const bbox = `[bbox:${String(bounds.south)},${String(bounds.west)},${String(bounds.north)},${String(bounds.east)}];`
  return `${bbox}${AREAS}${WAYS}`
}

/** Form body for the Overpass POST request, as upstream sends it. */
export function overpassRequestBody(bounds: Bounds): string {
  return `data=${encodeURIComponent(buildOverpassQuery(bounds))}`
}

/** The part of a parsed XML document this module reads (a browser `Document` has it). */
export interface XmlDocument {
  getElementsByTagName(name: string): ArrayLike<{ readonly textContent: string | null }>
}

/**
 * Features from an Overpass response document. Upstream asks for the default XML output, parses
 * the body with `DOMParser` as `text/xml` and converts it with osmtogeojson (the same build,
 * 3.0.0-beta.5), whatever the HTTP status; the port does the same, so an error page or an
 * unparsable body gives whatever osmtogeojson makes of it (normally no features).
 */
export function featuresFromXml(xml: XmlDocument): OsmFeature[] {
  return osmtogeojson(xml).features
}

/** Overpass reports timeouts and memory limits in a `<remark>` with HTTP 200; its text, if any. */
export function overpassRemark(xml: XmlDocument): string | null {
  const remark = xml.getElementsByTagName('remark')[0]
  const text = remark?.textContent?.trim()
  return text === undefined || text === '' ? null : text
}
