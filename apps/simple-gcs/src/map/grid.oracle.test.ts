// Differential test: upstream `SimpleGCS/grid.js` (run in node:vm, as upstream's own test does)
// and the port's `drawGrid` draw onto recording canvases for the same map views. Every canvas call
// (size, transform, clear, translate, style and each line) must match.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { upstreamSource } from '../test-utils/upstream.js'
import { drawGrid, type GridCanvas, type GridContext, type GridPoint, type GridView, type LatLngLike } from './grid.js'

interface ViewCase {
  readonly north: number
  readonly south: number
  readonly east: number
  readonly west: number
  readonly centerLat: number
  readonly zoom: number
  readonly dpr: number
  readonly size: GridPoint
  readonly origin: GridPoint
}

/** Equirectangular stand-in for the Web Mercator CRS, in metres at the equator. */
const K = (6378137 * Math.PI) / 180

function geometry(c: ViewCase) {
  const pxPerUnit = c.size.x / ((c.east - c.west) * K)
  return {
    project: (ll: LatLngLike): GridPoint => ({ x: ll.lng * K, y: -ll.lat * K }),
    unproject: (p: GridPoint): LatLngLike => ({ lat: -p.y / K, lng: p.x / K }),
    layer: (ll: LatLngLike): GridPoint => ({
      x: (ll.lng - c.west) * K * pxPerUnit + c.origin.x,
      y: (c.north - ll.lat) * K * pxPerUnit + c.origin.y
    })
  }
}

function recorder() {
  const calls: unknown[][] = []
  const ctx: GridContext = {
    set lineWidth(v: number) {
      calls.push(['lineWidth', v])
    },
    get lineWidth() {
      return 0
    },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
      calls.push(['strokeStyle', v])
    },
    get strokeStyle() {
      return ''
    },
    setTransform: (...a) => void calls.push(['setTransform', ...a]),
    clearRect: (...a) => void calls.push(['clearRect', ...a]),
    save: () => void calls.push(['save']),
    restore: () => void calls.push(['restore']),
    translate: (...a) => void calls.push(['translate', ...a]),
    beginPath: () => void calls.push(['beginPath']),
    moveTo: (...a) => void calls.push(['moveTo', ...a]),
    lineTo: (...a) => void calls.push(['lineTo', ...a]),
    stroke: () => void calls.push(['stroke'])
  }
  const canvas: GridCanvas & { style: { width: string; height: string; cssText?: string } } = {
    width: 0,
    height: 0,
    style: { width: '', height: '' }
  }
  return { calls, ctx, canvas }
}

function upstreamDraw(c: ViewCase) {
  const { calls, ctx, canvas } = recorder()
  const g = geometry(c)
  const bounds = (s: number, w: number, n: number, e: number) => ({
    getNorth: () => n,
    getSouth: () => s,
    getEast: () => e,
    getWest: () => w,
    getNorthWest: () => ({ lat: n, lng: w }),
    getSouthEast: () => ({ lat: s, lng: e })
  })
  const map = {
    getPanes: () => ({ overlayPane: { appendChild() {} } }),
    getSize: () => c.size,
    getBounds: () => bounds(c.south, c.west, c.north, c.east),
    getCenter: () => ({ lat: c.centerLat }),
    getZoom: () => c.zoom,
    options: { crs: { project: g.project, unproject: g.unproject } },
    containerPointToLayerPoint: () => c.origin,
    latLngToLayerPoint: g.layer,
    on() {}
  }
  const window = { devicePixelRatio: c.dpr }
  const L = {
    latLngBounds: ([[s, w], [n, e]]: [[number, number], [number, number]]) => bounds(s, w, n, e),
    point: (x: number, y: number) => ({ x, y })
  }
  runInNewContext(upstreamSource('SimpleGCS/grid.js'), {
    window,
    document: { createElement: () => Object.assign(canvas, { getContext: () => ctx }) },
    L
  })
  const api = Reflect.get(window, 'MetricGrid') as { init(m: unknown): void; on(): void }
  api.init(map)
  api.on()
  return { calls, canvas: { width: canvas.width, height: canvas.height, w: canvas.style.width, h: canvas.style.height } }
}

function portDraw(c: ViewCase) {
  const { calls, ctx, canvas } = recorder()
  const g = geometry(c)
  const view: GridView = {
    size: () => c.size,
    bounds: () => ({ north: c.north, south: c.south, east: c.east, west: c.west }),
    centerLat: () => c.centerLat,
    zoom: () => c.zoom,
    project: g.project,
    unproject: g.unproject,
    latLngToLayerPoint: g.layer,
    containerPointToLayerPoint: () => c.origin
  }
  drawGrid(canvas, ctx, view, c.dpr)
  return { calls, canvas: { width: canvas.width, height: canvas.height, w: canvas.style.width, h: canvas.style.height } }
}

const CASES: ViewCase[] = [
  {
    north: 0.01,
    south: 0,
    east: 0.02,
    west: 0,
    centerLat: 0.005,
    zoom: 16,
    dpr: 1,
    size: { x: 800, y: 400 },
    origin: { x: 3, y: 7 }
  },
  {
    north: -35.3,
    south: -35.4,
    east: 149.2,
    west: 149.0,
    centerLat: -35.35,
    zoom: 13,
    dpr: 2,
    size: { x: 1024, y: 512 },
    origin: { x: -120, y: 40 }
  },
  {
    north: 51.52,
    south: 51.5,
    east: -0.1,
    west: -0.14,
    centerLat: 51.51,
    zoom: 15,
    dpr: 3,
    size: { x: 390, y: 700 },
    origin: { x: 0, y: 0 }
  },
  {
    north: 64.2,
    south: 64.0,
    east: -21.5,
    west: -22.2,
    centerLat: 64.1,
    zoom: 11.5,
    dpr: 1.25,
    size: { x: 1366, y: 600 },
    origin: { x: 55.5, y: -9.25 }
  },
  {
    north: 0.0005,
    south: 0.0004,
    east: 0.0011,
    west: 0.001,
    centerLat: 0.00045,
    zoom: 22,
    dpr: 1,
    size: { x: 300, y: 300 },
    origin: { x: 1, y: 1 }
  }
]

describe('MetricGrid oracle (upstream grid.js)', () => {
  it.each(CASES.map((c, i) => [i, c] as const))('case %i draws identically', (_i, c) => {
    const up = upstreamDraw(c)
    const port = portDraw(c)
    expect(port.canvas).toEqual(up.canvas)
    expect(up.calls.filter((call) => call[0] === 'moveTo').length).toBeGreaterThan(2)
    expect(port.calls).toEqual(up.calls)
  })
})
