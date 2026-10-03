import { beforeAll, describe, expect, it } from 'vitest'
import { loadTestLibs } from '../test-utils/wasm.js'
import { loadUpstreamPage, type UpstreamPlots, type UpstreamTrace } from '../test-utils/upstream.js'
import type { ControlLib } from '../wasm/control.js'
import type { RuckigLib } from '../wasm/ruckig-planner.js'
import type { CopterSettings } from './copter.js'
import { COPTER_DEFAULTS, PLANE_DEFAULTS, type CopterParams, type PlaneParams } from './params.js'
import type { PlaneSettings } from './plane.js'
import { DEFAULT_DEMAND, type CopterAxis, type CopterMode, type Demand, type PlaneAxis, type PlaneMode } from './scenario.js'
import { simulate } from './simulate.js'
import type { MethodResult } from './trajectory.js'

let libs: { control: ControlLib; ruckig: RuckigLib }
beforeAll(async () => {
  libs = await loadTestLibs()
})

const UPSTREAM_DEMAND_IDS = {
  desired_pos: 'desiredAngle',
  desired_vel: 'desiredRate',
  end_time: 'endTime',
  initial_pos: 'initialAngle',
  initial_vel: 'initialRate'
} as const satisfies Record<string, keyof Demand>

/** Input text as the browser reports it: an empty field for NaN, which `parseFloat` reads back as NaN. */
const inputText = (value: number) => (Number.isNaN(value) ? '' : value)

function upstreamValues(demand: Demand, params: CopterParams | PlaneParams): Record<string, number | string> {
  const values: Record<string, number | string> = {}
  for (const [id, value] of Object.entries(params)) values[id] = inputText(value)
  for (const [id, key] of Object.entries(UPSTREAM_DEMAND_IDS)) values[id] = inputText(demand[key])
  return values
}

const arr = (a: ArrayLike<number> | undefined) => Array.from(a ?? [])

function expectTrace(up: UpstreamTrace, x: ArrayLike<number> | undefined, y: ArrayLike<number> | undefined) {
  expect(arr(x)).toEqual(arr(up.x))
  expect(arr(y)).toEqual(arr(up.y))
}

function expectMethod(up: UpstreamPlots, index: number, method: MethodResult | null, withJerk: boolean) {
  expectTrace(up.ang_pos.data[index]!, method?.trajectory.time, method?.trajectory.pos)
  expectTrace(up.ang_vel.data[index]!, method?.trajectory.time, method?.trajectory.vel)
  expectTrace(up.ang_accel.data[index]!, method?.trajectory.time, method?.trajectory.accel)
  if (withJerk) expectTrace(up.ang_jerk.data[index]!, method?.jerk?.time, method?.jerk?.jerk)
  else expect(method?.jerk ?? null).toBeNull()
}

function expectTargets(up: UpstreamPlots, targets: { angle: number | null; rate: number | null }) {
  const pos = up.ang_pos.layout.shapes![0]!
  const vel = up.ang_vel.layout.shapes![0]!
  expect(pos.visible).toBe(targets.angle !== null)
  expect(vel.visible).toBe(targets.rate !== null)
  if (targets.angle !== null) expect(targets.angle).toBe(pos.y0)
  if (targets.rate !== null) expect(targets.rate).toBe(vel.y0)
}

interface CopterCase {
  axis: CopterAxis
  mode: CopterMode
  demand?: Partial<Demand>
  params?: Partial<CopterParams>
}

