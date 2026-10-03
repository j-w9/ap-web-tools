// Test-only: loads the original GeofenceGenerator.js (with the upstream Array_Math.js it relies on)
// into a vm context with stand-ins for the browser, Leaflet and FileSaver, and the real Turf 6
// `intersect` and osmtogeojson builds. Trimmed copy of the app's oracle loader
// (apps/geofence-generator/src/test-utils/upstream.ts); it is copied, not imported.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const upstreamDir = resolve(root, 'upstream')

// Same packages the oracle uses: osmtogeojson 3.0.0-beta.5 and @xmldom/xmldom from the root, and
// @turf/intersect 6.5.0 (the page loads `@turf/turf@6`) from the geofence app's dependencies.
const rootRequire = createRequire(resolve(root, 'package.json'))
const appRequire = createRequire(resolve(root, 'apps/geofence-generator/package.json'))
const osmtogeojson = rootRequire('osmtogeojson/osmtogeojson.js') as unknown
const { DOMParser } = rootRequire('@xmldom/xmldom') as { DOMParser: unknown }
const intersect = (appRequire('@turf/intersect') as { default: unknown }).default

export interface UpstreamFeature {
  id?: string | number
  type: string
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}

export interface UpstreamBounds {
  south: number
  west: number
  north: number
  east: number
}

export interface UpstreamLayer {
  feature: UpstreamFeature
}

export interface Upstream {
  wrap_180(angle: number): number
  convertToCartesian(points: number[][], len: number, origin: number[]): { x: number[]; y: number[] }
  line_intersects(a: number[], b: number[], c: number[], d: number[]): boolean
  simplify_poly(x: number[][], y: number[][]): { x: number[][]; y: number[][]; radius: (number | undefined)[] }
  /** Runs upstream `generate_fence` (which edits `feature` in place) and returns the file it saves. */
  generateFence(feature: UpstreamFeature, name: string): Promise<{ text: string; fileName: string }>
  /** Runs upstream `request()` for a map view, answering the fetch with `responseXml`. */
  request(bounds: UpstreamBounds, zoom: number, responseXml: string): Promise<void>
  /** Runs upstream `request()` with a fetch that rejects; resolves to the rejection reason. */
  requestFailing(bounds: UpstreamBounds, zoom: number): Promise<unknown>
  /** Upstream `features` (the last successful search). */
  features(): UpstreamFeature[]
  /** The polygon layers currently on upstream's map. */
  layers(): UpstreamLayer[]
  /** Runs upstream `add_crop`; the crop polygon's `toGeoJSON()` returns `cropRing`. */
  addCrop(bounds: UpstreamBounds, cropRing: number[][]): void
}

