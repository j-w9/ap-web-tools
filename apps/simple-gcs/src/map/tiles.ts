/** Base map providers (upstream `SimpleGCS/map.js`, `applyTileProvider`, and the Settings list). */

export interface XyzProvider {
  readonly kind: 'xyz'
  readonly url: string
  readonly maxZoom: number
  readonly subdomains?: string
  readonly attribution: string
  /** Light tiles that the dark theme inverts (presentation only). */
  readonly invertInDark: boolean
}

export interface GoogleProvider {
  readonly kind: 'google'
  readonly type: 'roadmap' | 'terrain' | 'satellite' | 'hybrid'
}

export const TILE_PROVIDERS = {
  osm: {
    kind: 'xyz',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: '© OpenStreetMap',
    invertInDark: true
  },
  opentopomap: {
    kind: 'xyz',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    maxZoom: 17,
    attribution: '© OpenTopoMap (CC-BY-SA)',
    invertInDark: true
  },
  'carto-light': {
    kind: 'xyz',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap © CARTO',
    invertInDark: true
  },
  'carto-dark': {
    kind: 'xyz',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    maxZoom: 20,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap © CARTO',
    invertInDark: false
  },
  'esri-world-imagery': {
    kind: 'xyz',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 20,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    invertInDark: false
  },
  'au-ga-topo': {
    kind: 'xyz',
    url: 'https://services.ga.gov.au/gis/rest/services/NationalBaseMap/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 20,
    attribution: '© Geoscience Australia',
    invertInDark: true
  },
  'uk-os-opendata': {
    kind: 'xyz',
    url: 'https://tiles.arcgis.com/tiles/knu9Ytn4VsWTJ4CG/arcgis/rest/services/OS_Open_Zoomstack_3857/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 20,
    attribution: '© Ordnance Survey OpenData',
    invertInDark: true
  },
  google: { kind: 'google', type: 'roadmap' },
  'google-terrain': { kind: 'google', type: 'terrain' },
  'google-satellite': { kind: 'google', type: 'satellite' },
  'google-hybrid': { kind: 'google', type: 'hybrid' }
} as const satisfies Record<string, XyzProvider | GoogleProvider>

export type TileProviderId = keyof typeof TILE_PROVIDERS

/** Settings list order and labels. */
export const TILE_PROVIDER_LABELS: readonly (readonly [TileProviderId, string])[] = [
  ['osm', 'OpenStreetMap (default)'],
  ['opentopomap', 'OpenTopoMap'],
  ['carto-light', 'Carto Light'],
  ['carto-dark', 'Carto Dark'],
  ['esri-world-imagery', 'Esri World Imagery (Satellite)'],
  ['au-ga-topo', 'Australia — Geoscience Topographic'],
  ['uk-os-opendata', 'UK — Ordnance Survey OpenData'],
  ['google', 'Google Maps (Roadmap)'],
  ['google-terrain', 'Google Maps (Terrain)'],
  ['google-satellite', 'Google Maps (Satellite)'],
  ['google-hybrid', 'Google Maps (Hybrid)']
]

export const isTileProvider = (id: string): id is TileProviderId => Object.hasOwn(TILE_PROVIDERS, id)

/** Providers offered in Settings: Google ones only with an API key. */
export function availableProviders(hasGoogleKey: boolean): readonly (readonly [TileProviderId, string])[] {
  return TILE_PROVIDER_LABELS.filter(([id]) => hasGoogleKey || !id.startsWith('google'))
}