const COPTER_CASES: CopterCase[] = [
  { axis: 'R', mode: 'angle' },
  { axis: 'P', mode: 'angle', params: { ATC_RATE_P_MAX: 60 } },
  { axis: 'Y', mode: 'angle', demand: { desiredAngle: 90 } },
  { axis: 'R', mode: 'rate', demand: { desiredRate: 120 } },
  { axis: 'R', mode: 'rate', demand: { desiredRate: -200 }, params: { ACRO_RP_RATE_TC: 0.15 } },
  { axis: 'Y', mode: 'rate', demand: { desiredRate: 60, initialRate: -30 }, params: { PILOT_Y_RATE_TC: 0.2 } },
  { axis: 'R', mode: 'angle+rate', demand: { desiredAngle: 10, desiredRate: 20 } },
  { axis: 'R', mode: 'angle', demand: { desiredAngle: 170, initialAngle: -170, endTime: 2 } },
  { axis: 'P', mode: 'angle', demand: { desiredAngle: -45, initialRate: 50 }, params: { ATC_INPUT_TC: 0, ATC_RATE_P_MAX: 180 } },
  { axis: 'P', mode: 'rate', demand: { desiredRate: 90 }, params: { ATC_RATE_P_MAX: 60, ACRO_RP_RATE_TC: 0.5 } },
  { axis: 'Y', mode: 'angle+rate', demand: { desiredAngle: -60, desiredRate: -10, initialRate: 20 } },
  { axis: 'R', mode: 'angle', demand: { desiredAngle: 400, initialAngle: -300, endTime: 0.1 } },
  { axis: 'R', mode: 'angle', demand: { desiredAngle: 30, endTime: 10 }, params: { ATC_RATE_R_MAX: 20 } },
  // Ruckig failures: a zero acceleration limit is an unregistered result code (upstream throws in
  // update_ruckig); a negative one is "Invalid input parameters." (upstream throws at the jerk plot).
  { axis: 'R', mode: 'angle', params: { ATC_ACC_R_MAX: 0 } },
  { axis: 'R', mode: 'angle', params: { ATC_ACC_R_MAX: -100 } },
  // Empty fields: upstream parses them as NaN and simulates with it.
  { axis: 'R', mode: 'angle', demand: { desiredAngle: NaN } },
  { axis: 'R', mode: 'angle', demand: { initialAngle: NaN } },
  { axis: 'R', mode: 'angle', demand: { initialRate: NaN } },
  { axis: 'R', mode: 'angle', demand: { endTime: NaN } },
  { axis: 'R', mode: 'angle', params: { ATC_INPUT_TC: NaN } },
  { axis: 'R', mode: 'angle', params: { ATC_RATE_R_MAX: NaN } },
  { axis: 'R', mode: 'angle', params: { ATC_ACC_R_MAX: NaN } },
  { axis: 'R', mode: 'rate', demand: { desiredRate: NaN } },
  { axis: 'R', mode: 'rate', demand: { desiredRate: 100 }, params: { ACRO_RP_RATE_TC: NaN } },
  { axis: 'Y', mode: 'angle+rate', demand: { desiredRate: NaN } }
]

describe('copter simulation matches upstream', () => {
  it.each(COPTER_CASES)('$axis $mode $demand $params', async (c) => {
    const demand: Demand = { ...DEFAULT_DEMAND, ...c.demand }
    const params: CopterParams = { ...COPTER_DEFAULTS, ...c.params }
    const settings: CopterSettings = { vehicle: 'copter', axis: c.axis, mode: c.mode, demand, params }
    const result = simulate(libs, settings)
    if (result.vehicle !== 'copter') throw new Error('expected a copter result')

    const page = await loadUpstreamPage('copter')
    const run = await page.run({ axis: c.axis, mode: c.mode }, upstreamValues(demand, params))
    const up = run.plots
    // Upstream throws when Ruckig fails (in update_ruckig, or at the jerk plot after drawing the
    // others); the port reports the failure instead. Every other outcome must be identical.
    expect(result.minimumTime.ok).toBe(run.error === undefined)
    if (run.redrawn.includes('ang_pos')) {
      expectMethod(up, 0, result.sqrt, false)
      expectTrace(up.ang_pos.data[1]!, result.scurve.trajectory.time, result.scurve.trajectory.pos)
      expectTrace(up.ang_vel.data[1]!, result.scurve.trajectory.time, result.scurve.trajectory.vel)
      expectTrace(up.ang_accel.data[1]!, result.scurve.trajectory.time, result.scurve.trajectory.accel)
      // The S-curve jerk is assigned before upstream reaches the failing Ruckig jerk.
      expectTrace(up.ang_jerk.data[1]!, result.scurve.jerk?.time, result.scurve.jerk?.jerk)
      expectTargets(up, result.targets)
    }
    if (result.minimumTime.ok) {
      expect(run.redrawn).toEqual(['ang_pos', 'ang_vel', 'ang_accel', 'ang_jerk'])
      expectMethod(up, 2, result.minimumTime.result, true)
    }
  })

  // Upstream throws on this Ruckig result and stops updating the plots, so there is no oracle.
  it('reports a Ruckig failure but still simulates the ArduPilot shapers', () => {
    const settings: CopterSettings = {
      vehicle: 'copter',
      axis: 'R',
      mode: 'angle',
      demand: DEFAULT_DEMAND,
      params: { ...COPTER_DEFAULTS, ATC_ACC_R_MAX: 0 }
    }
    const result = simulate(libs, settings)
    if (result.vehicle !== 'copter') throw new Error('expected a copter result')
    expect(result.minimumTime.ok).toBe(false)
    // With no acceleration limit the S-curve model falls back to 1800 deg/s².
    const pos = result.scurve.trajectory.pos
    expect(pos[pos.length - 1]).toBeCloseTo(30, 1)
  })

  it('runs at least the end time and settles on the target', () => {
    const settings: CopterSettings = {
      vehicle: 'copter',
      axis: 'R',
      mode: 'angle',
      demand: { ...DEFAULT_DEMAND, endTime: 3 },
      params: COPTER_DEFAULTS
    }
    const result = simulate(libs, settings)
    if (result.vehicle !== 'copter') throw new Error('expected a copter result')
    const { time, pos } = result.scurve.trajectory
    expect(time[time.length - 1]).toBeGreaterThan(3)
    expect(pos[pos.length - 1]).toBeCloseTo(30, 1)
  })
})

