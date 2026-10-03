/**
 * Connection settings and their editor draft (upstream `SimpleGCS/app.js`, `initConnection`:
 * `readConnectionSettings`, `validateConnectionUrl` and the dialog's initial values).
 */
import type { SimpleGcsConfig } from '../config.js'
import type { KeyValueStore } from './storage.js'

/** Settings a connection was submitted with; reconnects reuse them, never an unfinished edit. */
export interface ConnectionSettings {
  readonly url: string
  /** Used exactly as entered, including surrounding spaces. Empty disables signing. */
  readonly passphrase: string
  readonly systemId: number
  readonly componentId: number
  readonly sendHeartbeat: boolean
}

/** The connection editor's fields as typed (the dialog's input values). */
export interface ConnectionDraft {
  readonly url: string
  readonly passphrase: string
  readonly systemId: string
  readonly componentId: string
  readonly sendHeartbeat: boolean
}

/** Storage keys, shared with upstream so saved settings carry over. */
export const STORAGE_KEYS = {
  url: 'gcs.url',
  passphrase: 'gcs.passphrase',
  systemId: 'gcs.systemId',
  /** In session storage: per tab. */
  componentId: 'gcs.componentId'
} as const

export const DEFAULT_URL = 'ws://127.0.0.1:5763'

/** Throws unless `value` is a ws:// or wss:// URL without a fragment. */
export function validateConnectionUrl(value: string): void {
  try {
    const url = new URL(value)
    if ((url.protocol === 'ws:' || url.protocol === 'wss:') && !url.href.includes('#')) return
  } catch {
    /* Reported below. */
  }
  throw new Error('Enter a ws:// or wss:// URL without a fragment (#).')
}

/** Settings from a draft: ids outside 1-255 fall back to 255 and 190. */
export function readConnectionSettings(draft: ConnectionDraft): ConnectionSettings {
  const sid = parseInt(draft.systemId || '255', 10)
  const cid = parseInt(draft.componentId || '190', 10)
  return {
    url: draft.url.trim(),
    passphrase: draft.passphrase,
    systemId: sid >= 1 && sid <= 255 ? sid : 255,
    componentId: cid >= 1 && cid <= 255 ? cid : 190,
    sendHeartbeat: draft.sendHeartbeat
  }
}

export interface DraftSources {
  readonly local: KeyValueStore
  readonly session: KeyValueStore
  readonly config: SimpleGcsConfig
  /** Uniform random uint32, as `crypto.getRandomValues(new Uint32Array(1))[0]`. */
  readonly randomUint32: () => number
}

/** The editor's initial values: saved settings, then deployment defaults, then built-ins. */
export function initialDraft({ local, session, config, randomUint32 }: DraftSources): ConnectionDraft {
  const preferred = Number(session.get(STORAGE_KEYS.componentId) || config.defaultComponentId) || 1 + (randomUint32() % 255)
  const componentId = Number.isInteger(preferred) && preferred >= 1 && preferred <= 255 ? preferred : 190
  return {
    url: local.get(STORAGE_KEYS.url) || config.defaultUrl || DEFAULT_URL,
    passphrase: local.get(STORAGE_KEYS.passphrase) || '',
    systemId: String(local.get(STORAGE_KEYS.systemId) || config.defaultSystemId || 255),
    componentId: String(componentId),
    sendHeartbeat: true
  }
}

/** Saves submitted settings: URL, system id and passphrase per browser, component id per tab. */
export function saveConnectionSettings(settings: ConnectionSettings, local: KeyValueStore, session: KeyValueStore): void {
  local.set(STORAGE_KEYS.url, settings.url)
  local.set(STORAGE_KEYS.systemId, String(settings.systemId))
  session.set(STORAGE_KEYS.componentId, String(settings.componentId))
  if (settings.passphrase.length) local.set(STORAGE_KEYS.passphrase, settings.passphrase)
  else local.remove(STORAGE_KEYS.passphrase)
}
