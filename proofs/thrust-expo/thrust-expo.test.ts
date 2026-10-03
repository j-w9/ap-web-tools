// Reproductions of the Thrust Expo rows of docs/upstream-bugs.md against the original page logic.
// Verdicts and evidence: docs/bug-proofs/thrust-expo.md.
import { describe, expect, it } from 'vitest'
import { loadUpstreamPage, type UpstreamPage } from './_harness.js'

function type(page: UpstreamPage, id: string, value: string, events: string[] = ['change']): void {
  const el = page.input(id)
  el.value = value
  for (const e of events) el.dispatchEvent(new Event(e))
}

function param(page: UpstreamPage, name: string): number | null {
  const p = page.api.params[name]
  if (p === undefined) throw new Error(`no param ${name}`)
  return p.value
}

describe('Thrust Expo: manual expo of 0 is refitted', () => {
  it('entering 0 runs the fit and overwrites the box; 0.5 is kept', () => {
    const page = loadUpstreamPage()
    page.api.loadExample()
    const fitted = param(page, 'MOT_THST_EXPO')
    expect(fitted).toBe(0.38500000000000106)

    type(page, 'MOT_THST_EXPO', '0.5')
    expect(param(page, 'MOT_THST_EXPO')).toBe(0.5)
    expect(page.input('MOT_THST_EXPO').value).toBe('0.500')

    type(page, 'MOT_THST_EXPO', '0')
    expect(param(page, 'MOT_THST_EXPO')).toBe(fitted)
    expect(page.input('MOT_THST_EXPO').value).toBe('0.385')
  })

  it('an emptied box also refits (NaN is falsy)', () => {
    const page = loadUpstreamPage()
    page.api.loadExample()
    const fitted = param(page, 'MOT_THST_EXPO')
    type(page, 'MOT_THST_EXPO', '')
    expect(param(page, 'MOT_THST_EXPO')).toBe(fitted)
  })
})

describe('Thrust Expo: numeric 0 cell drops the row, typed "0" keeps it', () => {
  it('filters on truthiness and isNaN, then parses with parseFloat', () => {
    const page = loadUpstreamPage()
    page.setRows([
      { pwm: 1000, thrust: 0 },
      { pwm: 1100, thrust: '0' },
      { pwm: '0x10', thrust: 0.5 },
      { pwm: 1500, thrust: 1 },
      { pwm: 2000, thrust: 2 }
    ])
    page.api.updatePlotData()
    const trace = page.api.thrustPwmPlot.data[0]
    expect(trace).toBeDefined()
    // Numeric 0 thrust is dropped, string "0" is kept, "0x10" passes isNaN.
    expect(Array.from(trace?.x ?? [])).toEqual([1100, '0x10', 1500, 2000])
    expect(Array.from(trace?.y ?? [])).toEqual(['0', 0.5, 1, 2])
    // parseFloat('0x10') is 0, Number('0x10') (what isNaN tested) is 16.
    expect(parseFloat('0x10')).toBe(0)
    expect(Number('0x10')).toBe(16)
  })
})

describe('Thrust Expo: MOT_SPIN_MIN from a parameter file shown but not used', () => {
  it('the box shows 0.13, the plots and saved file keep 0.15', async () => {
    const page = loadUpstreamPage()
    page.api.loadExample()
    page.api.loadParamFile({ files: [{ text: 'MOT_SPIN_MIN,0.13\nMOT_PWM_MAX,1900' }] })

    expect(page.input('MOT_SPIN_MIN').value).toBe('0.13')
    expect(param(page, 'MOT_SPIN_MIN')).toBe(0.15)
    // Every other parameter in the same file is applied.
    expect(param(page, 'MOT_PWM_MAX')).toBe(1900)

    const markers = page.api.createSpinMarkers(true)
    expect(markers.annotations.map((a) => [a.text, a.x])).toEqual([
      ['SPIN_ARM', 1090],
      ['SPIN_MIN', 1135],
      ['SPIN_MAX', 1855]
    ])
    page.api.saveParamFile()
    const saved = await page.savedText()
    expect(saved).toContain('MOT_SPIN_MIN,0.15\n')
    expect(saved).toContain('MOT_PWM_MAX,1900\n')
  })
})

describe('Thrust Expo: MOT_SPIN_MIN >= MOT_SPIN_ARM compared as strings, per keystroke', () => {
  it('arm 10 lets min 2 stand ("2" < "10" is false as strings)', () => {
    const page = loadUpstreamPage()
    type(page, 'MOT_SPIN_MIN', '2', ['input', 'change'])
    type(page, 'MOT_SPIN_ARM', '10')
    expect(page.input('MOT_SPIN_MIN').value).toBe('2')
    expect(param(page, 'MOT_SPIN_MIN')).toBe(2)
    expect(param(page, 'MOT_SPIN_ARM')).toBe(10)
  })

  it('within the firmware ranges, min ".2" is lowered to arm 0.1 (".2" < "0.1" as strings)', () => {
    const page = loadUpstreamPage()
    type(page, 'MOT_SPIN_MIN', '.2', ['input'])
    expect(page.input('MOT_SPIN_MIN').value).toBe('0.1')
    expect(param(page, 'MOT_SPIN_MIN')).toBe(0.1)
  })

  it('the rule runs per input event: an intermediate "0" snaps to the arm value', () => {
    const page = loadUpstreamPage()
    type(page, 'MOT_SPIN_MIN', '0', ['input'])
    expect(page.input('MOT_SPIN_MIN').value).toBe('0.1')
  })
})

describe('Thrust Expo: stale MOT_THST_HOVER saved', () => {
  it('after the estimate is gone the file keeps the last one', async () => {
    const page = loadUpstreamPage()
    page.api.loadExample()
    const estimate = param(page, 'MOT_THST_HOVER')
    expect(estimate).not.toBeNull()
    expect(page.input('MOT_THST_HOVER').value).toBe(estimate?.toFixed(3))

    type(page, 'COPTER_AUW', '100')
    expect(page.input('MOT_THST_HOVER').value).toBe('')
    page.api.saveParamFile()
    expect(await page.savedText()).toContain(`MOT_THST_HOVER,${String(estimate)}`)

    // Reset is the only place the flag is cleared.
    page.api.reset()
    page.api.saveParamFile()
    expect(await page.savedText()).not.toContain('MOT_THST_HOVER')
  })
})

describe('Thrust Expo: saving with an empty input throws', () => {
  it('param_to_string(NaN) throws and no file is written', () => {
    const page = loadUpstreamPage()
    type(page, 'MOT_PWM_MAX', '')
    expect(param(page, 'MOT_PWM_MAX')).toBeNaN()
    expect(() => {
      page.api.saveParamFile()
    }).toThrow('Could not convert NaN to float string')
    return expect(page.savedText()).rejects.toThrow('nothing saved')
  })
})
