// Compares the port's inputs with upstream's: field defaults from index.html, parameter metadata
// from params.json, how a field's text is parsed, and which colour options the checkboxes allow.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseNumberInput } from './input.js'
import { COLOUR_BY_OPTIONS, type ColourBy } from './path3d.js'
import { DEFAULT_PARAMS, PARAMS, type ParamSpec } from './params.js'
import { clickUpstreamColour } from './test-utils/upstream.js'
import { AXIS_INPUT, DEFAULT_MISSION, WAYPOINT_AXES } from './waypoints.js'

const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream/SCurveTool')
const html = readFileSync(resolve(upstreamDir, 'index.html'), 'utf8')
const metadata: unknown = JSON.parse(readFileSync(resolve(upstreamDir, 'params.json'), 'utf8'))

/** The attributes of upstream's `<input id="…">`. */
function inputAttrs(id: string): Record<string, string> {
  const tag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0]
  if (tag === undefined) throw new Error(`no input ${id}`)
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
}

/** `recursive_search` from upstream `Libraries/ParameterMetadata.js`. */
function find(obj: unknown, name: string): Record<string, unknown> | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined
  for (const [key, value] of Object.entries(obj)) {
    if (!name.startsWith(key)) continue
    if (name === key) return value as Record<string, unknown>
    const found = find(value, name)
    if (found !== undefined) return found
  }
  return undefined
}

describe('upstream inputs', () => {
  it('starts every parameter at its upstream value', () => {
    for (const p of PARAMS) expect(DEFAULT_PARAMS[p.name], p.name).toBe(parseFloat(inputAttrs(p.name).value ?? ''))
  })

  it('starts every waypoint at its upstream value with the same field limits', () => {
    const ids = ['first_wp', 'curr_wp', 'next_wp', 'last_wp']
    const suffix = { north: 'x', east: 'y', up: 'z' } as const
    ids.forEach((id, i) => {
      for (const axis of WAYPOINT_AXES) {
        const attrs = inputAttrs(`${id}_${suffix[axis]}`)
        expect(DEFAULT_MISSION[i as 0 | 1 | 2 | 3][axis]).toBe(parseFloat(attrs.value ?? ''))
        expect([AXIS_INPUT[axis].min, AXIS_INPUT[axis].max, AXIS_INPUT[axis].step]).toEqual([
          parseFloat(attrs.min ?? ''),
          parseFloat(attrs.max ?? ''),
          parseFloat(attrs.step ?? '')
        ])
      }
    })
  })

  it('shows the parameter metadata upstream shows', () => {
    for (const p of PARAMS as readonly ParamSpec[]) {
      const m = find(metadata, p.name)
      expect(m, p.name).toBeDefined()
      expect(p.description, p.name).toBe(m?.Description)
      expect(p.displayName, p.name).toBe(m?.DisplayName)
      // Units are shown unless the field became a value picker.
      const picker = 'Values' in (m ?? {}) && inputAttrs(p.name)['data-paramValues'] !== 'false'
      expect(p.kind, p.name).toBe(picker ? 'enum' : 'number')
      if (p.kind === 'number') expect(p.units, p.name).toBe(m?.Units)
      else expect(p.values.map((v) => [String(v.value), v.label])).toEqual(Object.entries(m?.Values ?? {}))
    }
  })

  it('parses field text like upstream parseFloat(input.value)', () => {
    // A number input reports an empty or invalid entry as '', which upstream passes on as NaN.
    for (const text of ['', '12', '-0', '0.15', '1e3', '1e400', '-1e400']) {
      expect(Object.is(parseNumberInput(text), parseFloat(text)), text).toBe(true)
    }
    expect(parseNumberInput('')).toBeNaN()
  })

  it('offers exactly the colour states upstream checkboxes can reach', () => {
    type State = ReturnType<typeof clickUpstreamColour>
    const ids = ['display_wp_vel', 'display_wp_accel', 'display_wp_jerk'] as const
    const key = (s: State) => ids.map((id) => (s[id] ? 1 : 0)).join('')
    // Explore from upstream's initial state (velocity ticked) by clicking any checkbox.
    const start: State = { display_wp_vel: true, display_wp_accel: false, display_wp_jerk: false }
    const seen = new Map<string, State>([[key(start), start]])
    const queue = [start]
    for (let s = queue.shift(); s; s = queue.shift()) {
      for (const id of ids) {
        const next = clickUpstreamColour(s, id)
        if (!seen.has(key(next))) {
          seen.set(key(next), next)
          queue.push(next)
        }
      }
    }
    // Upstream's replot picks jerk, then accel, then vel, else a plain line.
    const colourOf = (s: State): ColourBy =>
      s.display_wp_jerk ? 'jerk' : s.display_wp_accel ? 'acceleration' : s.display_wp_vel ? 'velocity' : 'none'
    expect([...seen.keys()].sort()).toEqual(['000', '001', '010', '100'])
    expect(new Set([...seen.values()].map(colourOf))).toEqual(new Set(COLOUR_BY_OPTIONS))
  })
})
