/**
 * Copter attitude input shaping (upstream `KinematicTool/KinematicTool.js`): the pre-4.7 square
 * root controller, the 4.7+ S-curve `attitude_command_model`, and Ruckig's time-optimal
 * trajectory under the same limits. Internally in radians, like ArduPilot; results in degrees.
 */
import type { ControlLib } from '../wasm/control.js'
import type { RuckigLib, RuckigPlanInput } from '../wasm/ruckig-planner.js'
import { constrain, degrees, isPositive, radians, wrapPi } from './angles.js'
import { COPTER_AXIS_PARAMS, type CopterParams } from './params.js'
import { usesAngle, usesRate, type CopterAxis, type CopterMode, type Demand } from './scenario.js'
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

export const COPTER_DT = 1 / 400
const TOLERANCE = radians(0.1)
const TO_DEGREES = 180 / Math.PI

export interface CopterSettings {
  vehicle: 'copter'
  axis: CopterAxis
  mode: CopterMode
  demand: Demand
  params: CopterParams
}

export type CopterMethod = 'sqrt' | 'scurve' | 'minimumTime'

export interface CopterResult {
  vehicle: 'copter'
  sqrt: MethodResult
  scurve: MethodResult
  /** Ruckig's plan, or why it could not plan. */
  minimumTime: { ok: true; result: MethodResult } | { ok: false; message: string }
  targets: Targets
}

/** The shaping model for one axis, in radians. */
interface ShapingConfig {
  mode: CopterMode
  velLimit: number
  accelLimit: number
  inputTc: number
  rateTc: number
}

interface DesiredState {
  pos: number
  vel: number
}

/** `AC_AttitudeControl::input_shaping_ang_vel`: limit the change in rate by the acceleration limit. */
export function inputShapingAngVel(
  control: ControlLib,
  targetAngVel: number,
  desiredAngVel: number,
  accelMax: number,
  dt: number,
  inputTc: number
): number {
  let desired = desiredAngVel
  if (isPositive(inputTc)) {
    // Calculate the acceleration to smoothly achieve rate. Jerk is not limited.
    const errorRate = desired - targetAngVel
    const desiredAngAccel = control.sqrtController({ error: errorRate, p: 1 / Math.max(inputTc, 0.01), secondOrderLimit: 0, dt })
    desired = targetAngVel + desiredAngAccel * dt
  }
  // Acceleration is limited directly to smooth the beginning of the curve.
  if (isPositive(accelMax)) {
    const delta = accelMax * dt
    return constrain(desired, targetAngVel - delta, targetAngVel + delta)
  }
  return desired
}

/** `AC_AttitudeControl::input_shaping_angle` (pre 4.7): rate demand from an angle error. */
export function inputShapingAngle(
  control: ControlLib,
  errorAngle: number,
  inputTc: number,
  accelMax: number,
  targetAngVel: number,
  desiredAngVel: number,
  maxAngVel: number,
  dt: number
): number {
  // Calculate the velocity as error approaches zero with acceleration limited by accel_max
  let desired =
    desiredAngVel + control.sqrtController({ error: errorAngle, p: 1 / Math.max(inputTc, 0.01), secondOrderLimit: accelMax, dt })
  if (isPositive(maxAngVel)) desired = constrain(desired, -maxAngVel, maxAngVel)
  // Acceleration is limited directly to smooth the beginning of the curve.
  return inputShapingAngVel(control, targetAngVel, desired, accelMax, dt, 0)
}

/** `AC_AttitudeControl::attitude_command_model` (4.7+): the S-curve acceleration for this step. */
export function attitudeCommandModel(
  control: ControlLib,
  errorAngle: number,
  desiredAngVel: number,
  targetAngVel: number,
  targetAngAccel: number,
  maxAngVel: number,
  accelMax: number,
  inputTc: number,
  dt: number
): number {
  if (!isPositive(dt)) return 0
  // No acceleration set, so default to 1800 deg/s².
  const accel = isPositive(accelMax) ? accelMax : radians(1800)
  // No time constant set, so default to reaching maximum acceleration in 10 clock cycles.
  const tc = isPositive(inputTc) ? inputTc : dt * 10
  return control.shapeAngleVelAccel({
    desired: { pos: errorAngle, vel: desiredAngVel, accel: 0 },
    current: { pos: 0, vel: targetAngVel, accel: targetAngAccel },
    velMin: -maxAngVel,
    velMax: maxAngVel,
    accelMax: accel,
    jerkMax: accel / tc,
    dt,
    limitTotal: true
  })
}

function stepSqrt(control: ControlLib, config: ShapingConfig, desired: DesiredState, state: StateHistory, i: number, dt: number) {
  const prevPos = state.pos[i - 1]!
  const prevVel = state.vel[i - 1]!
  let velTarget = usesAngle(config.mode)
    ? inputShapingAngle(
        control,
        wrapPi(desired.pos - prevPos),
        config.inputTc,
        config.accelLimit,
        prevVel,
        usesRate(config.mode) ? desired.vel : 0,
        config.velLimit,
        dt
      )
    : inputShapingAngVel(control, prevVel, desired.vel, config.accelLimit, dt, config.rateTc)
  if (isPositive(config.velLimit)) velTarget = constrain(velTarget, -config.velLimit, config.velLimit)

  state.vel[i] = velTarget
  // Integrate to angle, differentiate to acceleration.
  state.pos[i] = wrapPi(prevPos + (prevVel + velTarget) * dt * 0.5)
  state.accel[i] = (velTarget - prevVel) / dt
}

