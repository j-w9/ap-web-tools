// Test-only: synthetic water bodies, and OSM data as Overpass `out geom` XML (what upstream requests).
import { isClosed, type Position, type Ring } from '../analysis/geo.js'
import { DOMParser } from '@xmldom/xmldom'
import type { XmlDocument } from '../analysis/overpass.js'
import { rng } from './upstream.js'

const M_PER_DEG = 6378100 * (Math.PI / 180)

/**
 * A closed, lake-like ring of `n` vertices around (`lon`, `lat`): a lobed radius plus a little
 * noise, so it is star-shaped (never self-intersecting) but has plenty of small triangles.
 */
export function lakeRing(n: number, lon: number, lat: number, radiusM: number, seed: number, lobes = 3): Ring {
  const next = rng(seed)
  const ring: Position[] = []
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n
    const r = radiusM * (1 + 0.3 * Math.sin(lobes * theta) + 0.04 * (next() - 0.5))
    const dLat = (r * Math.cos(theta)) / M_PER_DEG
    const dLon = (r * Math.sin(theta)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))
    ring.push([Number((lon + dLon).toFixed(7)), Number((lat + dLat).toFixed(7))])
  }
  const first = ring[0]
  if (first !== undefined) ring.push(first)
  return ring
}

/** Mutable deep copy of rings, in the plain-array form upstream works on. */
export function plainRings(rings: readonly Ring[]): number[][][] {
  return rings.map((ring) => ring.map(([lon, lat]) => [lon, lat]))
}

/**
 * One OSM element in a fixture: a tagged way (closed for a polygon, open for a line), or a
 * multipolygon relation of member rings.
 */
export type OsmFixtureElement =
  | { kind: 'way'; id: number; tags: Record<string, string>; ring: Ring }
  | {
      kind: 'relation'
      id: number
      tags: Record<string, string>
      members: { ref: number; role: 'outer' | 'inner'; ring: Ring }[]
    }

function ringBounds(rings: readonly Ring[]) {
  const lats = rings.flatMap((r) => r.map((p) => p[1]))
  const lons = rings.flatMap((r) => r.map((p) => p[0]))
  return { minlat: Math.min(...lats), minlon: Math.min(...lons), maxlat: Math.max(...lats), maxlon: Math.max(...lons) }
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const tagXml = (tags: Record<string, string>) =>
  Object.entries(tags)
    .map(([k, v]) => `<tag k="${esc(k)}" v="${esc(v)}"/>`)
    .join('')
const boundsXml = (rings: readonly Ring[]) => {
  const b = ringBounds(rings)
  return `<bounds minlat="${b.minlat}" minlon="${b.minlon}" maxlat="${b.maxlat}" maxlon="${b.maxlon}"/>`
}

/** The same fixture as Overpass XML (`out geom`), which is what upstream requests. */
export function overpassXml(elements: readonly OsmFixtureElement[]): string {
  const body = elements
    .map((e) => {
      if (e.kind === 'way') {
        const nds = e.ring
          .map(
            ([lon, lat], i) =>
              `<nd ref="${i === e.ring.length - 1 && isClosed(e.ring) ? e.id * 1000 : e.id * 1000 + i}" lat="${lat}" lon="${lon}"/>`
          )
          .join('')
        return `<way id="${e.id}">${boundsXml([e.ring])}${nds}${tagXml(e.tags)}</way>`
      }
      const members = e.members
        .map(
          (m) =>
            `<member type="way" ref="${m.ref}" role="${m.role}">${m.ring.map(([lon, lat]) => `<nd lat="${lat}" lon="${lon}"/>`).join('')}</member>`
        )
        .join('')
      return `<relation id="${e.id}">${boundsXml(e.members.map((m) => m.ring))}${members}${tagXml(e.tags)}</relation>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6" generator="Overpass API fixture">${body}</osm>`
}

/** A sample search area and its OSM data: two ponds and a lake with an island and a second part. */
export const bounds = { south: 47.25, west: 8.45, north: 47.35, east: 8.6 }

export const elements: OsmFixtureElement[] = [
  {
    kind: 'way',
    id: 101,
    tags: { natural: 'water', water: 'pond', name: 'Mill/pond', 'name:en': 'Mill pond', 'name:de': 'Mühleweiher' },
    ring: lakeRing(40, 8.52, 47.31, 80, 1)
  },
  { kind: 'way', id: 102, tags: { landuse: 'reservoir' }, ring: lakeRing(25, 8.55, 47.28, 60, 2) },
  {
    kind: 'relation',
    id: 201,
    tags: { type: 'multipolygon', natural: 'water', water: 'lake', name: 'Lake & "Islands"' },
    members: [
      { ref: 301, role: 'outer', ring: lakeRing(320, 8.5, 47.3, 1500, 3) },
      { ref: 302, role: 'inner', ring: lakeRing(30, 8.5, 47.3, 200, 4) },
      { ref: 303, role: 'outer', ring: lakeRing(260, 8.58, 47.33, 300, 5) }
    ]
  }
]

/** Parse XML text as the browser's `DOMParser` does (xmldom stands in for it under Node). */
export function parseXml(text: string): XmlDocument {
  return new DOMParser().parseFromString(text, 'text/xml')
}
