/**
 * Plot settings and the share link / saved state that carries them with every input.
 *
 * The query string uses upstream's form field names and values (`Scale=Log`, `PhaseScale=wrap`,
 * `filtering=Post`, ...) so links made by either tool open in the other. Upstream lowercases the
 * whole URL before reading it, so reading here is case-insensitive too.
 */
import type { MagnitudeScale, PhaseScale, PidFiltering } from './bode.js'
import { assignFieldValue } from './fields.js'
import { DEFAULT_INPUTS, INPUT_NAMES, PID_AXES, type InputName, type Inputs, type PidAxis } from './params.js'

export type FrequencyAxis = 'log' | 'linear'
export type FrequencyUnit = 'Hz' | 'RPM'

/** Display settings of one Bode plot. */
export interface BodeSettings {
  readonly magnitude: MagnitudeScale
  readonly phase: PhaseScale
  readonly frequencyAxis: FrequencyAxis
  readonly frequencyUnit: FrequencyUnit
  readonly showComponents: boolean
}

export interface PidSettings extends BodeSettings {
  readonly filtering: PidFiltering
  readonly axis: PidAxis
}

/** Everything the page state holds. */
export interface ToolState {
  readonly inputs: Inputs
  readonly gyro: BodeSettings
  readonly pid: PidSettings
}

/** Upstream's initial radio and checkbox states. */
export const DEFAULT_BODE_SETTINGS: BodeSettings = {
  magnitude: 'dB',
  phase: 'unwrapped',
  frequencyAxis: 'log',
  frequencyUnit: 'Hz',
  showComponents: false
}

export const DEFAULT_STATE: ToolState = {
  inputs: DEFAULT_INPUTS,
  gyro: DEFAULT_BODE_SETTINGS,
  pid: { ...DEFAULT_BODE_SETTINGS, filtering: 'pre', axis: 'RLL' }
}

/** A setting serialised as one of a closed set of query values. */
interface Choice<T> {
  readonly encode: (value: T) => string
  readonly decode: (text: string) => T | undefined
}

function choice<T extends string | boolean>(pairs: readonly (readonly [T, string])[]): Choice<T> {
  return {
    encode: (value) => pairs.find(([v]) => v === value)?.[1] ?? '',
    decode: (text) => pairs.find(([, t]) => t.toLowerCase() === text.toLowerCase())?.[0]
  }
}

const MAGNITUDE = choice<MagnitudeScale>([
  ['dB', 'Log'],
  ['linear', 'Linear']
])
const PHASE = choice<PhaseScale>([
  ['unwrapped', 'unwrap'],
  ['wrapped', 'wrap']
])
const FREQ_AXIS = choice<FrequencyAxis>([
  ['log', 'Log'],
  ['linear', 'Linear']
])
const FREQ_UNIT = choice<FrequencyUnit>([
  ['Hz', 'Hz'],
  ['RPM', 'RPM']
])
const BOOL = choice<boolean>([
  [true, 'true'],
  [false, 'false']
])
const FILTERING = choice<PidFiltering>([
  ['pre', 'Pre'],
  ['post', 'Post']
])
// Not in upstream's links, which always open on roll.
const AXIS = choice<PidAxis>(PID_AXES.map((a) => [a, a]))

/** Query keys for each Bode setting; the PID plot's carry upstream's `PID_` prefix. */
const bodeKeys = (prefix: '' | 'PID_') =>
  ({
    magnitude: `${prefix}Scale`,
    phase: `${prefix}PhaseScale`,
    frequencyAxis: `${prefix}feq_scale`,
    frequencyUnit: `${prefix}feq_unit`,
    showComponents: `${prefix}ShowComponents`
  }) as const satisfies Record<keyof BodeSettings, string>

function writeBode(query: URLSearchParams, prefix: '' | 'PID_', s: BodeSettings): void {
  const keys = bodeKeys(prefix)
  query.append(keys.magnitude, MAGNITUDE.encode(s.magnitude))
  query.append(keys.phase, PHASE.encode(s.phase))
  query.append(keys.frequencyAxis, FREQ_AXIS.encode(s.frequencyAxis))
  query.append(keys.frequencyUnit, FREQ_UNIT.encode(s.frequencyUnit))
  query.append(keys.showComponents, BOOL.encode(s.showComponents))
}

