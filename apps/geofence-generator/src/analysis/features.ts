import intersect from '@turf/intersect'
import type { Feature, Geometry, GeoJsonProperties, MultiPolygon, Polygon } from 'geojson'
import { isPolygonRings, type PolygonRings, type Ring } from './geo.js'

/** OSM tags (plus `id`, as osmtogeojson flattens them). Only string values are kept. */
export type Tags = Readonly<Record<string, string>>

/**
 * A feature as osmtogeojson (or a Turf crop) returns it. Upstream keeps every feature of the
 * Overpass response, polygonal or not, and so does the port: cropping runs over all of them.
 */
export type OsmFeature = Feature

/** One polygon of a feature, the unit shown on the map and turned into a fence. */
export interface WaterPolygon {
  /** Unique within one list: feature id plus polygon index. */
  readonly key: string
  readonly featureId: string
  readonly tags: Tags
  /**
   * The feature's own coordinate arrays (not a copy), as upstream's map layers share them: a
   * download edits them in place (see `generateFence`).
   */
  readonly rings: PolygonRings
}

function featureId(feature: OsmFeature): string {
  return feature.id === undefined ? '' : String(feature.id)
}

/** String-valued properties of a feature. */
export function tagsOf(properties: GeoJsonProperties): Tags {
  const tags: Record<string, string> = {}
  if (properties === null) return tags
  for (const [k, v] of Object.entries(properties)) {
    if (typeof v === 'string') tags[k] = v
  }
  return tags
}

/** The polygons of one feature: one for a Polygon, one per part of a MultiPolygon, none otherwise. */
function featurePolygons(geometry: Geometry): PolygonRings[] {
  switch (geometry.type) {
    case 'Polygon':
      return isPolygonRings(geometry.coordinates) ? [geometry.coordinates] : []
    case 'MultiPolygon':
      return geometry.coordinates.filter(isPolygonRings)
    case 'Point':
    case 'MultiPoint':
    case 'LineString':
    case 'MultiLineString':
    case 'GeometryCollection':
      return []
  }
}

/**
 * One map polygon per feature polygon (upstream `add_feature`): a MultiPolygon adds each part as
 * its own layer, so each part becomes its own fence; other geometry types are not shown.
 */
export function splitPolygons(features: readonly OsmFeature[]): WaterPolygon[] {
  return features.flatMap((f) => {
    const id = featureId(f)
    const tags = tagsOf(f.properties)
    return featurePolygons(f.geometry).map((rings, i) => ({ key: `${id}#${String(i)}`, featureId: id, tags, rings }))
  })
}

function isPolygonal(feature: OsmFeature): feature is Feature<Polygon | MultiPolygon> {
  return feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
}

/** The result of cropping: the clipped features, and the error that stopped it, if any. */
export interface CropResult {
  readonly features: OsmFeature[]
  readonly error: Error | null
}

/**
 * Clip every feature to the crop polygon (upstream `apply_crop`, Turf 6 `intersect`). Features
 * outside the crop are dropped; the rest keep their id and properties. `crop` is the closed ring
 * Leaflet's `toGeoJSON()` gives for the crop polygon (rounded to 6 decimals, as upstream uses it).
 *
 * Upstream hands every feature to `intersect`, which throws on a non-polygon feature (an unclosed
 * way, say) and stops the crop with an error. That is a proven bug
 * (docs/bug-proofs/geofence-generator.md): non-polygon features are skipped here, as upstream's
 * `add_feature` skips them for display, so every polygon is cropped and no error is raised.
 */
export function cropFeatures(features: readonly OsmFeature[], crop: Ring): CropResult {
  const cropPolygon: Feature<Polygon> = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [crop] } }
  const out: OsmFeature[] = []
  for (const feature of features) {
    if (!isPolygonal(feature)) continue
    let clipped: Feature<Polygon | MultiPolygon> | null
    try {
      clipped = intersect(feature, cropPolygon)
    } catch (e) {
      return { features: out, error: e instanceof Error ? e : new Error(String(e)) }
    }
    if (clipped === null) continue
    const cropped: OsmFeature = { type: feature.type, geometry: clipped.geometry, properties: feature.properties }
    if (feature.id !== undefined) cropped.id = feature.id
    out.push(cropped)
  }
  return { features: out, error: null }
}

/** Display name and file name for a feature (upstream `create_popup`). */
export interface FeatureName {
  /** e.g. `Lac Léman (Lake Geneva)`: the name in the user's language, then the local name. */
  readonly label: string
  /** The name in the user's language if tagged, else the local name, else `unknown`. */
  readonly fileName: string
}

/** Name a feature from its `name:<lang>` and `name` tags, preferring the user's language. */
export function featureName(tags: Tags, language: string): FeatureName {
  const lang = language.split('-')[0] ?? language
  const localised = tags[`name:${lang}`]
  const name = tags.name
  if (localised !== undefined) {
    return { label: name === undefined ? localised : `${localised} (${name})`, fileName: localised }
  }
  if (name !== undefined) return { label: name, fileName: name }
  return { label: 'unknown', fileName: 'unknown' }
}

/** Total positions over all rings as they are now (the "Points" upstream's popup shows when opened). */
export function pointCount(rings: PolygonRings): number {
  let count = 0
  for (const ring of rings) count += ring.length
  return count
}

/** openstreetmap.org page for an osmtogeojson id such as `way/123`. */
export function osmUrl(id: string): string {
  return `https://www.openstreetmap.org/${id}`
}
