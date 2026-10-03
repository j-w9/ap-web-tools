// Test-only: loads the vendored upstream GeofenceGenerator.js (with upstream Array_Math.js, which
// it relies on) into a vm context with stand-ins for the browser, Leaflet, Turf and FileSaver, so
// the TypeScript port can be compared against it on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import intersect from '@turf/intersect'
import { DOMParser } from '@xmldom/xmldom'
import osmtogeojson from 'osmtogeojson/osmtogeojson.js'

type Coordinates = number[][]

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

/** What upstream's popup for a map polygon shows, and its Download button. */
export interface UpstreamPopup {
  lines: string[]
  download(): Promise<{ text: string; fileName: string }>
}

/** A polygon layer upstream added to the map. */
export interface UpstreamLayer {
  feature: UpstreamFeature
  popup(): UpstreamPopup
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
  /** Runs upstream `generate_fence` (which edits `feature` in place) and returns the file it saves. */
  generateFence(feature: UpstreamFeature, name: string): Promise<{ text: string; fileName: string }>
  /** Runs upstream `request()` for a map view, answering the fetch with `responseXml`. */
  request(bounds: UpstreamBounds, zoom: number, responseXml: string): Promise<{ body: string; url: string; init: object }>
  /** Runs upstream `request()` with a fetch that rejects. */
  requestFailing(bounds: UpstreamBounds, zoom: number): Promise<unknown>
  /** Upstream `features` (the last successful search). */
  features(): UpstreamFeature[]
  /** The polygon layers currently on upstream's map. */
  layers(): UpstreamLayer[]
  /** Whether upstream's crop polygon exists. */
  hasCrop(): boolean
  /**
   * Runs upstream `add_crop` with a projection stand-in; `project` maps a lat/lng to pixels, and
   * the crop polygon's `toGeoJSON()` returns `cropRing`. Returns the pixel points it unprojected.
   */
  addCrop(
    bounds: UpstreamBounds,
    project: (latlng: { lat: number; lng: number }) => { x: number; y: number },
    cropRing: number[][]
  ): number[][]
  /** Upstream's `editable:vertex:dragend` handler: the crop now has `cropRing`. */
  dragCrop(cropRing: number[][]): void
}

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../upstream')

interface FakeNode {
  text?: string
  children: FakeNode[]
  attributes: Record<string, string>
  listeners: Record<string, () => void>
}

function fakeNode(): FakeNode {
  return { children: [], attributes: {}, listeners: {} }
}

