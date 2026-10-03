import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// Adds polygon vertex editing (`enableEdit`) to Leaflet, as upstream loads Leaflet.Editable.
import 'leaflet-editable'
import { useLatest } from '@apwt/tool-shell'
import type { WaterPolygon } from '../analysis/features.js'
import type { Fence } from '../analysis/fence.js'
import { isRing, openRing, type Bounds, type Position, type Ring } from '../analysis/geo.js'
import { cropCornersPx, type MapView } from '../analysis/view.js'
import { loadView, saveView } from './view-storage.js'
import './map.css'

/** What the map reports about its current view. */
export interface MapState {
  readonly bounds: Bounds
  readonly zoom: number
}

/** Imperative actions on the map, for events that come from outside it. */
export interface FenceMapHandle {
  fitBounds(bounds: Bounds): void
  /** The view as it is now (upstream reads `map.getBounds()` when Search is pressed). */
  view(): MapState | null
  /**
   * Replace the crop polygon with upstream's starting rectangle for the current view and return
   * its ring as `toGeoJSON()` gives it (upstream `add_crop`).
   */
  addCrop(): Ring | null
}

export interface FenceMapProps {
  polygons: readonly WaterPolygon[]
  selectedKey: string | null
  /** Generated fence for the selected polygon, drawn over it. */
  fence: Fence | null
  /** Crop polygon (closed ring, as `toGeoJSON()` gives it), editable on the map. */
  crop: Ring | null
  labelOf: (polygon: WaterPolygon) => string
  onSelect: (key: string) => void
  onCropChange: (ring: Ring) => void
  onViewChange: (state: MapState) => void
  ref?: Ref<FenceMapHandle>
}

// OpenStreetMap's standard tiles. Upstream used the old `http://{s}.tile.osm.org` alias, which
// browsers block as mixed content; this is the current HTTPS URL. The tile layer keeps Leaflet's
// default `maxZoom` (18), as upstream, so the same zoom levels (and search areas) are reachable.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const COLORS = {
  feature: '#3388ff',
  selected: '#facc15',
  inclusion: '#22c55e',
  exclusion: '#f97316',
  crop: '#ef4444'
} as const

const toLatLng = ([lon, lat]: Position): L.LatLngTuple => [lat, lon]

function boundsOf(map: L.Map): MapState {
  const b = map.getBounds()
  return { bounds: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, zoom: map.getZoom() }
}

/**
 * The crop polygon's ring as upstream feeds it to Turf: `toGeoJSON()`, which closes the ring and
 * rounds coordinates to 6 decimals.
 */
function cropRing(polygon: L.Polygon): Ring {
  const geometry = polygon.toGeoJSON().geometry
  if (geometry.type !== 'Polygon') return []
  const ring = geometry.coordinates[0]
  return isRing(ring) ? ring : []
}

/**
 * The Leaflet map: OSM tiles, found water polygons (click to select), the generated fence for
 * the selection, and the editable crop polygon. Leaflet is an external system, so it is driven
 * from effects that mirror the props onto layers.
 */
