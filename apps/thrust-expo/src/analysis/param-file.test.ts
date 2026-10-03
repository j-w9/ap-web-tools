import { describe, expect, it } from 'vitest'
import { buildParamFile, invalidSavedParams, paramToString, parseParamFile } from './param-file.js'
import { loadUpstreamPage } from './test-support/upstream.js'

describe('parseParamFile', () => {
  it('reads known inputs and ignores everything else', () => {
    const r = parseParamFile('MOT_PWM_MIN,1100\r\nMOT_SPIN_MAX,0.9\nATC_RAT_RLL_P,0.1\n# comment\nCOPTER_AUW,3.2\n\n')
    expect(r.values).toEqual({ MOT_PWM_MIN: 1100, MOT_SPIN_MAX: 0.9, COPTER_AUW: 3.2 })
    expect(r.count).toBe(3)
    expect(r.expoFixed).toBe(false)
  })

  it('keeps the expo fixed only when it is the last recognised line, as upstream change events do', () => {
    expect(parseParamFile('MOT_SPIN_MIN,0.12\nMOT_THST_EXPO,0.55\nZZZ,1').expoFixed).toBe(true)
    const full = parseParamFile('MOT_THST_EXPO,0.55\nMOT_THST_HOVER,0.3')
    expect(full.expoFixed).toBe(false)
    expect(full.values).toEqual({ MOT_THST_EXPO: 0.55 })
  })

  it('applies the same values as the upstream page', () => {
    const text = 'MOT_PWM_MAX,1950\nMOT_PWM_MIN,1050\nMOT_SPIN_ARM,0.08\nMOT_SPIN_MAX,0.92\nMOT_SPIN_MIN,0.13\nMOT_THST_EXPO,0.58'
    const page = loadUpstreamPage()
    page.api.loadParamFile({ files: [{ text }] })
    const ours = parseParamFile(text)
    // Every value reaches the page's inputs.
    for (const [name, value] of Object.entries(ours.values)) expect(Number(page.input(name).value)).toBe(value)
    // Upstream bug: MOT_SPIN_MIN only updates its parameter on an "input" event, so a loaded value is shown
    // but not used. The port uses it (deliberate deviation); every other value matches the page's parameters.
    expect(page.api.params.MOT_SPIN_MIN!.value).toBe(0.15)
    for (const [name, value] of Object.entries(ours.values)) {
      if (name !== 'MOT_SPIN_MIN') expect(page.api.params[name]!.value).toBe(value)
    }
    // Upstream saw MOT_THST_EXPO last, so its value survives (no data, so no refit happened either way).
    expect(page.api.params.MOT_THST_EXPO!.value).toBe(0.58)
  })

  it('marks a non-numeric value as NaN', () => {
    expect(parseParamFile('MOT_PWM_MIN,abc').values.MOT_PWM_MIN).toBeNaN()
  })
})

describe('paramToString', () => {
  it('gives the shortest float32 round-trip string', () => {
    expect(paramToString(0.65)).toBe('0.65')
    expect(paramToString(1000)).toBe('1000')
    expect(paramToString(-0.30000000000000027)).toBe('-0.3')
    expect(() => paramToString(Number.NaN)).toThrow()
  })
})

describe('buildParamFile', () => {
  const values = {
    MOT_SPIN_ARM: 0.1,
    MOT_SPIN_MIN: 0.15,
    MOT_SPIN_MAX: 0.95,
    MOT_PWM_MIN: 1000,
    MOT_PWM_MAX: 2000,
    MOT_THST_EXPO: 0.62
  }

  it('matches the upstream saved file', async () => {
    const page = loadUpstreamPage()
    for (const [name, value] of Object.entries(values)) page.api.params[name]!.value = value
    page.api.saveParamFile()
    expect(buildParamFile({ values, motThstHover: null })).toBe(await page.savedText())

    page.api.params.MOT_THST_HOVER!.value = 0.3125
    page.api.params.MOT_THST_HOVER!.save = true
    page.api.saveParamFile()
    expect(buildParamFile({ values, motThstHover: 0.3125 })).toBe(await page.savedText())
  })

  it('reports values that cannot be written', () => {
    expect(invalidSavedParams({ values: { ...values, MOT_PWM_MAX: Number.NaN }, motThstHover: null })).toEqual(['MOT_PWM_MAX'])
  })
})
