/**
 * Persisted display and auto-fetch settings (upstream `SimpleGCS/app.js`, `AppSettings`, plus the
 * Google Maps key from `index.html`/Settings). Same storage keys as upstream.
 */
import type { SimpleGcsConfig } from './config.js'
import type { KeyValueStore } from './link/storage.js'
import { isTileProvider, type TileProviderId } from './map/tiles.js'

export interface AppSettings {
  /** Upstream stores any string; unknown providers fall back to OSM when drawn. */
  readonly tiles: string
  readonly autoFetchFence: boolean
  readonly autoFetchMission: boolean
  readonly showGPSNumSats: boolean
  readonly showGrid: boolean
  readonly showLocation: boolean
  /** Google Maps browser API key: config, then saved, then empty. */
  readonly googleKey: string
}

const KEYS = {
  tiles: 'gcs.tiles.provider',
  autoFetchFence: 'gcs.auto.fetchFence',
  autoFetchMission: 'gcs.auto.fetchMission',
  showGPSNumSats: 'gcs.display.showGPSNumSats',
  showGrid: 'gcs.display.showGrid',
  showLocation: 'gcs.display.showLocation'
} as const
const GOOGLE_KEY = 'gcs.gmaps.apikey'

type BooleanSetting = Exclude<keyof typeof KEYS, 'tiles'>

export class AppSettingsStore {
  private state: AppSettings
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly store: KeyValueStore,
    config: SimpleGcsConfig
  ) {
    const bool = (key: string, def: boolean): boolean => {
      const v = store.get(key)
      return v === null ? def : v === '1' || v === 'true'
    }
    this.state = {
      tiles: store.get(KEYS.tiles) ?? 'osm',
      autoFetchFence: bool(KEYS.autoFetchFence, true),
      autoFetchMission: bool(KEYS.autoFetchMission, false),
      showGPSNumSats: bool(KEYS.showGPSNumSats, false),
      showGrid: bool(KEYS.showGrid, false),
      showLocation: bool(KEYS.showLocation, false),
      googleKey: config.googleMapsApiKey || store.get(GOOGLE_KEY) || ''
    }
  }

  get current(): AppSettings {
    return this.state
  }

  /** The tile provider to draw: the stored one if known, else OSM. */
  get tileProvider(): TileProviderId {
    return isTileProvider(this.state.tiles) ? this.state.tiles : 'osm'
  }

  get hasGoogleKey(): boolean {
    return this.state.googleKey.length > 0
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<Omit<AppSettings, 'googleKey'>>): void {
    this.state = { ...this.state, ...patch }
    // Upstream `save()` writes every setting at once.
    this.store.set(KEYS.tiles, this.state.tiles)
    for (const key of ['autoFetchFence', 'autoFetchMission', 'showGPSNumSats', 'showGrid', 'showLocation'] as const) {
      this.store.set(KEYS[key], this.state[key] ? '1' : '0')
    }
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  setTiles(tiles: TileProviderId): void {
    this.update({ tiles })
  }

  setFlag(key: BooleanSetting, value: boolean): void {
    this.update({ [key]: value })
  }

  /** Opening Settings without a Google key moves a Google provider back to OSM. */
  onSettingsOpened(): void {
    if (!this.hasGoogleKey && this.state.tiles.startsWith('google')) this.update({ tiles: 'osm' })
  }

  /** Saves a new key ("Refresh page to apply" for an already loaded Google Maps API). */
  setGoogleKey(raw: string): void {
    const key = raw.trim()
    this.store.set(GOOGLE_KEY, key)
    this.state = { ...this.state, googleKey: key }
    this.notify()
  }
}
