/**
 * Plane attitude input shaping (upstream `KinematicTool/plane/KinematicTool.js`): the pre-4.8
 * proportional controller, the 4.8+ input shaping with `shape_pos_vel_accel`, and the 4.8+ error
 * path with `sqrt_controller`. Everything is in degrees, as in the plane attitude controllers.
 */
import type { ControlLib } from '../wasm/control.js'
import { wrap180 } from './angles.js'
import type { PlaneParams } from './params.js'
import { usesAngle, type Demand, type PlaneAxis, type PlaneMode } from './scenario.js'
import {
  MAX_TIME,
  differentiateAccel,
  initialHistory,
  runUntilSettled,
  toTrajectory,
  type MethodResult,
  type StateHistory,
  type Targets
} from './trajectory.js'

export const PLANE_DT = 1 / 50
const TOLERANCE = 0.1

export interface PlaneSettings {
  vehicle: 'plane'
  axis: PlaneAxis
  mode: PlaneMode
  demand: Demand
  params: PlaneParams
}

export type PlaneMethod = 'pre48' | 'inputShaping' | 'error'

export interface PlaneResult {
  vehicle: 'plane'
  pre48: MethodResult
  inputShaping: MethodResult
  /** The error path only acts on angle demands; `null` in rate mode. */
  error: MethodResult | null
  targets: Targets
}

/** One axis's limits (upstream `update_axis`). Rate limits of zero mean unlimited. */
export interface PlaneAxisModel {
  rateMax: number
  rateMin: number
  accelMax: number
  timeConstant: number
  angleP: number
}

export function planeAxisModel(axis: PlaneAxis, p: PlaneParams): PlaneAxisModel {
  switch (axis) {
    case 'R':
      return {
        rateMax: p.RLL2SRV_RMAX,
        rateMin: p.RLL2SRV_RMAX,
        accelMax: p.RLL2SRV_ACCEL,
        timeConstant: p.RLL2SRV_TCONST,
        angleP: p.RLL_ANGLE_P
      }
    case 'P':
      return {
        rateMax: p.PTCH2SRV_RMAX_UP,
        rateMin: p.PTCH2SRV_RMAX_DN,
        accelMax: p.PTCH2SRV_ACCEL,
        timeConstant: p.PTCH2SRV_TCONST,
        angleP: p.PTCH_ANGLE_P
      }
  }
}

interface DesiredState {
  pos: number
  vel: number
}

function limitRate(model: PlaneAxisModel, rate: number): number {
  let ret = rate
  if (model.rateMax > 0) ret = Math.min(model.rateMax, ret)
  if (model.rateMin > 0) ret = Math.max(-model.rateMin, ret)
  return ret
}

/** Apply a rate demand: integrate to angle and differentiate to acceleration. */
function applyRate(state: StateHistory, i: number, velTarget: number, dt: number) {
  const prevVel = state.vel[i - 1]!
  state.vel[i] = velTarget
  state.pos[i] = wrap180(state.pos[i - 1]! + (prevVel + velTarget) * dt * 0.5)
  state.accel[i] = (velTarget - prevVel) / dt
  // Ignore the acceleration of the first step, it swamps the plot.
  if (i === 1) {
    state.accel[0] = NaN
    state.accel[1] = NaN
  }
}

/** Pre 4.8: error path only, proportional on the time constant, no input shaping. */
function stepPre48(model: PlaneAxisModel, mode: PlaneMode, desired: DesiredState, state: StateHistory, i: number, dt: number) {
  const velTarget = usesAngle(mode)
    ? limitRate(model, wrap180(desired.pos - state.pos[i - 1]!) / model.timeConstant)
    : desired.vel
  applyRate(state, i, velTarget, dt)
}

/** 4.8+: input shaping with `shape_pos_vel_accel`. */
function stepInputShaping(
  control: ControlLib,
  model: PlaneAxisModel,
  mode: PlaneMode,
  desired: DesiredState,
  state: StateHistory,
  i: number,
  dt: number
) {
  const prevPos = state.pos[i - 1]!
  const prevVel = state.vel[i - 1]!
  const accel = control.shapePosVelAccel({
    // Angle mode shapes the shortest-path angle error; rate mode shapes towards the rate alone.
    desired: usesAngle(mode) ? { pos: wrap180(desired.pos - prevPos), vel: 0, accel: 0 } : { pos: 0, vel: desired.vel, accel: 0 },
    current: { pos: 0, vel: prevVel, accel: state.accel[i - 1]! },
    velMin: -model.rateMin,
    velMax: model.rateMax,
    accelMin: -model.accelMax,
    accelMax: model.accelMax,
    jerkMax: model.accelMax / Math.max(model.timeConstant, 0.1),
    dt,
    limitTotal: true
  })
  const deltaPos = prevVel * dt + accel * 0.5 * Math.pow(dt, 2)
  state.pos[i] = wrap180(prevPos + deltaPos)
  state.vel[i] = prevVel + accel * dt
  state.accel[i] = accel
}

/** 4.8+ error path: `sqrt_controller` on the angle error with the angle P gain. */
function stepError(
  control: ControlLib,
  model: PlaneAxisModel,
  mode: PlaneMode,
  desired: DesiredState,
  state: StateHistory,
  i: number,
  dt: number
) {
  let velTarget = desired.vel
  if (usesAngle(mode)) {
    const p = model.angleP > 0 ? model.angleP : 1 / model.timeConstant
    const error = wrap180(desired.pos - state.pos[i - 1]!)
    velTarget = limitRate(model, control.sqrtController({ error, p, secondOrderLimit: model.accelMax * 0.5, dt }))
  }
  applyRate(state, i, velTarget, dt)
}

export function simulatePlane(control: ControlLib, settings: PlaneSettings): PlaneResult {
  const { mode, demand } = settings
  const model = planeAxisModel(settings.axis, settings.params)
  const dt = PLANE_DT
  const desired: DesiredState = { pos: wrap180(demand.desiredAngle), vel: demand.desiredRate }
  const startPos = wrap180(demand.initialAngle)

  const pre48 = initialHistory(startPos, demand.initialRate)
  const shaped = initialHistory(startPos, demand.initialRate)
  const error = initialHistory(startPos, demand.initialRate)
  const angle = usesAngle(mode)
  const posSettled = (s: StateHistory, i: number) => Math.abs(wrap180(desired.pos - s.pos[i]!)) < TOLERANCE
  const velSettled = (s: StateHistory, i: number) => Math.abs(desired.vel - s.vel[i]!) < TOLERANCE

  const time = runUntilSettled({
    dt,
    endTime: demand.endTime,
    maxTime: MAX_TIME,
    step: (i) => {
      stepPre48(model, mode, desired, pre48, i, dt)
      stepInputShaping(control, model, mode, desired, shaped, i, dt)
      stepError(control, model, mode, desired, error, i, dt)
    },
    settled: (i) =>
      angle
        ? posSettled(pre48, i) && posSettled(shaped, i) && posSettled(error, i)
        : velSettled(pre48, i) && velSettled(shaped, i)
  })

  return {
    vehicle: 'plane',
    // The pre-4.8 controller and the error path are not jerk limited; their jerk would swamp the plot.
    pre48: { trajectory: toTrajectory(time, pre48), jerk: null },
    inputShaping: { trajectory: toTrajectory(time, shaped), jerk: differentiateAccel(time, shaped.accel, dt) },
    error: angle ? { trajectory: toTrajectory(time, error), jerk: null } : null,
    targets: { angle: angle ? desired.pos : null, rate: angle ? null : desired.vel }
  }
}