/** Query string holding the whole state (upstream `get_link`). */
export function stateToQuery(state: ToolState): string {
  const query = new URLSearchParams()
  for (const name of INPUT_NAMES) query.append(name, String(state.inputs[name]))
  writeBode(query, '', state.gyro)
  writeBode(query, 'PID_', state.pid)
  query.append('filtering', FILTERING.encode(state.pid.filtering))
  query.append('PID_axis', AXIS.encode(state.pid.axis))
  return query.toString()
}

/**
 * Case-insensitive lookup into a query string; the first of repeated keys wins, as
 * `searchParams.get`. Upstream lowercases the whole link, values included, so `lowerValues`
 * makes e.g. `Infinity` read as `infinity`, which is not a number.
 */
function lowerCaseQuery(search: string, lowerValues: boolean): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  for (const [key, value] of new URLSearchParams(search)) {
    const k = key.toLowerCase()
    if (!map.has(k)) map.set(k, lowerValues ? value.toLowerCase() : value)
  }
  return map
}

function readBode(query: ReadonlyMap<string, string>, prefix: '' | 'PID_', base: BodeSettings): BodeSettings {
  const keys = bodeKeys(prefix)
  const read = <T>(key: string, c: Choice<T>, fallback: T): T => {
    const text = query.get(key.toLowerCase())
    return (text === undefined ? undefined : c.decode(text)) ?? fallback
  }
  return {
    magnitude: read(keys.magnitude, MAGNITUDE, base.magnitude),
    phase: read(keys.phase, PHASE, base.phase),
    frequencyAxis: read(keys.frequencyAxis, FREQ_AXIS, base.frequencyAxis),
    frequencyUnit: read(keys.frequencyUnit, FREQ_UNIT, base.frequencyUnit),
    // Upstream: `checked = value === 'true'`, so any other value unchecks.
    showComponents: (() => {
      const text = query.get(keys.showComponents.toLowerCase())
      return text === undefined ? base.showComponents : text.toLowerCase() === 'true'
    })()
  }
}

/**
 * Where a query string comes from. A share `link` is read as upstream `load()` reads its URL:
 * values that `parseFloat` to `NaN` are skipped. `stored` state stands in for upstream's cookies,
 * which `load_cookies` applies even when they hold `NaN` (an input left empty stays empty).
 */
export type QuerySource = 'link' | 'stored'

/**
 * Query key Filter Review's "Open in Filter Tool" link uses for the gyro sample rate (upstream
 * `open_in_filter_tool` appends `GYRO_SAMPLE_RATE`, lowercased by `load()`).
 */
const REVIEW_GYRO_RATE_KEY = 'gyro_sample_rate'

/**
 * State from a query string, starting from `base`. Unknown keys are ignored, so partial or
 * upstream links work. Each number is assigned to its form control as upstream does
 * ({@link assignFieldValue}), so e.g. `INS_HNTCH_MODE=1.5` or `Throttle=Infinity` reads as `NaN`.
 *
 * Proven upstream bug fixed (docs/bug-proofs/filter-review.md, row 14): Filter Review sends the
 * gyro rate as `GYRO_SAMPLE_RATE`, which upstream's `load()` never reads (its input is named
 * `GyroSampleRate`), so the tool stayed at 2000 Hz. A link's `GYRO_SAMPLE_RATE` sets the gyro
 * sample rate when the link has no `GyroSampleRate`.
 */
export function stateFromQuery(search: string, base: ToolState = DEFAULT_STATE, source: QuerySource = 'link'): ToolState {
  const query = lowerCaseQuery(search, source === 'link')
  const inputs: Record<InputName, number> = { ...base.inputs }
  for (const name of INPUT_NAMES) {
    let text = query.get(name.toLowerCase())
    if (text === undefined && name === 'GyroSampleRate' && source === 'link') text = query.get(REVIEW_GYRO_RATE_KEY)
    if (text === undefined) continue
    const value = parseFloat(text)
    if (source === 'link' && Number.isNaN(value)) continue
    inputs[name] = assignFieldValue(name, value)
  }
  const filteringText = query.get('filtering')
  const axisText = query.get('pid_axis')
  return {
    inputs,
    gyro: readBode(query, '', base.gyro),
    pid: {
      ...readBode(query, 'PID_', base.pid),
      filtering: (filteringText === undefined ? undefined : FILTERING.decode(filteringText)) ?? base.pid.filtering,
      axis: (axisText === undefined ? undefined : AXIS.decode(axisText)) ?? base.pid.axis
    }
  }
}
