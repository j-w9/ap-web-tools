import { useRef, useState } from 'react'
import { ControlGroup } from '@apwt/tool-shell'
import type { AppSettings, AppSettingsStore } from '../app-settings.js'
import { availableProviders, isTileProvider } from '../map/tiles.js'

export interface SettingsPanelProps {
  readonly store: AppSettingsStore
  readonly settings: AppSettings
  readonly onParameters: () => void
  readonly toast: (message: string) => void
}

/** Settings (upstream `openSettingsTip`): parameters, map tiles, Google key, display and auto-fetch. */
export function SettingsPanel({ store, settings, onParameters, toast }: SettingsPanelProps) {
  const [key, setKey] = useState(settings.googleKey)
  // Upstream saves on the input's `change` event: on blur or Enter, only when the text differs
  // from what it was at focus (or at the last save).
  const committed = useRef(settings.googleKey)
  const commitKey = (): void => {
    if (key === committed.current) return
    committed.current = key
    store.setGoogleKey(key)
    toast('API key saved. Refresh page to apply.')
  }
  const providers = availableProviders(store.hasGoogleKey)
  const flag = (k: 'showGrid' | 'showLocation' | 'showGPSNumSats' | 'autoFetchFence' | 'autoFetchMission', label: string) => (
    <label className="apwt-chip">
      <input type="checkbox" checked={settings[k]} onChange={(e) => store.setFlag(k, e.target.checked)} />
      {label}
    </label>
  )
  return (
    <>
      <ControlGroup label="Parameters">
        <button type="button" className="apwt-btn apwt-btn--block" onClick={onParameters}>
          Parameters
        </button>
      </ControlGroup>
      <ControlGroup label="Map tiles">
        <select
          className="apwt-input"
          aria-label="Map tiles"
          value={settings.tiles}
          onChange={(e) => {
            if (isTileProvider(e.target.value)) store.setTiles(e.target.value)
          }}
        >
          {providers.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </ControlGroup>
      <ControlGroup label="Google Maps API key">
        <input
          className="apwt-input"
          type="text"
          placeholder="Enter API key (optional)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onFocus={() => (committed.current = key)}
          onBlur={commitKey}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitKey()
          }}
        />
        <p className="gcs-hint">
          Leave empty to use only free tile sources.{' '}
          <a href="https://developers.google.com/maps/documentation/javascript/get-api-key" target="_blank" rel="noreferrer">
            Get a key
          </a>
        </p>
      </ControlGroup>
      <ControlGroup label="Display options">
        <div className="apwt-chips">
          {flag('showGrid', 'Show Grid')}
          {flag('showLocation', 'Show My Location')}
          {flag('showGPSNumSats', 'Show GPS NumSats')}
        </div>
      </ControlGroup>
      <ControlGroup label="Auto-fetch on connect">
        <div className="apwt-chips">
          {flag('autoFetchFence', 'Fetch fence on first heartbeat')}
          {flag('autoFetchMission', 'Fetch mission on first heartbeat')}
        </div>
      </ControlGroup>
    </>
  )
}
