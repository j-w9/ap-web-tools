/** Leaflet binding of the metric grid (upstream `SimpleGCS/grid.js` `on`/`off`). */
import * as L from 'leaflet'
import { drawGrid, type GridView } from './grid.js'

function viewOf(map: L.Map): GridView {
  const crs = map.options.crs ?? L.CRS.EPSG3857
  return {
    size: () => map.getSize(),
    bounds: () => {
      const b = map.getBounds()
      return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }
    },
    centerLat: () => map.getCenter().lat,
    zoom: () => map.getZoom(),
    project: (ll) => crs.project(L.latLng(ll.lat, ll.lng)),
    unproject: (p) => crs.unproject(L.point(p.x, p.y)),
    latLngToLayerPoint: (ll) => map.latLngToLayerPoint(L.latLng(ll.lat, ll.lng)),
    containerPointToLayerPoint: (p) => map.containerPointToLayerPoint(L.point(p.x, p.y))
  }
}

/** Adds the grid canvas to the overlay pane; returns a function removing it. */
export function addMetricGrid(map: L.Map): () => void {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute; top:0; left:0; pointer-events:none;'
  const ctx = canvas.getContext('2d')
  map.getPanes().overlayPane.appendChild(canvas)
  const view = viewOf(map)
  const draw = (): void => {
    if (ctx !== null) drawGrid(canvas, ctx, view, window.devicePixelRatio || 1)
  }
  const updatePosition = (): void => {
    const topLeft = map.containerPointToLayerPoint([0, 0])
    canvas.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px)`
  }
  map.on('zoom move', updatePosition)
  map.on('moveend zoomend resize viewreset', draw)
  draw()
  updatePosition()
  return () => {
    map.off('zoom move', updatePosition)
    map.off('moveend zoomend resize viewreset', draw)
    canvas.remove()
  }
}
