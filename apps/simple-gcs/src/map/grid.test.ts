// Port of upstream tests/grid.test.cjs: line positions are identical in CSS pixels at any DPR.
import { describe, expect, it } from 'vitest'
import { drawGrid, type GridCanvas, type GridContext, type GridView } from './grid.js'

function draw(dpr: number): number[][] {
  const lines: number[][] = []
  let scale = 1
  let dx = 0
  let dy = 0
  const ctx: GridContext = {
    lineWidth: 1,
    strokeStyle: '',
    setTransform: (a) => void (scale = a),
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    translate: (x, y) => void ((dx = x), (dy = y)),
    moveTo: (x, y) => void lines.push([((x + dx) * scale) / dpr, ((y + dy) * scale) / dpr]),
    lineTo() {}
  }
  const canvas: GridCanvas = { width: 0, height: 0, style: { width: '', height: '' } }
  // Upstream's stub: identity projection, a 10x10 bounds stub (also returned for the expanded
  // bounds), container origin at layer (3, 7) and 10 layer px per unit.
  const view: GridView = {
    size: () => ({ x: 100, y: 100 }),
    bounds: () => ({ north: 10, south: 0, west: 0, east: 10 }),
    centerLat: () => 0,
    zoom: () => 20,
    project: (p) => ({ x: p.lng, y: p.lat }),
    unproject: (p) => ({ lat: p.y, lng: p.x }),
    latLngToLayerPoint: (p) => ({ x: p.lng * 10, y: p.lat * 10 }),
    containerPointToLayerPoint: () => ({ x: 3, y: 7 })
  }
  drawGrid(canvas, ctx, view, dpr)
  expect(canvas.width).toBe(100 * dpr)
  return lines
}

describe('MetricGrid', () => {
  it('grid positions and spacing are identical in CSS pixels at DPR 1, 2 and 3', () => {
    const expected = draw(1)
    expect(expected.length).toBeGreaterThan(2)
    expect(draw(2)).toEqual(expected)
    expect(draw(3)).toEqual(expected)
  })
})