function stepSCurve(
  control: ControlLib,
  config: ShapingConfig,
  desired: DesiredState,
  state: StateHistory,
  i: number,
  dt: number
) {
  const prevPos = state.pos[i - 1]!
  const prevVel = state.vel[i - 1]!
  const prevAccel = state.accel[i - 1]!
  const accel = usesAngle(config.mode)
    ? attitudeCommandModel(
        control,
        wrapPi(desired.pos - prevPos),
        usesRate(config.mode) ? desired.vel : 0,
        prevVel,
        prevAccel,
        config.velLimit,
        config.accelLimit,
        config.inputTc,
        dt
      )
    : attitudeCommandModel(control, 0, desired.vel, prevVel, prevAccel, 0, config.accelLimit, config.rateTc, dt)

  const deltaPos = prevVel * dt + accel * 0.5 * Math.pow(dt, 2)
  state.pos[i] = wrapPi(prevPos + deltaPos)
  state.vel[i] = prevVel + accel * dt
  state.accel[i] = accel
}

/** The Ruckig problem matching upstream `update_ruckig`. */
export function ruckigInput(config: ShapingConfig, desired: DesiredState, start: DesiredState, dt: number): RuckigPlanInput {
  const angle = usesAngle(config.mode)
  const tc = angle ? config.inputTc : config.rateTc
  return {
    interface: angle ? 'position' : 'velocity',
    start: { pos: start.pos, vel: start.vel, accel: 0 },
    target: { pos: desired.pos, vel: usesRate(config.mode) ? desired.vel : 0, accel: 0 },
    maxVel: config.velLimit > 0 ? config.velLimit : Infinity,
    maxAccel: config.accelLimit,
    maxJerk: tc > 0 ? config.accelLimit / tc : Infinity,
    dt
  }
}

export function simulateCopter(libs: { control: ControlLib; ruckig: RuckigLib }, settings: CopterSettings): CopterResult {
  const { control } = libs
  const { mode, demand, params } = settings
  const names = COPTER_AXIS_PARAMS[settings.axis]
  const dt = COPTER_DT
  const config: ShapingConfig = {
    mode,
    velLimit: radians(params[names.rateMax]),
    accelLimit: radians(params[names.accelMax]),
    inputTc: params.ATC_INPUT_TC,
    rateTc: params[names.rateTc]
  }
  const desired: DesiredState = { pos: wrapPi(radians(demand.desiredAngle)), vel: radians(demand.desiredRate) }
  const start: DesiredState = { pos: wrapPi(radians(demand.initialAngle)), vel: radians(demand.initialRate) }

  const sqrt = initialHistory(start.pos, start.vel)
  const scurve = initialHistory(start.pos, start.vel)
  const angle = usesAngle(mode)

  const time = runUntilSettled({
    dt,
    endTime: demand.endTime,
    maxTime: MAX_TIME,
    step: (i) => {
      stepSqrt(control, config, desired, sqrt, i, dt)
      stepSCurve(control, config, desired, scurve, i, dt)
    },
    settled: (i) =>
      angle
        ? Math.abs(wrapPi(desired.pos - sqrt.pos[i]!)) < TOLERANCE && Math.abs(wrapPi(desired.pos - scurve.pos[i]!)) < TOLERANCE
        : Math.abs(desired.vel - sqrt.vel[i]!) < TOLERANCE && Math.abs(desired.vel - scurve.vel[i]!) < TOLERANCE
  })

  const plan = libs.ruckig.plan(ruckigInput(config, desired, start, dt))
  const scale = (values: Float64Array) => values.map((v) => v * TO_DEGREES)

  return {
    vehicle: 'copter',
    // The square root controller is not jerk limited; its jerk would swamp the plot.
    sqrt: { trajectory: toTrajectory(time, sqrt, TO_DEGREES), jerk: null },
    scurve: { trajectory: toTrajectory(time, scurve, TO_DEGREES), jerk: differentiateAccel(time, scurve.accel, dt, TO_DEGREES) },
    minimumTime: plan.ok
      ? {
          ok: true,
          result: {
            trajectory: {
              time: plan.trajectory.time,
              pos: scale(plan.trajectory.pos),
              vel: scale(plan.trajectory.vel),
              accel: scale(plan.trajectory.accel)
            },
            jerk: { time: plan.trajectory.time, jerk: scale(plan.trajectory.jerk) }
          }
        }
      : { ok: false, message: plan.message },
    targets: { angle: angle ? degrees(desired.pos) : null, rate: usesRate(mode) ? degrees(desired.vel) : null }
  }
}