interface PlaneCase {
  axis: PlaneAxis
  mode: PlaneMode
  demand?: Partial<Demand>
  params?: Partial<PlaneParams>
}

const PLANE_CASES: PlaneCase[] = [
  { axis: 'R', mode: 'angle' },
  { axis: 'R', mode: 'angle', params: { RLL_ANGLE_P: 5, RLL2SRV_RMAX: 60 } },
  { axis: 'P', mode: 'angle', demand: { desiredAngle: -20 }, params: { PTCH2SRV_RMAX_UP: 30, PTCH2SRV_RMAX_DN: 20 } },
  { axis: 'R', mode: 'rate', demand: { desiredRate: 45 } },
  { axis: 'P', mode: 'rate', demand: { desiredRate: -30, initialRate: 10 }, params: { PTCH2SRV_RMAX_DN: 25 } },
  { axis: 'R', mode: 'angle', demand: { desiredAngle: 175, initialAngle: -175 } },
  { axis: 'P', mode: 'angle', demand: { desiredAngle: 40, initialRate: -20, endTime: 4 }, params: { PTCH_ANGLE_P: 3 } },
  { axis: 'R', mode: 'angle', params: { RLL2SRV_TCONST: 0, RLL2SRV_ACCEL: 0 } },
  { axis: 'R', mode: 'angle', params: { RLL2SRV_RMAX: -30 } },
  // Empty fields: upstream parses them as NaN and simulates with it.
  { axis: 'R', mode: 'angle', demand: { desiredAngle: NaN } },
  { axis: 'R', mode: 'angle', demand: { endTime: NaN } },
  { axis: 'R', mode: 'angle', params: { RLL2SRV_TCONST: NaN } },
  { axis: 'P', mode: 'angle', params: { PTCH2SRV_RMAX_DN: NaN, PTCH_ANGLE_P: NaN } },
  { axis: 'R', mode: 'rate', demand: { desiredRate: NaN, initialRate: NaN } },
  { axis: 'P', mode: 'rate', demand: { desiredRate: 20 }, params: { PTCH2SRV_ACCEL: NaN } }
]

describe('plane simulation matches upstream', () => {
  it.each(PLANE_CASES)('$axis $mode $demand $params', async (c) => {
    const demand: Demand = { ...DEFAULT_DEMAND, ...c.demand }
    const params: PlaneParams = { ...PLANE_DEFAULTS, ...c.params }
    const settings: PlaneSettings = { vehicle: 'plane', axis: c.axis, mode: c.mode, demand, params }
    const result = simulate(libs, settings)
    if (result.vehicle !== 'plane') throw new Error('expected a plane result')

    const run = await (await loadUpstreamPage('plane')).run({ axis: c.axis, mode: c.mode }, upstreamValues(demand, params))
    expect(run.error).toBeUndefined()
    const up = run.plots
    expectMethod(up, 0, result.pre48, false)
    expectMethod(up, 1, result.inputShaping, true)
    // Upstream hides the error path in rate mode; the port does not produce it.
    const upError = up.ang_pos.data[2]!
    expect(upError.visible).toBe(result.error !== null)
    if (result.error) expectMethod(up, 2, result.error, false)
    expectTargets(up, result.targets)
  })
})
