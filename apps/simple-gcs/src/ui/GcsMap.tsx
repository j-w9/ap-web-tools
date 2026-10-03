import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useLatest } from '@apwt/tool-shell'
import { systemClock } from '../clock.js'
import { isInclusion, type FenceItem, type MissionPoint } from '../mission/mission-file.js'
import { loadGoogleMaps } from '../map/google-maps.js'
import { LongPressDetector } from '../map/long-press.js'
import { addMetricGrid } from '../map/metric-grid-layer.js'
import { TILE_PROVIDERS, type TileProviderId } from '../map/tiles.js'
import { UserLocation, type UserFix } from '../map/user-location.js'
import { vehicleSvg } from '../map/vehicle-icon.js'
import type { Position, VehicleMarker } from '../session.js'

export interface GcsMapProps {
  readonly marker: VehicleMarker | null
  readonly centerRequest: number
  readonly recenterRequest: number
  readonly stale: boolean
  readonly target: Position | null
  readonly fences: readonly FenceItem[]
  readonly fenceEnabled: boolean
  readonly mission: readonly MissionPoint[]
  readonly tiles: TileProviderId
  readonly googleKey: string
  readonly showGrid: boolean
  readonly showLocation: boolean
  readonly onLongPress: (lat: number, lng: number) => void
  readonly toast: (message: string) => void
  /** Overlays drawn above the map (the video inset). */
  readonly children?: ReactNode
}

/** Fence style; dashed and thinner while the fence is disabled. */
function fenceStyle(fence: FenceItem, enabled: boolean): L.PathOptions {
  const color = isInclusion(fence.type) ? '#4caf50' : '#f44336'
  return {
    color,
    fillColor: color,
    fillOpacity: 0,
    weight: enabled ? 6 : 3,
    opacity: 1,
    ...(enabled ? {} : { dashArray: '6,6' })
  }
}

/** Upstream's long-press exclusions: controls, popups, the video panel and form elements. */
const EXCLUDED = '.leaflet-control, .leaflet-popup, #video-panel, button, input, select, textarea, a'

/**
 * The Leaflet map (upstream `SimpleGCS/map.js`, `fence.js`/`mission.js` rendering, `grid.js`,
 * `userloc.js`). Leaflet is an external system, so effects mirror props onto layers.
 */
