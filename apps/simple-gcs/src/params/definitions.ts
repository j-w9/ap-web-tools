/**
 * Parameter descriptions from ArduPilot's published JSON (upstream `modules/MAVLink/mavparam.js`,
 * class `MAVParamDefinitions`), generated from the same definitions as MAVProxy's help/editor.
 * Cached per vehicle in Cache Storage, refreshed weekly, and reused offline.
 */
import { validParamName, type ParamVehicle } from './packed.js'

export interface ParamRange {
  readonly low: unknown
  readonly high: unknown
}

/**
 * One parameter's description. Text fields keep the published JSON value (normally a string) so
 * that upstream's truthiness tests (`if (d.label)`, `d.description || …`) and string interpolation
 * give the same result for any JSON; display them with `jsonText`.
 */
export interface ParamDefinition {
  readonly name: string
  readonly label: unknown
  readonly description: unknown
  readonly units: unknown
  /** As published: usually `{low, high}`, displayed as-is otherwise. */
  readonly range: unknown
  readonly increment: unknown
  /** As published: normally `{value: text}`; upstream iterates any value with `Object.entries`. */
  readonly values: unknown
  /** As published: normally `{bit: text}`. */
  readonly bitmask: unknown
  readonly readOnly: boolean
  readonly rebootRequired: boolean
}

export interface DefinitionsResult {
  readonly definitions: Map<string, ParamDefinition>
  readonly cached: boolean
  readonly stale: boolean
}

/** The parts of `CacheStorage` used. */
export interface DefinitionsCache {
  open(name: string): Promise<{
    match(url: string): Promise<Response | undefined>
    put(url: string, response: Response): Promise<void>
  }>
}

export interface DefinitionsOptions {
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  /** Cache Storage; omitted or `undefined` uses `globalThis.caches` (a default parameter upstream), `null` disables it. */
  readonly cache?: DefinitionsCache | null | undefined
  readonly maxAge?: number
  readonly baseUrl?: string
  readonly now?: () => number
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** `a || b || ...` over unknown JSON values, as upstream's `p.DisplayName || p.displayName || ...`. */
function firstTruthy(...values: unknown[]): unknown {
  for (const v of values) if (v) return v
  return values[values.length - 1]
}

/** A JSON value as string interpolation (`${v}`) shows it. */
export function jsonText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((e: unknown) => (e === null || e === undefined ? '' : jsonText(e))).join(',')
  if (typeof v === 'object' && v !== null) return '[object Object]'
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  return v === null ? 'null' : 'undefined'
}

/** `Object.entries(v)` for a JSON value (strings give their characters, numbers and booleans nothing). */
export function jsonEntries(v: unknown): [string, unknown][] {
  if (typeof v === 'string') return Object.entries(v)
  return isRecord(v) ? Object.entries(v) : []
}

/** `Object.hasOwn(v, key)` for a JSON value that upstream guarantees is truthy. */
export function jsonHasOwn(v: unknown, key: string): boolean {
  if (typeof v === 'string') {
    const index = Number(key)
    return key === 'length' || (String(index) === key && Number.isInteger(index) && index >= 0 && index < v.length)
  }
  return isRecord(v) && Object.hasOwn(v, key)
}

/** Directory per vehicle; canonical names avoid legacy redirects without CORS headers. */
const DIRECTORIES: Readonly<Record<ParamVehicle, string>> = {
  Rover: 'APMrover2',
  Plane: 'ArduPlane',
  Copter: 'ArduCopter',
  Sub: 'ArduSub',
  Heli: 'ArduCopter',
  AntennaTracker: 'AntennaTracker',
  Blimp: 'Blimp'
}

const isVehicle = (v: string): v is ParamVehicle => Object.hasOwn(DIRECTORIES, v)

interface CachedDefinitions {
  readonly data: unknown
  readonly time: number
}

export class ParamDefinitions {
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  private readonly cache: DefinitionsCache | null | undefined
  private readonly maxAge: number
  private readonly baseUrl: string
  private readonly now: () => number
  private readonly memory = new Map<string, CachedDefinitions>()

  constructor(options: DefinitionsOptions = {}) {
    this.fetcher = options.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.cache = options.cache === undefined ? globalThis.caches : options.cache
    this.maxAge = options.maxAge ?? 7 * 86400000
    this.baseUrl = options.baseUrl ?? 'https://autotest.ardupilot.org/Parameters'
    this.now = options.now ?? Date.now
  }

  static parse(data: unknown): Map<string, ParamDefinition> {
    const result = new Map<string, ParamDefinition>()
    for (const group of isRecord(data) ? Object.values(data) : []) {
      if (!isRecord(group)) continue
      for (const [key, p] of Object.entries(group)) {
        if (!isRecord(p)) continue
        const name = key.split(':').at(-1) ?? ''
        if (!validParamName(name)) continue
        result.set(name, {
          name,
          label: firstTruthy(p.DisplayName, p.displayName, p.humanName, ''),
          description: firstTruthy(p.Description, p.description, p.documentation, ''),
          units: firstTruthy(p.Units, ''),
          range: p.Range,
          increment: p.Increment,
          values: firstTruthy(p.Values, {}),
          bitmask: firstTruthy(p.Bitmask, {}),
          readOnly: String(p.ReadOnly).toLowerCase() === 'true',
          rebootRequired: String(p.RebootRequired).toLowerCase() === 'true'
        })
      }
    }
    if (!result.size) throw new Error('Empty or invalid parameter definitions')
    return result
  }

  async load(vehicle: string, { refresh = false }: { readonly refresh?: boolean } = {}): Promise<DefinitionsResult> {
    if (!isVehicle(vehicle)) throw new Error('Unknown vehicle definitions')
    const url = `${this.baseUrl}/${DIRECTORIES[vehicle]}/apm.pdef.json`
    let cached = this.memory.get(url)
    let store: Awaited<ReturnType<DefinitionsCache['open']>> | undefined
    try {
      store = await this.cache?.open('mavparam-definitions-v1')
      if (cached === undefined) {
        const response = await store?.match(url)
        if (response !== undefined)
          cached = { data: await response.json(), time: Number(response.headers.get('X-MAVParam-Cached')) }
      }
    } catch {
      /* Private browsing or cache quota: use memory. */
    }
    if (cached !== undefined && !refresh && this.now() - cached.time < this.maxAge) {
      return { definitions: ParamDefinitions.parse(cached.data), cached: true, stale: false }
    }
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data: unknown = await response.json()
      const definitions = ParamDefinitions.parse(data)
      const entry: CachedDefinitions = { data, time: this.now() }
      cached = entry
      this.memory.set(url, entry)
      try {
        await store?.put(
          url,
          new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json', 'X-MAVParam-Cached': String(entry.time) }
          })
        )
      } catch {
        /* Ignore cache write failures. */
      }
      return { definitions, cached: false, stale: false }
    } catch (error) {
      if (cached !== undefined) return { definitions: ParamDefinitions.parse(cached.data), cached: true, stale: true }
      throw error
    }
  }
}
