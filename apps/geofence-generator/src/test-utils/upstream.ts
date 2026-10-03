// Test-only: loads the vendored upstream GeofenceGenerator.js (with upstream Array_Math.js, which
// it relies on) into a vm context with stand-ins for the browser, Leaflet and FileSaver, so the
// TypeScript port can be compared against it on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { DOMParser } from '@xmldom/xmldom'
import osmtogeojson from 'osmtogeojson'

type Coordinates = number[][]

export interface UpstreamFeature {
  id: string
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

export interface Upstream {
  convertToCartesian(points: Coordinates, len: number, origin: number[]): { x: number[]; y: number[] }
  convertFromCartesian(x: number[], y: number[], origin: number[]): { lat: number[]; lon: number[] }
  wrap_180(angle: number): number
  longitude_scale(lat: number): number
  polygon_area(x: number[], y: number[]): number
  triangle_area(x: number[], y: number[]): number
  line_intersects(a: number[], b: number[], c: number[], d: number[]): boolean
  simplify_poly(x: number[][], y: number[][]): { x: number[][]; y: number[][]; radius: (number | undefined)[] }
  /** Runs upstream `generate_fence` and returns the file it saves. */
  generateFence(feature: UpstreamFeature, name: string): Promise<{ text: string; fileName: string }>
  /** Runs upstream `request()` for a map view, answering the fetch with `responseXml`. */
  request(
    bounds: UpstreamBounds,
    zoom: number,
    responseXml: string
  ): Promise<{ body: string; url: string; features: UpstreamFeature[]; layers: UpstreamFeature[] }>
  /** Replace upstream `line_intersects` (used by `simplify_poly`) with another implementation. */
  setLineIntersects(fn: (a: number[], b: number[], c: number[], d: number[]) => boolean): void
}

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../upstream')

/** Load a fresh upstream context. */
export function loadUpstream(): Upstream {
  const library = readFileSync(resolve(upstreamDir, 'Libraries/Array_Math.js'), 'utf8')
  // Drop the top-level CDN `import()` of osmtogeojson; the npm build is provided instead.
  const tool = readFileSync(resolve(upstreamDir, 'GeofenceGenerator/GeofenceGenerator.js'), 'utf8').replace(/^import\(.*$/m, '')

  const saved: { text: string; fileName: string }[] = []
  const fetchCalls: { url: string; body: string }[] = []
  const layers: UpstreamFeature[] = []
  let fetchResponse = ''
  let view = { bounds: { south: 0, west: 0, north: 0, east: 0 }, zoom: 0 }

  const context = createContext({
    console,
    osmtogeojson,
    DOMParser,
    alert: (msg: string) => {
      throw new Error(`upstream alert: ${msg}`)
    },
    document: { getElementById: () => ({ disabled: false }) },
    navigator: { language: 'en-GB' },
    Blob: class {
      readonly text: string
      constructor(parts: string[]) {
        this.text = parts.join('')
      }
    },
    saveAs: (blob: { text: string }, fileName: string) => saved.push({ text: blob.text, fileName }),
    fetch: (url: string, init: { body: string }) => {
      fetchCalls.push({ url, body: init.body })
      return Promise.resolve({ text: () => Promise.resolve(fetchResponse) })
    },
    map: {
      getZoom: () => view.zoom,
      getBounds: () => ({
        _southWest: { lat: view.bounds.south, lng: view.bounds.west },
        _northEast: { lat: view.bounds.north, lng: view.bounds.east }
      })
    },
    L: {
      geoJSON: (feature: UpstreamFeature) => {
        layers.push(feature)
        return { bindPopup: () => undefined, addTo: () => undefined, remove: () => undefined }
      }
    }
  })
  runInContext(`${library}\n${tool}`, context, { filename: 'GeofenceGenerator.js' })
  const call = (expr: string): unknown => runInContext(expr, context)

  return {
    convertToCartesian: call('convertToCartesian') as Upstream['convertToCartesian'],
    convertFromCartesian: call('convertFromCartesian') as Upstream['convertFromCartesian'],
    wrap_180: call('wrap_180') as Upstream['wrap_180'],
    longitude_scale: call('longitude_scale') as Upstream['longitude_scale'],
    polygon_area: call('polygon_area') as Upstream['polygon_area'],
    triangle_area: call('triangle_area') as Upstream['triangle_area'],
    line_intersects: call('line_intersects') as Upstream['line_intersects'],
    simplify_poly: call('simplify_poly') as Upstream['simplify_poly'],
    async generateFence(feature, name) {
      const generate = call('generate_fence') as (f: UpstreamFeature, n: string) => Promise<void>
      await generate(feature, name)
      const file = saved.pop()
      if (file === undefined) throw new Error('upstream generate_fence saved nothing')
      return file
    },
    async request(bounds, zoom, responseXml) {
      view = { bounds, zoom }
      fetchResponse = responseXml
      layers.length = 0
      const request = call('request') as () => Promise<void>
      await request()
      const fetched = fetchCalls.pop()
      if (fetched === undefined) throw new Error('upstream request made no fetch')
      return { ...fetched, features: call('features') as UpstreamFeature[], layers: [...layers] }
    },
    setLineIntersects(fn) {
      context.line_intersects = fn
    }
  }
}

/** Deterministic PRNG (mulberry32) so random oracle comparisons are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
