import { beforeAll, describe, expect, it } from 'vitest'
import { COPTER_DEFAULTS, loadPage, readUpstream, type Page } from './_harness.js'

const ANGLE = { axis: 'R', mode: 'angle' }

describe('Kinematic Tool (copter page)', () => {
  let page: Page
  beforeAll(async () => {
    page = await loadPage('copter')
  })

  it('defaults run without error and redraw all four plots (control)', async () => {
    const run = await page.run(ANGLE, COPTER_DEFAULTS)
    expect(run.error).toBeUndefined()
    expect(run.redrawn).toEqual(['ang_pos', 'ang_vel', 'ang_accel', 'ang_jerk'])
  })

  it('row 8: ATC_ACC_R_MAX = 0 makes update_ruckig dereference an undefined result and throw', async () => {
    const run = await page.run(ANGLE, { ...COPTER_DEFAULTS, ATC_ACC_R_MAX: '0' })
    expect(String(run.error)).toBe("TypeError: Cannot read properties of undefined (reading 'value')")
    // Nothing is redrawn: the throw happens before the first Plotly.redraw.
    expect(run.redrawn).toEqual([])
  })

  it('row 9: ATC_ACC_R_MAX = -100 is reported by Ruckig as invalid input, then array_scale(undefined) throws', async () => {
    const run = await page.run(ANGLE, { ...COPTER_DEFAULTS, ATC_ACC_R_MAX: '-100' })
    expect(run.logs).toEqual(['Invalid input parameters.'])
    expect(String(run.error)).toBe("TypeError: Cannot read properties of undefined (reading 'length')")
    expect(run.redrawn).toEqual(['ang_pos', 'ang_vel', 'ang_accel'])
    // The minimum-time trace is the one initial point.
    expect(run.plots.ang_pos.data[2]?.x).toEqual([0])
  })

  it('row 9: an empty desired angle reaches the same throw', async () => {
    const run = await page.run(ANGLE, { ...COPTER_DEFAULTS, desired_pos: '' })
    expect(run.logs).toEqual(['Invalid input parameters.'])
    expect(String(run.error)).toBe("TypeError: Cannot read properties of undefined (reading 'length')")
    expect(run.redrawn).toEqual(['ang_pos', 'ang_vel', 'ang_accel'])
  })

  it('row 10: an empty end time runs to the 20 s cap', async () => {
    const normal = await page.run(ANGLE, COPTER_DEFAULTS)
    const empty = await page.run(ANGLE, { ...COPTER_DEFAULTS, end_time: '' })
    expect(empty.error).toBeUndefined()
    const last = (r: typeof normal) => r.plots.ang_pos.data[0]?.x?.at(-1)
    expect(last(normal)).toBeLessThan(2)
    expect(last(empty)).toBe(20)
  })

  it('row 10: an empty desired angle never settles: every simulated angle after the start is NaN', async () => {
    const run = await page.run(ANGLE, { ...COPTER_DEFAULTS, desired_pos: '' })
    const sqrt = run.plots.ang_pos.data[0]
    expect(sqrt?.x?.at(-1)).toBe(20)
    expect(sqrt?.y?.slice(1).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('Kinematic Tool help text', () => {
  const copter = readUpstream('KinematicTool/index.html')
  const plane = readUpstream('KinematicTool/plane/index.html')
  const parametersTip =
    "data-tippy-content='The ArduPilot parameters that define the input shaping vehicle model. Note that in some flight modes ATC_SLEW_YAW provides secondary yaw rate limit. Rate time constant also changes for acro mode.'"

  it('row 11: the plane page carries the copter Parameters tooltip, naming ATC_SLEW_YAW', () => {
    expect(plane).toContain(parametersTip)
    expect(copter).toContain(parametersTip)
    // The plane page has no ATC_ input and no yaw axis.
    expect(plane).not.toMatch(/id="ATC_/)
    expect(plane).not.toContain('value="Y"')
  })

  it('new row: the copter page Parameters tooltip names ATC_SLEW_YAW', () => {
    expect(copter).toContain(parametersTip)
    expect(copter).not.toContain('ATC_RATE_WPY_MAX')
  })

  it('row 12: the Mode tooltip is the Axis tooltip, on both pages', () => {
    const tip = "data-tippy-content='Change the parameters used to the selected axis'"
    for (const html of [copter, plane]) {
      expect(html.split(tip)).toHaveLength(3)
      const axis = html.indexOf('<legend>Axis')
      const mode = html.indexOf('<legend>Mode')
      expect(html.indexOf(tip, axis)).toBeLessThan(mode)
      expect(html.indexOf(tip, mode)).toBeGreaterThan(mode)
    }
  })
})
