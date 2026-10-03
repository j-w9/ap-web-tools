/**
 * Optional deployment configuration (upstream `SimpleGCS/config.example.js`, copied to an ignored
 * `config.js` that sets `window.SIMPLEGCS_CONFIG` and `window.GMAPS_API_KEY`). The port reads the
 * same settings from an optional `config.json` next to the page; see `config.example.json`.
 * No endpoint or credential is built in.
 */
export interface SimpleGcsConfig {
  /** Browser tab title; blank keeps "Simple GCS Map". */
  readonly title?: string
  /** Prefills Connect for new browsers; a saved URL takes priority. Does not connect by itself. */
  readonly defaultUrl?: string
  /** GCS system id default; saved settings take priority. */
  readonly defaultSystemId?: number
  /** Preferred per-tab component id; defaults to random 1-255. */
  readonly defaultComponentId?: number
  /** Google Maps browser API key (upstream `window.GMAPS_API_KEY`). Takes priority over a saved key. */
  readonly googleMapsApiKey?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Keeps the fields of `data` that have the expected types; anything else is ignored. */
export function parseConfig(data: unknown): SimpleGcsConfig {
  if (!isRecord(data)) return {}
  const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const fields = {
    title: text(data.title),
    defaultUrl: text(data.defaultUrl),
    defaultSystemId: num(data.defaultSystemId),
    defaultComponentId: num(data.defaultComponentId),
    googleMapsApiKey: text(data.googleMapsApiKey)
  }
  const config: { -readonly [K in keyof SimpleGcsConfig]: SimpleGcsConfig[K] } = {}
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) Reflect.set(config, key, value)
  return config
}

/** Fetches `config.json` beside the page; a missing or invalid file means no configuration. */
export async function loadConfig(url: URL): Promise<SimpleGcsConfig> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return {}
    return parseConfig(await response.json())
  } catch {
    return {}
  }
}

/** The page title for a configuration (upstream inline script in `index.html`). */
export function configuredTitle(config: SimpleGcsConfig): string | null {
  const title = config.title
  return typeof title === 'string' && title.trim() ? title.trim() : null
}
