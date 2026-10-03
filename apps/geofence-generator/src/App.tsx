import { useRef, useState } from 'react'
import { Crop, Search } from 'lucide-react'
import {
  ControlGroup,
  ErrorBanner,
  RailCard,
  Section,
  ToolPage,
  downloadText,
  toolById,
  toolReadme,
  useLoading
} from '@apwt/tool-shell'
import { cropFeatures, featureName, splitPolygons, type OsmFeature, type WaterPolygon } from './analysis/features.js'
import { fenceFileName, formatWaypoints, generateFence, previewFence, type Fence } from './analysis/fence.js'
import type { Ring } from './analysis/geo.js'
import { MIN_SEARCH_ZOOM, WATER_TAGS } from './analysis/overpass.js'
import type { Place } from './analysis/places.js'
import { SIMPLIFY_LIMITS } from './analysis/simplify.js'
import { fetchWaterFeatures } from './net/overpass.js'
import { FeatureTable } from './ui/FeatureTable.js'
import { FenceMap, type FenceMapHandle, type MapState } from './ui/FenceMap.js'
import { FencePreview } from './ui/FencePreview.js'
import { PlaceSearch } from './ui/PlaceSearch.js'

/** The fence the next download would write, for one polygon in one state of its rings. */
interface Preview {
  readonly source: WaterPolygon
  /** Download count when it was made: every download rotates the rings, so it then goes stale. */
  readonly downloads: number
  readonly fence: Fence
}

function nameOf(polygon: WaterPolygon) {
  return featureName(polygon.tags, navigator.language)
}

