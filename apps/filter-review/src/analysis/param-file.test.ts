import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultFilterParams, type FilterParams } from './filter-params.js'
import { filterToolUrl } from './filter-tool-link.js'
import { applyParamFile, filterParamFileText, pageParams, paramToString, signedBitmask } from './param-file.js'
import { rng } from './test-utils/rng.js'
import { loadFilterReviewUpstream } from './test-utils/upstream.js'

const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream')

/** INS_* parameter ids in the order upstream's save finds them: number inputs, then drop-downs. */
function upstreamPageOrder(): string[] {
  const html = readFileSync(resolve(upstreamDir, 'FilterReview/index.html'), 'utf8')
  const ids = [...html.matchAll(/<input id="(INS_[A-Z0-9_]+)"/g)].map((m) => m[1] ?? '')
  const metadata = JSON.parse(readFileSync(resolve(upstreamDir, 'FilterReview/params.json'), 'utf8')) as unknown
  // Same lookup as upstream load_param_inputs: descend into keys that prefix the name
  const find = (obj: unknown, name: string): Record<string, unknown> | undefined => {
    if (typeof obj !== 'object' || obj === null) return undefined
    for (const [key, value] of Object.entries(obj)) {
      if (!name.startsWith(key)) continue
      if (key === name) return value as Record<string, unknown>
      const found = find(value, name)
      if (found !== undefined) return found
    }
    return undefined
  }
  // Parameters with a Values list are replaced by a <select> (ENABLE and MODE)
  const isSelect = (id: string): boolean => find(metadata, id)?.['Values'] !== undefined
  return [...ids.filter((id) => !isSelect(id)), ...ids.filter(isSelect)]
}

function sampleParams(): FilterParams {
  const p = defaultFilterParams()
  p.gyroFilter = 0.6499999761581421
  p.notches[0] = {
    enable: 1,
    mode: 3,
    freq: 81.5,
    bandwidth: 40.099998474121094,
    attenuation: 40,
    ref: 1,
    minRatio: 0.8,
    harmonics: 0x83,
    options: 18
  }
  p.notches[1].mode = 7
  return p
}

describe('parameter file', () => {
  it('formats values like upstream param_to_string', () => {
    const up = loadFilterReviewUpstream()
    const next = rng(5)
    const values = [
      0,
      1,
      -1,
      0.1,
      20,
      400,
      1e-7,
      123456.789,
      0.6499999761581421,
      ...Array.from({ length: 200 }, () => (next() - 0.5) * 10 ** (8 * next() - 3))
    ]
    for (const v of values) expect(paramToString(v), String(v)).toBe(up.run(`param_to_string(${v})`))
  })

  it('lists parameters in upstream page order', () => {
    expect(pageParams(defaultFilterParams(), true).map((p) => p.name)).toEqual(upstreamPageOrder())
  })

  it('writes the upstream .param text', () => {
    const text = filterParamFileText(sampleParams(), false)
    const lines = text.split('\n')
    expect(lines[0]).toBe('INS_GYRO_FILTER,0.65')
    expect(lines).toContain('INS_HNTCH_HMNCS,-125')
    expect(lines).toContain('INS_HNTCH_BW,40.1')
    // An unknown mode cannot be shown in the drop-down, which then reads as empty
    expect(lines).toContain('INS_HNTC2_MODE,0')
    expect(text.endsWith('INS_HNTC2_MODE,0\n')).toBe(true)
    expect(filterParamFileText(sampleParams(), true).split('\n')).toContain('INS_HNTCH_HMNCS,131')
  })

  it('reads parameter files back', () => {
    const text = 'INS_HNTCH_ENABLE 1\nINS_HNTCH_FREQ=95\nINS_HNTCH_HMNCS,-1\nSCHED_LOOP_RATE\t800\n# comment\nUNKNOWN,4\n'
    const { params, applied } = applyParamFile(text, defaultFilterParams(), false)
    expect(applied).toEqual(['INS_HNTCH_ENABLE', 'INS_HNTCH_FREQ', 'INS_HNTCH_HMNCS', 'SCHED_LOOP_RATE'])
    expect(params.notches[0]).toMatchObject({ enable: 1, freq: 95, harmonics: 255 })
    expect(params.loopRate).toBe(800)
    const roundTrip = applyParamFile(filterParamFileText(sampleParams(), true), defaultFilterParams(), true).params
    expect(roundTrip.notches[0]).toEqual({ ...sampleParams().notches[0], bandwidth: 40.1 })
  })

  it('converts narrow bitmasks to their signed form', () => {
    expect(signedBitmask(255, 8)).toBe(-1)
    expect(signedBitmask(127, 8)).toBe(127)
    expect(signedBitmask(255, 32)).toBe(255)
  })

  it('builds the Filter Tool link', () => {
    const url = filterToolUrl('https://example.org/FilterTool/', defaultFilterParams(), true, {
      gyroSampleRate: 1999.6,
      throttle: 0.3,
      rpm1: undefined,
      escRpm: 6000,
      numMotors: 4,
      rpm2: undefined
    })
    const query = new URL(url).searchParams
    expect(query.get('INS_GYRO_FILTER')).toBe('20')
    expect(query.get('GYRO_SAMPLE_RATE')).toBe('2000')
    expect(query.get('NUM_MOTORS')).toBe('4')
    expect(query.has('RPM1')).toBe(false)
  })
})
