import intersect from '@turf/intersect'
import { featureCollection, multiPolygon, polygon as turfPolygon } from '@turf/helpers'
import type { MultiPolygon, Polygon } from 'geojson'
import { closeRing, toPolygonRings, type PolygonRings, type Ring } from './geo.js'

/** OSM tags (plus `id`, as osmtogeojson flattens them). Only string values are kept. */
export type Tags = Readonly<Record<string, string>>

/** A water body from OpenStreetMap: one polygon for a way, possibly several for a multipolygon relation. */
export interface WaterFeature {
  /** osmtogeojson id, `way/123` or `relation/456`. */
  readonly id: string
  readonly tags: Tags
  readonly polygons: readonly PolygonRings[]
}

/** One polygon of a feature, the unit shown on the map and turned into a fence. */
export interface WaterPolygon {
  /** Unique within one list: feature id plus polygon index. */
  readonly key: string
  readonly featureId: string
  readonly tags: Tags
  readonly rings: PolygonRings
}

/**
 * One map polygon per feature polygon. Upstream `add_feature` adds each part of a MultiPolygon
 * as its own layer, so each part becomes its own fence.
 */
export function splitPolygons(features: readonly WaterFeature[]): WaterPolygon[] {
  return features.flatMap((f) =>
    f.polygons.map((rings, i) => ({ key: `${f.id}#${String(i)}`, featureId: f.id, tags: f.tags, rings }))
  )
}

/** Narrow untyped GeoJSON Polygon/MultiPolygon geometry into polygons; anything else gives `null`. */
export function geometryPolygons(geometry: unknown): PolygonRings[] | null {
  if (typeof geometry !== 'object' || geometry === null || !('type' in geometry) || !('coordinates' in geometry)) return null
  const { type, coordinates } = geometry
  if (type === 'Polygon') {
    const rings = toPolygonRings(coordinates)
    return rings === null ? null : [rings]
  }
  if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
    const polygons = coordinates.map(toPolygonRings).filter((p): p is PolygonRings => p !== null)
    return polygons.length === 0 ? null : polygons
  }
  return null
}

function asCoordinates(rings: PolygonRings): number[][][] {
  return rings.map((ring) => ring.map(([lon, lat]) => [lon, lat]))
}

/**
 * Clip every feature to the crop polygon (upstream `apply_crop`, which uses Turf `intersect`).
 * Features outside the crop are dropped; the rest keep their id and tags.
 */
export function cropFeatures(features: readonly WaterFeature[], crop: Ring): WaterFeature[] {
  const cropPolygon = turfPolygon([closeRing(crop).map(([lon, lat]) => [lon, lat])])
  const out: WaterFeature[] = []
  for (const feature of features) {
    const shape = multiPolygon(feature.polygons.map(asCoordinates))
    const clipped = intersect(featureCollection<Polygon | MultiPolygon>([shape, cropPolygon]))
    if (clipped === null) continue
    const polygons = geometryPolygons(clipped.geometry)
    if (polygons !== null) out.push({ ...feature, polygons })
  }
  return out
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

/** Total positions over all rings, closing duplicates included (the "Points" upstream shows). */
export function pointCount(rings: PolygonRings): number {
  let count = 0
  for (const ring of rings) count += ring.length
  return count
}

/** openstreetmap.org page for an osmtogeojson id such as `way/123`. */
export function osmUrl(id: string): string {
  return `https://www.openstreetmap.org/${id}`
}
