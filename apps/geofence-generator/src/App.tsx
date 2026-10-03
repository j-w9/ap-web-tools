import { useMemo, useRef, useState } from 'react'
import { Crop, Search, X } from 'lucide-react'
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
import { cropFeatures, featureName, splitPolygons, type WaterFeature, type WaterPolygon } from './analysis/features.js'
import { fenceFileName, generateFence, type Fence } from './analysis/fence.js'
import type { Ring } from './analysis/geo.js'
import { MIN_SEARCH_ZOOM, WATER_TAGS } from './analysis/overpass.js'
import type { Place } from './analysis/places.js'
import { SIMPLIFY_LIMITS } from './analysis/simplify.js'
import { cropRectangle } from './analysis/view.js'
import { fetchWaterFeatures } from './net/overpass.js'
import { FeatureTable } from './ui/FeatureTable.js'
import { FenceMap, type FenceMapHandle, type MapState } from './ui/FenceMap.js'
import { FencePreview } from './ui/FencePreview.js'
import { PlaceSearch } from './ui/PlaceSearch.js'

/** The fence generated for a polygon; it applies only while that exact polygon is still selected. */
interface Generated {
  readonly source: WaterPolygon
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
  const [features, setFeatures] = useState<readonly WaterFeature[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [crop, setCrop] = useState<Ring | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [generated, setGenerated] = useState<Generated | null>(null)

  const polygons = useMemo(() => {
    if (features === null) return []
    return splitPolygons(crop === null ? features : cropFeatures(features, crop))
  }, [features, crop])
  const selected = polygons.find((p) => p.key === selectedKey) ?? null
  // Cropping rebuilds the polygons, so a fence made before the crop moved no longer applies.
  const fence = generated !== null && generated.source === selected ? generated.fence : null
  const zoom = mapState?.zoom ?? 0
  const canSearch = mapState !== null && zoom >= MIN_SEARCH_ZOOM

  const search = async () => {
    if (mapState === null) return
    setSearchError(null)
    try {
      const found = await run(() => fetchWaterFeatures(mapState.bounds), 'Searching OpenStreetMap')
      setFeatures(found)
      // A new search starts afresh, as upstream: no crop, no selection.
      setCrop(null)
      setSelectedKey(null)
      setGenerated(null)
    } catch (e) {
      setSearchError(errorMessage(e))
    }
  }

  const generate = async (polygon: WaterPolygon) => {
    const result = await run(() => generateFence(polygon.rings), 'Generating fence')
    setGenerated({ source: polygon, fence: result })
  }

  const select = (key: string) => {
    setSelectedKey(key)
    const polygon = polygons.find((p) => p.key === key)
    if (polygon !== undefined) void generate(polygon)
  }

  const pickPlace = (place: Place) => mapRef.current?.fitBounds(place.bounds)

  const download = (text: string) => {
    if (selected !== null) downloadText(fenceFileName(nameOf(selected).fileName), text)
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
            disabled={features === null || mapState === null}
            onClick={() => mapState !== null && setCrop(cropRectangle(mapState.bounds))}
          >
            <Crop />
            {crop === null ? 'Add crop polygon' : 'Reset crop to view'}
          </button>
          {crop !== null && (
            <button type="button" className="apwt-btn apwt-btn--ghost apwt-btn--block" onClick={() => setCrop(null)}>
              <X />
              Remove crop
            </button>
          )}
          <p className="gf-hint">
            {features === null
              ? 'Search an area first.'
              : 'Keeps only the part of each water body inside the red polygon. Drag its corners, drag a midpoint to add a corner, click a corner to remove it.'}
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
          Round ponds become circle fences. Shorelines are simplified without letting edges cross.
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
      <Section title="Map" help="Find the area, zoom in and search it, then click a water body to generate its fence.">
        <ErrorBanner message={searchError} />
        <FenceMap
          ref={mapRef}
          polygons={polygons}
          selectedKey={selectedKey}
          fence={fence}
          crop={crop}
          labelOf={labelOf}
          onSelect={select}
          onCropChange={setCrop}
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

      <Section title="Fence" help="The selected water body and the fence generated from it.">
        {selected === null ? (
          <div className="apwt-empty">
            {features === null
              ? 'Search an area, then click a water body on the map.'
              : 'Click a water body on the map or pick one below.'}
          </div>
        ) : (
          <FencePreview
            polygon={selected}
            label={labelOf(selected)}
            fence={fence}
            onGenerate={() => void generate(selected)}
            onDownload={download}
          />
        )}
      </Section>

      {features !== null && (
        <Section title="Water bodies" help={`${String(polygons.length)} found${crop === null ? '' : ' inside the crop'}.`}>
          {polygons.length === 0 ? (
            <div className="apwt-empty">
              {crop === null
                ? 'No water bodies here. Move the map and search again.'
                : 'Nothing inside the crop. Move or remove it.'}
            </div>
          ) : (
            <FeatureTable polygons={polygons} selectedKey={selectedKey} labelOf={labelOf} onSelect={select} />
          )}
        </Section>
      )}
    </ToolPage>
  )
}