/** Load a fresh upstream context. */
export function loadUpstream(): Upstream {
  const library = readFileSync(resolve(upstreamDir, 'Libraries/Array_Math.js'), 'utf8')
  // Drop the top-level CDN `import()` of osmtogeojson; the same build from npm is provided instead.
  const tool = readFileSync(resolve(upstreamDir, 'GeofenceGenerator/GeofenceGenerator.js'), 'utf8').replace(/^import\(.*$/m, '')

  const saved: { text: string; fileName: string }[] = []
  const layers: { feature: UpstreamFeature; removed: boolean }[] = []
  let fetchResponse: () => Promise<{ text: () => Promise<string> }> = () => Promise.reject(new Error('no response'))
  let view = { bounds: { south: 0, west: 0, north: 0, east: 0 }, zoom: 0 }
  let cropGeoJson: number[][] = []

  const context = createContext({
    console,
    osmtogeojson,
    DOMParser,
    turf: { intersect },
    alert: (msg: string) => {
      throw new Error(`upstream alert: ${msg}`)
    },
    document: { getElementById: () => ({ disabled: false }) },
    Blob: class {
      readonly text: string
      constructor(parts: string[]) {
        this.text = parts.join('')
      }
    },
    saveAs: (blob: { text: string }, fileName: string) => saved.push({ text: blob.text, fileName }),
    fetch: () => fetchResponse(),
    map: {
      getZoom: () => view.zoom,
      getBounds: () => ({
        _southWest: { lat: view.bounds.south, lng: view.bounds.west },
        _northEast: { lat: view.bounds.north, lng: view.bounds.east }
      }),
      project: (latlng: { lat: number; lng: number }) => ({ x: latlng.lng, y: -latlng.lat }),
      unproject: (point: number[]) => point
    },
    L: {
      geoJSON: (feature: UpstreamFeature) => {
        const layer = { feature, removed: false }
        layers.push(layer)
        const self = {
          bindPopup: () => self,
          addTo: () => self,
          remove: () => {
            layer.removed = true
          }
        }
        return self
      },
      polygon: () => {
        const self = {
          addTo: () => self,
          enableEdit: () => undefined,
          remove: () => undefined,
          toGeoJSON: () => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cropGeoJson] } })
        }
        return self
      }
    }
  })
  runInContext(`${library}\n${tool}`, context, { filename: 'GeofenceGenerator.js' })
  const call = (expr: string): unknown => runInContext(expr, context)

  return {
    wrap_180: call('wrap_180') as Upstream['wrap_180'],
    convertToCartesian: call('convertToCartesian') as Upstream['convertToCartesian'],
    line_intersects: call('line_intersects') as Upstream['line_intersects'],
    simplify_poly: call('simplify_poly') as Upstream['simplify_poly'],
    async generateFence(feature, name) {
      await (call('generate_fence') as (f: UpstreamFeature, n: string) => Promise<void>)(feature, name)
      const file = saved.pop()
      if (file === undefined) throw new Error('upstream saved nothing')
      return file
    },
    async request(bounds, zoom, responseXml) {
      view = { bounds, zoom }
      fetchResponse = () => Promise.resolve({ text: () => Promise.resolve(responseXml) })
      await (call('request') as () => Promise<void>)()
    },
    async requestFailing(bounds, zoom) {
      view = { bounds, zoom }
      fetchResponse = () => Promise.reject(new TypeError('Failed to fetch'))
      return (call('request') as () => Promise<void>)().then(
        () => null,
        (e: unknown) => e
      )
    },
    features: () => call('features') as UpstreamFeature[],
    layers: () => layers.filter((l) => !l.removed).map((l) => ({ feature: l.feature })),
    addCrop(bounds, cropRing) {
      view = { ...view, bounds }
      cropGeoJson = cropRing
      ;(call('add_crop') as () => void)()
    }
  }
}

/** Overpass `out geom` XML for closed or open ways, the form upstream's `request` parses. */
export function overpassWays(ways: { id: number; tags: Record<string, string>; ring: number[][] }[]): string {
  const body = ways
    .map((w) => {
      const closed = w.ring.length > 1 && w.ring[0]?.join() === w.ring[w.ring.length - 1]?.join()
      const nds = w.ring
        .map(
          ([lon, lat], i) =>
            `<nd ref="${closed && i === w.ring.length - 1 ? w.id * 1000 : w.id * 1000 + i}" lat="${lat}" lon="${lon}"/>`
        )
        .join('')
      const tags = Object.entries(w.tags)
        .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
        .join('')
      return `<way id="${w.id}">${nds}${tags}</way>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">${body}</osm>`
}

/**
 * Whether two segments properly cross (each one's endpoints strictly on opposite sides of the
 * other's line): the standard orientation test, with orient(p, q, r) = (q - p) x (r - p).
 */
export function segmentsCross(p1: number[], p2: number[], q1: number[], q2: number[]): boolean {
  const orient = (a: number[], b: number[], c: number[]) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)
  const d1 = orient(q1, q2, p1)
  const d2 = orient(q1, q2, p2)
  const d3 = orient(p1, p2, q1)
  const d4 = orient(p1, p2, q2)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Pairs of non-adjacent edges of a closed polygon (given as open vertex arrays) that cross. */
export function crossingEdges(x: number[], y: number[]): [number, number][] {
  const n = x.length
  const pt = (i: number) => [x[i % n]!, y[i % n]!]
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue
      if (segmentsCross(pt(i), pt(i + 1), pt(j), pt(j + 1))) out.push([i, j])
    }
  }
  return out
}
