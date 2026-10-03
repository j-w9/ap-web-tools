/**
 * Metric grid overlay (upstream `SimpleGCS/grid.js`): lines at powers of ten metres in Web
 * Mercator units, corrected to ground distance at the map centre's latitude. Drawing is separated
 * from Leaflet through `GridView`, so the line positions can be tested.
 */

export interface GridPoint {
  readonly x: number
  readonly y: number
}

export interface LatLngLike {
  readonly lat: number
  readonly lng: number
}

/** What the grid needs from the map (a thin view over a Leaflet map). */
export interface GridView {
  size(): GridPoint
  bounds(): { north: number; south: number; east: number; west: number }
  centerLat(): number
  zoom(): number
  project(latLng: LatLngLike): GridPoint
  unproject(point: GridPoint): LatLngLike
  latLngToLayerPoint(latLng: LatLngLike): GridPoint
  containerPointToLayerPoint(point: GridPoint): GridPoint
}

/** The canvas 2D calls the grid makes. */
export interface GridContext {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  clearRect(x: number, y: number, w: number, h: number): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  lineWidth: number
  strokeStyle: string | CanvasGradient | CanvasPattern
}

export interface GridCanvas {
  width: number
  height: number
  readonly style: { width: string; height: string }
}

export interface GridOptions {
  readonly color: string
  readonly targetPx: number
  readonly lineWidth: number
}

export const GRID_DEFAULTS: GridOptions = { color: 'rgba(255, 235, 59, 0.6)', targetPx: 150, lineWidth: 1 }

export function metersPerPixel(latDeg: number, zoom: number): number {
  const R = 6378137 // Web Mercator sphere
  return (Math.cos((latDeg * Math.PI) / 180) * 2 * Math.PI * R) / (256 * Math.pow(2, zoom))
}

export function pickSpacingMeters(mpp: number, latitude: number, targetPx: number): number {
  const targetMeters = (targetPx || 150) * mpp
  const logTarget = Math.log10(Math.max(1, targetMeters))
  const p10 = Math.pow(10, Math.floor(logTarget)) // 1, 10, 100, ... metres in Web Mercator units
  return p10 / Math.cos((latitude * Math.PI) / 180) // correct to ground distance
}

/** Sizes the canvas for the device pixel ratio and draws the grid. */
export function drawGrid(
  canvas: GridCanvas,
  ctx: GridContext,
  view: GridView,
  dpr: number,
  opts: GridOptions = GRID_DEFAULTS
): void {
  const size = view.size()
  canvas.width = Math.round(size.x * dpr)
  canvas.height = Math.round(size.y * dpr)
  canvas.style.width = `${size.x}px`
  canvas.style.height = `${size.y}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Expand the drawing area so panning is seamless.
  const b = view.bounds()
  const latSpan = b.north - b.south
  const lngSpan = b.east - b.west
  const centerLat = view.centerLat()
  const spacingM = pickSpacingMeters(metersPerPixel(centerLat, view.zoom()), centerLat, opts.targetPx)

  const nw = view.project({ lat: b.north + latSpan * 2, lng: b.west - lngSpan * 2 })
  const se = view.project({ lat: b.south - latSpan * 2, lng: b.east + lngSpan * 2 })
  const minX = Math.min(nw.x, se.x)
  const maxX = Math.max(nw.x, se.x)
  const minY = Math.min(nw.y, se.y)
  const maxY = Math.max(nw.y, se.y)

  // Align the canvas with the layer origin.
  const topLeft = view.containerPointToLayerPoint({ x: 0, y: 0 })
  ctx.save()
  ctx.translate(-topLeft.x, -topLeft.y)
  ctx.lineWidth = opts.lineWidth || 1
  ctx.strokeStyle = opts.color || GRID_DEFAULTS.color
  ctx.beginPath()
  for (let x = Math.floor(minX / spacingM) * spacingM; x <= maxX; x += spacingM) {
    const p1 = view.latLngToLayerPoint(view.unproject({ x, y: minY }))
    const p2 = view.latLngToLayerPoint(view.unproject({ x, y: maxY }))
    ctx.moveTo(Math.round(p1.x) + 0.5, Math.round(p1.y))
    ctx.lineTo(Math.round(p2.x) + 0.5, Math.round(p2.y))
  }
  for (let y = Math.floor(minY / spacingM) * spacingM; y <= maxY; y += spacingM) {
    const p1 = view.latLngToLayerPoint(view.unproject({ x: minX, y }))
    const p2 = view.latLngToLayerPoint(view.unproject({ x: maxX, y }))
    ctx.moveTo(Math.round(p1.x), Math.round(p1.y) + 0.5)
    ctx.lineTo(Math.round(p2.x), Math.round(p2.y) + 0.5)
  }
  ctx.stroke()
  ctx.restore()
}