function labelOf(polygon: WaterPolygon): string {
  return nameOf(polygon).label
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function App() {
  const { run } = useLoading()
  const mapRef = useRef<FenceMapHandle>(null)
  const [mapState, setMapState] = useState<MapState | null>(null)
  // Upstream state: every feature of the last successful search, the polygons on the map (all of
  // them, or the cropped ones), and whether a search was ever started (which enables Crop).
  const [features, setFeatures] = useState<readonly OsmFeature[]>([])
  const [polygons, setPolygons] = useState<readonly WaterPolygon[]>([])
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchNotice, setSearchNotice] = useState<string | null>(null)
  const [cropError, setCropError] = useState<string | null>(null)
  const [crop, setCrop] = useState<Ring | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Downloads edit the polygons' rings in place (as upstream); this counter re-renders after one.
  const [downloads, setDownloads] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)

  const selected = polygons.find((p) => p.key === selectedKey) ?? null
  const fence = preview !== null && preview.source === selected && preview.downloads === downloads ? preview.fence : null
  const zoom = mapState?.zoom ?? 0
  const canSearch = mapState !== null && zoom >= MIN_SEARCH_ZOOM

  const makePreview = async (polygon: WaterPolygon, downloadCount: number) => {
    const result = await run(() => previewFence(polygon.rings), 'Generating fence')
    setPreview({ source: polygon, downloads: downloadCount, fence: result })
  }

  /** Show `next` on the map, keeping the selection (and its preview) if that polygon is still there. */
  const showPolygons = (next: readonly WaterPolygon[]) => {
    setPolygons(next)
    const same = next.find((p) => p.key === selectedKey)
    if (same === undefined) setSelectedKey(null)
    else void makePreview(same, downloads)
  }

  /** Upstream `apply_crop`: clip every feature to the crop ring and show the result. */
  const applyCrop = (from: readonly OsmFeature[], ring: Ring) => {
    const result = cropFeatures(from, ring)
    setCropError(result.error === null ? null : `Cropping stopped: ${result.error.message}`)
    showPolygons(splitPolygons(result.features))
  }

  const search = async () => {
    const view = mapRef.current?.view() ?? null
    if (view === null) return
    if (view.zoom < MIN_SEARCH_ZOOM) {
      setSearchError('Please Zoom in')
      return
    }
    // As upstream, before the request: clear the map's polygons, remove the crop, enable Crop.
    setSearchError(null)
    setSearchNotice(null)
    setCropError(null)
    setPolygons([])
    setSelectedKey(null)
    setCrop(null)
    setSearched(true)
    try {
      const found = await run(() => fetchWaterFeatures(view.bounds), 'Searching OpenStreetMap')
      setFeatures(found.features)
      setSearchNotice(found.notice)
      setPolygons(splitPolygons(found.features))
    } catch (e) {
      // Upstream's page error; the previous features stay loaded (Crop still uses them).
      setSearchError(errorMessage(e))
    }
  }

  const addCrop = () => {
    const ring = mapRef.current?.addCrop() ?? null
    if (ring === null) return
    setCrop(ring)
    applyCrop(features, ring)
  }

  const moveCrop = (ring: Ring) => {
    setCrop(ring)
    applyCrop(features, ring)
  }

  const select = (key: string) => {
    setSelectedKey(key)
    const polygon = polygons.find((p) => p.key === key)
    if (polygon !== undefined) void makePreview(polygon, downloads)
  }

  const pickPlace = (place: Place) => mapRef.current?.fitBounds(place.bounds)

  /** Upstream `generate_fence`: generate (rotating the rings in place) and save the file. */
  const download = async (polygon: WaterPolygon) => {
    const text = await run(() => formatWaypoints(generateFence(polygon.rings)), 'Generating fence')
    downloadText(fenceFileName(nameOf(polygon).fileName), text)
    const count = downloads + 1
    setDownloads(count)
    void makePreview(polygon, count)
  }

  const tool = toolById('geofence-generator')

  const rail = (
    <RailCard>
      <ControlGroup label="Find a place">
        <PlaceSearch onPick={pickPlace} />
      </ControlGroup>

      <ControlGroup label="Water bodies">
        <div className="gf-stack">
          <button
            type="button"
            className="apwt-btn apwt-btn--primary apwt-btn--block"
            disabled={!canSearch}
            title={canSearch ? 'Search the current area' : 'Zoom in to enable search'}
            onClick={() => void search()}
          >
            <Search />
            Search this area
          </button>
          <p className="gf-hint">
            {canSearch
              ? 'Loads lakes, ponds and reservoirs in the visible map from OpenStreetMap.'
              : `Zoom in to level ${String(MIN_SEARCH_ZOOM)} or closer to search (now ${String(zoom)}). This keeps the request small.`}
          </p>
        </div>
      </ControlGroup>

      <ControlGroup label="Crop">
        <div className="gf-stack">
          <button
            type="button"
            className="apwt-btn apwt-btn--block"
            disabled={!searched}
            title="Add cropping polygon"
            onClick={addCrop}
          >
            <Crop />
            {crop === null ? 'Add crop polygon' : 'Reset crop to view'}
          </button>
          <p className="gf-hint">
            {searched
              ? 'Keeps only the part of each water body inside the red polygon. Drag its corners, or drag a midpoint to add a corner; the crop updates when a drag ends. Clicking a corner removes it at the next drag.'
              : 'Search an area first.'}
          </p>
        </div>
      </ControlGroup>

      <ControlGroup label="Simplification">
        <dl className="apwt-facts">
          <div>
            <dt>Drop detail under</dt>
            <dd>{SIMPLIFY_LIMITS.areaThresholdM2} m²</dd>
          </div>
          <div>
            <dt>Points per fence</dt>
            <dd>
              {SIMPLIFY_LIMITS.minNodes}–{SIMPLIFY_LIMITS.maxNodes}
            </dd>
          </div>
        </dl>
        <p className="gf-hint" style={{ marginTop: 10 }}>
          Round ponds become circle fences. As in the original tool, simplification does not check for crossing edges.
        </p>
      </ControlGroup>

      <ControlGroup label="OSM tags searched">
        <ul className="gf-hint" style={{ paddingLeft: 18, fontFamily: 'var(--mono)', fontSize: 12 }}>
          {WATER_TAGS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </ControlGroup>
    </RailCard>
  )

  return (
    <ToolPage
      title="Geofence Generator"
      readmeUrl={toolReadme(tool)}
      intro="Make ArduPilot fences for lakes, ponds and reservoirs from OpenStreetMap. The shoreline becomes an inclusion fence and islands become exclusion fences, saved as a waypoint file Mission Planner and MAVProxy can load. Needs an internet connection."
      rail={rail}
    >
      <Section
        title="Map"
        help="Locate the area you want to generate a fence for. Once zoomed in sufficiently you can search for features using the search button. Features will be loaded on to the map. Click a feature to see it below and download its fence. The crop button adds a cropping polygon allowing smaller sections to be downloaded."
      >
        <ErrorBanner message={searchError} />
        <ErrorBanner message={cropError} />
        {searchNotice !== null && <p className="gf-hint">{searchNotice}</p>}
        <FenceMap
          ref={mapRef}
          polygons={polygons}
          selectedKey={selectedKey}
          fence={fence}
          crop={crop}
          labelOf={labelOf}
          onSelect={select}
          onCropChange={moveCrop}
          onViewChange={setMapState}
        />
        <div className="gf-legend" aria-label="Legend">
          <span className="gf-key-feature">Water body</span>
          <span className="gf-key-selected">Selected</span>
          <span className="gf-key-inclusion">Inclusion fence</span>
          <span className="gf-key-exclusion">Exclusion fence</span>
          <span className="gf-key-crop">Crop</span>
        </div>
      </Section>

      <Section title="Fence" help="The selected water body and the fence its next download will contain.">
        {selected === null ? (
          <div className="apwt-empty">
            {searched
              ? 'Click a water body on the map or pick one below.'
              : 'Search an area, then click a water body on the map.'}
          </div>
        ) : (
          <FencePreview
            polygon={selected}
            label={labelOf(selected)}
            fence={fence}
            downloads={downloads}
            onGenerate={() => void makePreview(selected, downloads)}
            onDownload={() => void download(selected)}
          />
        )}
      </Section>

      {searched && (
        <Section title="Water bodies" help={`${String(polygons.length)} on the map${crop === null ? '' : ' inside the crop'}.`}>
          {polygons.length === 0 ? (
            <div className="apwt-empty">
              {crop === null ? 'No water bodies here. Move the map and search again.' : 'Nothing inside the crop. Move it.'}
            </div>
          ) : (
            <FeatureTable polygons={polygons} selectedKey={selectedKey} labelOf={labelOf} onSelect={select} />
          )}
        </Section>
      )}
    </ToolPage>
  )
}