/** Load a fresh upstream context. */
export function loadUpstream(): Upstream {
  const library = readFileSync(resolve(upstreamDir, 'Libraries/Array_Math.js'), 'utf8')
  // Drop the top-level CDN `import()` of osmtogeojson; the same build from npm is provided instead.
  const tool = readFileSync(resolve(upstreamDir, 'GeofenceGenerator/GeofenceGenerator.js'), 'utf8').replace(/^import\(.*$/m, '')

  const saved: { text: string; fileName: string }[] = []
  const fetchCalls: { url: string; body: string; init: object }[] = []
  const layers: { feature: UpstreamFeature; popup: (layer: { feature: UpstreamFeature }) => FakeNode; removed: boolean }[] = []
  let fetchResponse: () => Promise<{ text: () => Promise<string> }> = () => Promise.reject(new Error('no response'))
  let view = { bounds: { south: 0, west: 0, north: 0, east: 0 }, zoom: 0 }
  let project: (latlng: { lat: number; lng: number }) => { x: number; y: number } = () => ({ x: 0, y: 0 })
  let unprojected: number[][] = []
  let cropGeoJson: number[][] = []
  let cropAlive = false
  const pendingDownloads: Promise<void>[] = []

  const context = createContext({
    console,
    osmtogeojson,
    DOMParser,
    turf: { intersect },
    alert: (msg: string) => {
      throw new Error(`upstream alert: ${msg}`)
    },
    document: {
      getElementById: () => ({ disabled: false }),
      createElement: () => {
        const node = fakeNode()
        return {
          node,
          appendChild: (child: { node?: FakeNode; text?: string }) =>
            node.children.push(child.node ?? { ...fakeNode(), text: child.text ?? '' }),
          setAttribute: (k: string, v: string) => (node.attributes[k] = v),
          addEventListener: (k: string, fn: () => void) => (node.listeners[k] = fn)
        }
      },
      createTextNode: (text: string) => ({ text })
    },
    navigator: { language: 'en-GB' },
    loading_call: (fn: () => Promise<void>) => pendingDownloads.push(fn()),
    Blob: class {
      readonly text: string
      constructor(parts: string[]) {
        this.text = parts.join('')
      }
    },
    saveAs: (blob: { text: string }, fileName: string) => saved.push({ text: blob.text, fileName }),
    fetch: (url: string, init: { body: string }) => {
      fetchCalls.push({ url, body: init.body, init })
      return fetchResponse()
    },
    map: {
      getZoom: () => view.zoom,
      getBounds: () => ({
        _southWest: { lat: view.bounds.south, lng: view.bounds.west },
        _northEast: { lat: view.bounds.north, lng: view.bounds.east }
      }),
      project: (latlng: { lat: number; lng: number }) => project(latlng),
      unproject: (point: number[]) => {
        unprojected.push([...point])
        return point
      }
    },
    L: {
      geoJSON: (feature: UpstreamFeature) => {
        const layer = { feature, popup: (_: { feature: UpstreamFeature }): FakeNode => fakeNode(), removed: false }
        layers.push(layer)
        const self = {
          bindPopup: (fn: (l: { feature: UpstreamFeature }) => { node: FakeNode }) => {
            layer.popup = (l) => fn(l).node
          },
          addTo: () => self,
          remove: () => {
            layer.removed = true
          }
        }
        return self
      },
      polygon: () => {
        cropAlive = true
        const self = {
          addTo: () => self,
          enableEdit: () => undefined,
          remove: () => {
            cropAlive = false
          },
          toGeoJSON: () => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cropGeoJson] } })
        }
        return self
      }
    }
  })
  runInContext(`${library}\n${tool}`, context, { filename: 'GeofenceGenerator.js' })
  const call = (expr: string): unknown => runInContext(expr, context)

  const lastFile = () => {
    const file = saved.pop()
    if (file === undefined) throw new Error('upstream saved nothing')
    return file
  }

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
      return lastFile()
    },
    async request(bounds, zoom, responseXml) {
      view = { bounds, zoom }
      fetchResponse = () => Promise.resolve({ text: () => Promise.resolve(responseXml) })
      const request = call('request') as () => Promise<void>
      await request()
      const fetched = fetchCalls.pop()
      if (fetched === undefined) throw new Error('upstream request made no fetch')
      return fetched
    },
    async requestFailing(bounds, zoom) {
      view = { bounds, zoom }
      fetchResponse = () => Promise.reject(new TypeError('Failed to fetch'))
      const request = call('request') as () => Promise<void>
      return request().then(
        () => null,
        (e: unknown) => e
      )
    },
    features: () => call('features') as UpstreamFeature[],
    layers: () =>
      layers
        .filter((l) => !l.removed)
        .map((l) => ({
          feature: l.feature,
          popup: () => {
            const node = l.popup({ feature: l.feature })
            const lines = node.children.filter((c) => c.text !== undefined).map((c) => c.text ?? '')
            const button = node.children.find((c) => c.attributes.value === 'Download')
            return {
              lines,
              async download() {
                button?.listeners.click?.()
                await pendingDownloads.pop()
                return lastFile()
              }
            }
          }
        })),
    hasCrop: () => cropAlive,
    addCrop(bounds, projectFn, cropRing) {
      view = { ...view, bounds }
      project = projectFn
      cropGeoJson = cropRing
      unprojected = []
      ;(call('add_crop') as () => void)()
      return unprojected
    },
    dragCrop(cropRing) {
      cropGeoJson = cropRing
      ;(call('apply_crop') as () => void)()
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