export function FenceMap({
  polygons,
  selectedKey,
  fence,
  crop,
  labelOf,
  onSelect,
  onCropChange,
  onViewChange,
  ref
}: FenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const featureLayer = useRef<L.LayerGroup | null>(null)
  const fenceLayer = useRef<L.LayerGroup | null>(null)
  const cropLayer = useRef<L.Polygon | null>(null)
  // The ring this map last reported, so an echo of our own edit does not rebuild the crop layer.
  const reportedCrop = useRef<Ring | null>(null)
  const callbacks = useLatest({ onSelect, onCropChange, onViewChange, labelOf })

  useImperativeHandle(ref, () => ({
    fitBounds(b: Bounds) {
      mapRef.current?.fitBounds([
        [b.south, b.west],
        [b.north, b.east]
      ])
    },
    view() {
      const map = mapRef.current
      return map === null ? null : boundsOf(map)
    },
    addCrop() {
      const map = mapRef.current
      if (map === null) return null
      const bb = map.getBounds()
      const corners = cropCornersPx(map.project(bb.getNorthEast()), map.project(bb.getSouthWest()))
      cropLayer.current?.remove()
      const layer = L.polygon(
        corners.map((c) => map.unproject(c)),
        { color: COLORS.crop, fill: false, weight: 2 }
      ).addTo(map)
      layer.enableEdit(map)
      cropLayer.current = layer
      const ring = cropRing(layer)
      reportedCrop.current = ring
      return ring
    }
  }))

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const map = L.map(container, { editable: true, zoomControl: true })
    const view: MapView = loadView()
    map.setView([view.lat, view.lng], view.zoom)
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION }).addTo(map)
    featureLayer.current = L.layerGroup().addTo(map)
    fenceLayer.current = L.layerGroup().addTo(map)

    const report = () => {
      const state = boundsOf(map)
      const center = map.getCenter()
      saveView({ lat: center.lat, lng: center.lng, zoom: state.zoom })
      callbacks.current.onViewChange(state)
    }
    // Upstream re-applies the crop only when a vertex drag ends (adding a vertex by dragging a
    // midpoint ends with one too); deleting a vertex leaves the crop as it was until the next drag.
    const onEdited = () => {
      const layer = cropLayer.current
      if (layer === null) return
      const ring = cropRing(layer)
      reportedCrop.current = ring
      callbacks.current.onCropChange(ring)
    }
    map.on('moveend', report)
    map.on('editable:vertex:dragend', onEdited)
    mapRef.current = map
    report()

    // The map card can change size with the layout (rail stacking); keep tiles filling it.
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)

    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
      featureLayer.current = null
      fenceLayer.current = null
      cropLayer.current = null
      reportedCrop.current = null
    }
  }, [callbacks])

  // Water polygons, with the selection highlighted.
  useEffect(() => {
    const group = featureLayer.current
    if (group === null) return
    group.clearLayers()
    for (const polygon of polygons) {
      const selected = polygon.key === selectedKey
      const color = selected ? COLORS.selected : COLORS.feature
      const layer = L.polygon(
        polygon.rings.map((ring) => ring.map(toLatLng)),
        { color, weight: selected ? 3 : 2, fillOpacity: selected ? 0.3 : 0.2 }
      )
      layer.bindTooltip(callbacks.current.labelOf(polygon), { sticky: true })
      layer.on('click', () => callbacks.current.onSelect(polygon.key))
      group.addLayer(layer)
    }
  }, [polygons, selectedKey, callbacks])

  // Generated fence preview.
  useEffect(() => {
    const group = fenceLayer.current
    if (group === null) return
    group.clearLayers()
    for (const item of fence ?? []) {
      const color = item.role === 'inclusion' ? COLORS.inclusion : COLORS.exclusion
      const style: L.PathOptions = { color, weight: 2, dashArray: '6 4', fill: false, interactive: false }
      switch (item.kind) {
        case 'polygon':
          group.addLayer(
            L.polygon(
              item.vertices.map((v): L.LatLngTuple => [v.lat, v.lon]),
              style
            )
          )
          for (const v of item.vertices) {
            group.addLayer(L.circleMarker([v.lat, v.lon], { radius: 2.5, color, weight: 1, fillOpacity: 1, interactive: false }))
          }
          break
        case 'circle':
          group.addLayer(L.circle([item.center.lat, item.center.lon], { ...style, radius: item.radiusM }))
          break
      }
    }
  }, [fence])

  // Editable crop polygon (upstream draws it red, unfilled). `addCrop` and vertex drags create or
  // move the layer themselves; this only removes it, or rebuilds it for a ring from elsewhere.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return
    if (crop !== null && crop === reportedCrop.current && cropLayer.current !== null) return
    cropLayer.current?.remove()
    cropLayer.current = null
    reportedCrop.current = crop
    if (crop === null) return
    const layer = L.polygon(openRing(crop).map(toLatLng), { color: COLORS.crop, fill: false, weight: 2 }).addTo(map)
    layer.enableEdit(map)
    cropLayer.current = layer
  }, [crop])

  return <div ref={containerRef} className="gf-map" role="application" aria-label="Map" />
}
