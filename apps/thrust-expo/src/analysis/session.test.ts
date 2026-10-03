import { describe, expect, it } from 'vitest'
import {
  FIELD_NAMES,
  commitInput,
  createSession,
  loadExample,
  loadParamFile,
  numberInputText,
  paramFileText,
  refit,
  reset,
  setRows,
  typeSpinMin,
  type FieldName,
  type ThrustExpoSession
} from './session.js'
import { EXAMPLE_SAMPLES, rowsFromSamples, type TableRow } from './thrust-table.js'
import { loadUpstreamPage, type UpstreamPage } from './test-support/upstream.js'

/** One user action, applied to both the port and the upstream page. */
type Step =
  | { readonly commit: FieldName; readonly text: string }
  | { readonly typeSpinMin: string }
  | { readonly paramFile: string }
  | { readonly rows: readonly TableRow[] }
  | 'example'
  | 'reset'
  | 'refit'

function applyPort(s: ThrustExpoSession, step: Step): ThrustExpoSession {
  if (step === 'example') return loadExample(s)
  if (step === 'reset') return reset(s)
  if (step === 'refit') return refit(s)
  if ('commit' in step) return commitInput(s, step.commit, step.text)
  if ('typeSpinMin' in step) return typeSpinMin(s, step.typeSpinMin)
  if ('paramFile' in step) return loadParamFile(s, step.paramFile)
  return setRows(s, step.rows)
}

function applyUpstream(page: UpstreamPage, step: Step): void {
  if (step === 'example') return page.api.loadExample()
  if (step === 'reset') return page.api.reset()
  if (step === 'refit') return page.api.updatePlotData()
  if ('commit' in step) {
    const input = page.input(step.commit)
    input.value = step.text
    return input.dispatchEvent(new Event('change'))
  }
  if ('typeSpinMin' in step) {
    const input = page.input('MOT_SPIN_MIN')
    input.value = step.typeSpinMin
    return input.dispatchEvent(new Event('input'))
  }
  if ('paramFile' in step) return page.api.loadParamFile({ files: [{ text: step.paramFile }] })
  // Upstream replots (debounced) on Tabulator's dataChanged.
  page.setRows(step.rows.map((r) => ({ ...r })))
  page.api.updatePlotData()
}

/**
 * Upstream's `linear_interp` leaves a hole (undefined) where it cannot interpolate (a NaN range);
 * the shared port fills NaN. Both are gaps in the plot and NaN in every later calculation.
 */
function holesAsNaN(values: ArrayLike<number | undefined>): number[] {
  return Array.from(values, (v) => v ?? Number.NaN)
}

async function expectSameState(s: ThrustExpoSession, page: UpstreamPage, label: string): Promise<void> {
  const up = page.api
  for (const name of FIELD_NAMES) {
    expect(s.display[name], `${label}: ${name} text`).toBe(page.input(name).value)
    expect(s.params[name], `${label}: ${name} value`).toEqual(up.params[name]!.value)
  }
  expect(s.hoverSave, `${label}: hover save`).toBe(up.params.MOT_THST_HOVER!.save)

  const expo = up.thrustExpoPlot.data
  const err = up.thrustErrorPlot
  const pwm = up.thrustPwmPlot
  if (s.plot.kind === 'empty') {
    expect(expo, label).toEqual([])
    expect(err.data, label).toEqual([])
    expect(pwm.data, label).toEqual([])
  } else {
    const { lin, hover, rows, spin } = s.plot
    expect(Array.from(lin.uncorrectedThrust), label).toEqual(holesAsNaN(expo[0]!.y))
    expect(Array.from(lin.result.correctedThrust), label).toEqual(holesAsNaN(expo[1]!.y))
    expect(hover === null ? undefined : [hover.throttlePct, hover.requiredThrust], label).toEqual(
      expo[2] && [expo[2].x[0], expo[2].y[0]]
    )
    expect(Array.from(lin.result.gradient), label).toEqual(holesAsNaN(err.data[0]!.y))
    expect('Linearized Thrust<br>Std dev: ' + lin.result.stdDeviation.toFixed(3)).toBe(err.data[0]!.name)
    expect(lin.result.mean, label).toBe(err.layout.shapes![0]!.y0)
    expect(
      rows.map((r) => r.pwm),
      label
    ).toEqual(Array.from(pwm.data[0]!.x))
    expect(
      [spin.spinArm, spin.spinMin, spin.spinMax].map((x) => spin.pwmMin + x * (spin.pwmMax - spin.pwmMin)),
      label
    ).toEqual(pwm.layout.shapes!.map((sh) => sh.x0))
  }

  let expected: string | Error
  try {
    up.saveParamFile()
    expected = await page.savedText()
  } catch (e) {
    // The page runs in another realm, so its errors are not `instanceof Error` here.
    expected = new Error(typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e))
  }
  if (typeof expected === 'string') expect(paramFileText(s), `${label}: saved file`).toBe(expected)
  else expect(() => paramFileText(s), `${label}: save fails`).toThrow(expected.message)
}