export function GcsMap(props: GcsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const latest = useLatest(props)

  // Create the map once, with the scale bar, long press and iOS callout suppression.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const m = L.map(container, { zoomControl: true }).setView([0, 0], 2)
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 300 }).addTo(m)
    const el = m.getContainer()
    const noMenu = (e: Event): void => e.preventDefault()
    el.addEventListener('contextmenu', noMenu)

    const detector = new LongPressDetector(systemClock, (point) => {
      const ll = m.containerPointToLatLng(L.point(point.x, point.y))
      latest.current.onLongPress(ll.lat, ll.lng)
    })
    const pointer = (ev: PointerEvent) => ({
      pointerId: ev.pointerId,
      button: ev.button,
      pointerType: ev.pointerType,
      point: m.mouseEventToContainerPoint(ev),
      excluded: ev.target instanceof Element && ev.target.closest(EXCLUDED) !== null,
      preventDefault: () => ev.preventDefault()
    })
    const winDown = (ev: PointerEvent): void => detector.windowPointerDown(ev)
    const down = (ev: PointerEvent): void => detector.pointerDown(pointer(ev))
    const move = (ev: PointerEvent): void => detector.pointerMove(pointer(ev))
    const leave = (ev: PointerEvent): void => detector.pointerLeave(ev)
    const end = (ev: PointerEvent): void => detector.windowPointerEnd(ev)
    const blur = (): void => detector.blur()
    window.addEventListener('pointerdown', winDown, { capture: true })
    el.addEventListener('pointerdown', down, { passive: false })
    el.addEventListener('pointermove', move, { passive: false })
    el.addEventListener('pointerleave', leave)
    window.addEventListener('pointerup', end, { capture: true })
    window.addEventListener('pointercancel', end, { capture: true })
    window.addEventListener('blur', blur)
    const observer = new ResizeObserver(() => m.invalidateSize())
    observer.observe(container)
    setMap(m)
    return () => {
      observer.disconnect()
      detector.dispose()
      window.removeEventListener('pointerdown', winDown, { capture: true })
      window.removeEventListener('pointerup', end, { capture: true })
      window.removeEventListener('pointercancel', end, { capture: true })
      window.removeEventListener('blur', blur)
      el.removeEventListener('contextmenu', noMenu)
      m.remove()
      setMap(null)
    }
  }, [latest])

  // Base layer; Google types load the Maps API and fall back to OSM if it fails. Upstream reads
  // the key (`window.GMAPS_API_KEY`) only when a provider is applied: changing it in Settings does
  // not reload the map ("Refresh page to apply"), so the key is read through `latest`.
  const { tiles } = props
  useEffect(() => {
    if (map === null) return
    let layer: L.Layer | null = null
    let cancelled = false
    const addXyz = (id: TileProviderId): void => {
      const provider = TILE_PROVIDERS[id]
      const meta = provider.kind === 'xyz' ? provider : TILE_PROVIDERS.osm
      const options: L.TileLayerOptions = { maxZoom: meta.maxZoom, attribution: meta.attribution }
      if ('subdomains' in meta) options.subdomains = meta.subdomains
      layer = L.tileLayer(meta.url, options).addTo(map)
    }
    const provider = TILE_PROVIDERS[tiles]
    if (provider.kind === 'google') {
      loadGoogleMaps(latest.current.googleKey)
        .then(() => import('leaflet.gridlayer.googlemutant'))
        .then(({ default: GoogleMutant }) => {
          if (!cancelled) layer = new GoogleMutant({ type: provider.type }).addTo(map)
        })
        .catch(() => {
          if (!cancelled) addXyz('osm')
        })
    } else {
      addXyz(tiles)
    }
    return () => {
      cancelled = true
      layer?.remove()
    }
  }, [map, tiles, latest])

  // Vehicle marker, faded while telemetry is stale.
  const { marker, stale } = props
  const vehicleLayer = useRef<L.Marker | null>(null)
  useEffect(() => {
    if (map === null) return
    if (marker === null) {
      vehicleLayer.current?.remove()
      vehicleLayer.current = null
      return
    }
    const icon = L.divIcon({
      html: vehicleSvg(marker.vehicleClass, marker.headingDeg),
      className: 'veh-ico',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    })
    if (vehicleLayer.current === null) vehicleLayer.current = L.marker([marker.lat, marker.lon], { icon }).addTo(map)
    else vehicleLayer.current.setLatLng([marker.lat, marker.lon]).setIcon(icon)
    vehicleLayer.current.setOpacity(stale ? 0.4 : 1)
  }, [map, marker, stale])
  useEffect(() => () => void vehicleLayer.current?.remove(), [])

  // First position of a newly discovered vehicle: centre at zoom 16.
  const { centerRequest, recenterRequest } = props
  useEffect(() => {
    const m = latest.current.marker
    if (map !== null && centerRequest > 0 && m !== null) map.setView([m.lat, m.lon], 16)
  }, [map, centerRequest, latest])
  useEffect(() => {
    const m = latest.current.marker
    if (map !== null && recenterRequest > 0 && m !== null) map.setView([m.lat, m.lon], Math.max(map.getZoom(), 16))
  }, [map, recenterRequest, latest])

  // Guided target: one marker moved by each update (upstream `updateTargetPosition`), so an open
  // "Target Position" popup stays open while the target streams in.
  const { target } = props
  const targetLayer = useRef<L.CircleMarker | null>(null)
  useEffect(() => {
    if (map === null) return
    if (target === null) {
      targetLayer.current?.remove()
      targetLayer.current = null
      return
    }
    if (targetLayer.current === null) {
      targetLayer.current = L.circleMarker([target.lat, target.lon], {
        radius: 8,
        color: '#f44336',
        fillColor: '#f44336',
        fillOpacity: 0.6,
        weight: 2
      })
        .addTo(map)
        .bindPopup('Target Position')
    } else {
      targetLayer.current.setLatLng([target.lat, target.lon])
    }
  }, [map, target])
  useEffect(
    () => () => {
      targetLayer.current?.remove()
      targetLayer.current = null
    },
    []
  )

  // Fences.
  const { fences, fenceEnabled } = props
  useEffect(() => {
    if (map === null) return
    const layers = fences.map((fence, idx) => {
      const style = fenceStyle(fence, fenceEnabled)
      if (fence.kind === 'circle') {
        const layer = L.circle([fence.lat, fence.lng], { radius: fence.radius, ...style })
        if (fence.type === 5003) layer.bindPopup(`Circle Inclusion #${idx}<br>Radius: ${fence.radius}m`)
        return layer.addTo(map)
      }
      return L.polygon(
        fence.vertices.map((v): L.LatLngTuple => [v.lat, v.lng]),
        style
      ).addTo(map)
    })
    return () => layers.forEach((l) => l.remove())
  }, [map, fences, fenceEnabled])

  // Mission path with sequence labels.
  const { mission } = props
  useEffect(() => {
    if (map === null || !mission.length) return
    const layers: L.Layer[] = [
      L.polyline(
        mission.map((p): L.LatLngTuple => [p.lat, p.lng]),
        { color: '#2196f3', weight: 3, opacity: 0.9 }
      ).addTo(map)
    ]
    for (const p of mission) {
      layers.push(
        L.circleMarker([p.lat, p.lng], { radius: 5, color: '#0d47a1', fillColor: '#64b5f6', fillOpacity: 0.9, weight: 2 })
          .bindTooltip(String(p.seq), { permanent: true, direction: 'top', className: 'mission-wp-label' })
          .addTo(map)
      )
    }
    return () => layers.forEach((l) => l.remove())
  }, [map, mission])

  // Metric grid.
  const { showGrid } = props
  useEffect(() => {
    if (map === null || !showGrid) return
    return addMetricGrid(map)
  }, [map, showGrid])

  // My location.
  const { showLocation } = props
  useEffect(() => {
    if (map === null || !showLocation) return
    let dot: L.CircleMarker | null = null
    let ring: L.Circle | null = null
    const onFix = (fix: UserFix | null): void => {
      if (fix === null) {
        dot?.remove()
        ring?.remove()
        dot = ring = null
        return
      }
      const ll: L.LatLngTuple = [fix.lat, fix.lng]
      if (dot === null)
        dot = L.circleMarker(ll, { radius: 7, color: '#2962ff', fillColor: '#2962ff', fillOpacity: 0.9, weight: 2 })
          .addTo(map)
          .bindPopup('You are here')
      else dot.setLatLng(ll)
      if (ring === null)
        ring = L.circle(ll, { color: '#2962ff', weight: 1, dashArray: '4 2', fillOpacity: 0.08, radius: fix.accuracy }).addTo(map)
      else ring.setLatLng(ll).setRadius(fix.accuracy)
      // Upstream initialises with autoCenterFirstFix: false, so the map never follows the user.
    }
    const tracker = new UserLocation('geolocation' in navigator ? navigator.geolocation : undefined, systemClock, {
      toast: (m) => latest.current.toast(m),
      fix: onFix
    })
    tracker.start()
    return () => tracker.stop()
  }, [map, showLocation, latest])

  const invert = TILE_PROVIDERS[tiles].kind === 'xyz' && TILE_PROVIDERS[tiles].invertInDark
  return (
    <div className="gcs-map-wrap">
      <div ref={containerRef} className={`gcs-map${invert ? ' gcs-map--invert' : ''}`} />
      {props.children}
    </div>
  )
}
