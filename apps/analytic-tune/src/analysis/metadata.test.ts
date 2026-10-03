import { describe, expect, it } from 'vitest'
import { PARAM_METADATA } from './metadata.js'
import { PARAM_NAMES } from './params.js'
import { upstreamParamFile } from './test-utils/upstream.js'

interface UpstreamEntry {
  DisplayName: string
  Description: string
  User: string
  Units?: string
  Range?: { low: string; high: string }
  Increment?: string
  RebootRequired?: string
  Values?: Record<string, string>
  Bitmask?: Record<string, string>
}

/** Upstream `ParameterMetadata.js` lookup: descend through prefix groups to the exact name. */
function find(tree: Record<string, unknown>, name: string): UpstreamEntry | undefined {
  for (const [key, value] of Object.entries(tree)) {
    if (!name.startsWith(key)) continue
    if (key === name) return value as UpstreamEntry
    const found = find(value as Record<string, unknown>, name)
    if (found) return found
  }
  return undefined
}

describe('PARAM_METADATA', () => {
  const tree = JSON.parse(upstreamParamFile()) as Record<string, unknown>

  it('has an entry for every parameter and nothing else', () => {
    expect(Object.keys(PARAM_METADATA).sort()).toEqual([...PARAM_NAMES].sort())
  })

  it.each(PARAM_NAMES)('%s matches upstream params.json', (name) => {
    const up = find(tree, name)!
    const m = PARAM_METADATA[name]
    expect(m.displayName).toBe(up.DisplayName)
    expect(m.description).toBe(up.Description.trim())
    expect(m.user).toBe(up.User)
    expect(m.units).toBe(up.Units)
    expect(m.range).toEqual(up.Range && { low: Number(up.Range.low), high: Number(up.Range.high) })
    expect(m.increment).toBe(up.Increment === undefined ? undefined : Number(up.Increment))
    expect(m.rebootRequired).toBe(up.RebootRequired === 'True' ? true : undefined)
    switch (m.kind) {
      case 'bitmask':
        expect(Object.fromEntries(m.bits.map((b) => [String(b.bit), b.label]))).toEqual(up.Bitmask)
        break
      case 'values':
        expect(Object.fromEntries(m.values.map((v) => [String(v.value), v.label]))).toEqual(up.Values)
        break
      case 'number':
        expect(up.Bitmask ?? up.Values).toBeUndefined()
    }
  })
})