async function run(steps: readonly Step[]): Promise<ThrustExpoSession> {
  const page = loadUpstreamPage()
  let s = createSession()
  await expectSameState(s, page, 'initial')
  for (const [i, step] of steps.entries()) {
    applyUpstream(page, step)
    s = applyPort(s, step)
    await expectSameState(s, page, `step ${i} ${JSON.stringify(step)}`)
  }
  return s
}

const MIXED_ROWS: TableRow[] = [
  ...rowsFromSamples(EXAMPLE_SAMPLES.slice(0, 40)),
  { pwm: 0, thrust: 0.5, voltage: '', current: '' },
  { pwm: '1600', thrust: '1.2', voltage: '', current: '' },
  { pwm: Number.NaN, thrust: 1.3, voltage: '', current: '' },
  { pwm: undefined, thrust: undefined, voltage: '', current: '' },
  { pwm: '1800', thrust: '1.7', voltage: '', current: '' }
]

describe('the page matches upstream event by event', () => {
  it('starts at the upstream defaults', async () => {
    const s = await run([])
    expect(s.display.MOT_SPIN_ARM).toBe('0.1')
    expect(paramFileText(s)).toBe(
      'MOT_SPIN_ARM,0.1\nMOT_SPIN_MIN,0.15\nMOT_SPIN_MAX,0.95\nMOT_PWM_MIN,1000\nMOT_PWM_MAX,2000\nMOT_THST_EXPO,0.65'
    )
  })

  it('fits the example, estimates hover and saves it', async () => {
    const s = await run(['example'])
    expect(s.hoverSave).toBe(true)
    expect(paramFileText(s)).toContain('MOT_THST_HOVER,')
  })

  it('keeps a manual expo, but refits for 0 or an empty input (upstream bug)', async () => {
    await run([
      'example',
      { commit: 'MOT_THST_EXPO', text: '0.5' },
      { commit: 'MOT_THST_EXPO', text: '0.12345' },
      { commit: 'MOT_THST_EXPO', text: '0' },
      { commit: 'MOT_THST_EXPO', text: '' },
      { commit: 'MOT_THST_EXPO', text: '-0.3' },
      { commit: 'MOTOR_COUNT', text: '6' },
      'refit'
    ])
  })

  it('keeps saving a stale hover estimate once made, until Reset (upstream bug)', async () => {
    const s = await run(['example', { commit: 'COPTER_AUW', text: '100' }, { commit: 'COPTER_AUW', text: '' }])
    expect(s.display.MOT_THST_HOVER).toBe('')
    expect(paramFileText(s)).toContain('MOT_THST_HOVER,')
    const after = await run(['example', { commit: 'COPTER_AUW', text: '100' }, 'reset'])
    expect(after.hoverSave).toBe(false)
  })

  it('applies the MOT_SPIN_MIN rule per keystroke, comparing text (upstream bug)', async () => {
    await run([
      { typeSpinMin: '0' },
      { typeSpinMin: '0.1' },
      { typeSpinMin: '0.12' },
      { commit: 'MOT_SPIN_MIN', text: '0.12' },
      { commit: 'MOT_SPIN_ARM', text: '0.2' },
      'example',
      { commit: 'MOT_SPIN_ARM', text: '10' },
      { typeSpinMin: '2' },
      { commit: 'MOT_SPIN_MIN', text: '2' },
      { commit: 'MOT_SPIN_ARM', text: '0.05' },
      { typeSpinMin: '' },
      { commit: 'MOT_SPIN_MIN', text: '' }
    ])
  })

  it('reads parameter files as upstream: commas only, untrimmed names, MOT_SPIN_MIN shown but not used', async () => {
    const file =
      'MOT_PWM_MAX,1950\nMOT_PWM_MIN,1050\nMOT_SPIN_ARM,0.08\nMOT_SPIN_MAX,0.92\nMOT_SPIN_MIN,0.13\n' +
      'MOT_THST_EXPO,0.58\nMOT_THST_HOVER,0.3\nATC_RAT_RLL_P,0.1\n# comment\nMOTOR_COUNT,6\r\n COPTER_AUW,3\n' +
      'MOT_PWM_MIN\t1200\nCOPTER_AUW=2\nMOT_SPIN_MAX,0.9,extra'
    const first = await run([{ paramFile: file }])
    expect(first.display.MOT_SPIN_MIN).toBe('0.13')
    expect(first.params.MOT_SPIN_MIN).toBe(0.15)
    // Loading again: MOT_SPIN_ARM's line now applies the MOT_SPIN_MIN text the first load left.
    const again = await run([{ paramFile: file }, 'example', { paramFile: file }, { paramFile: 'MOT_THST_EXPO,0.4' }])
    expect(again.params.MOT_SPIN_MIN).toBe(0.13)
  })

  it('handles missing and unreadable values in a parameter file, and fails to save NaN as upstream', async () => {
    const s = await run([
      'example',
      { paramFile: 'MOT_PWM_MAX\nMOT_THST_HOVER,abc\nMOT_PWM_MIN,1e-7' },
      { paramFile: 'MOT_SPIN_ARM,' }
    ])
    expect(() => paramFileText(s)).toThrow('Could not convert NaN to float string')
  })

  it('refits after table changes, with mixed typed, pasted and cleared cells', async () => {
    await run([
      { rows: MIXED_ROWS },
      { commit: 'COPTER_AUW', text: '2' },
      { rows: MIXED_ROWS.slice(40) },
      { rows: [] },
      { commit: 'MOT_PWM_MIN', text: '1100' },
      { rows: MIXED_ROWS }
    ])
  })
})

describe('a parameter file naming the file input', () => {
  it('stops there with the earlier lines applied, as upstream throws', () => {
    const s = loadParamFile(createSession(), 'MOT_PWM_MIN,1100\nparamFile,1\nMOT_PWM_MAX,1900')
    expect(s.params.MOT_PWM_MIN).toBe(1100)
    expect(s.params.MOT_PWM_MAX).toBe(2000)
    expect(s.error).toMatch(/only be programmatically set to the empty string/)
    expect(reset(s).error).toBeNull()
  })
})

describe('numberInputText', () => {
  it('keeps only valid floating-point numbers, as a number input does', () => {
    expect(numberInputText(0.1)).toBe('0.1')
    expect(numberInputText(1e21)).toBe('1e+21')
    expect(numberInputText(Number.NaN)).toBe('')
    expect(numberInputText(Infinity)).toBe('')
    expect(numberInputText(null)).toBe('')
    expect(numberInputText('0.650')).toBe('0.650')
  })
})
