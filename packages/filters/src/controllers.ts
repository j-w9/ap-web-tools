/** Rate PID, angle P and feedforward controllers (upstream `PID`, `Ang_P`, `feedforward`). */
import { complexArrayOf, complexDiv, complexMul, type ComplexArray } from '@apwt/signal'
import { designFirstOrderLowPass, firstOrderLowPassResponse, type FirstOrderLowPass } from './low-pass.js'
import type { ZGrid } from './z-grid.js'

export interface PidGains {
  readonly kP: number
  readonly kI: number
  readonly kD: number
  /** Error filter cut-off (`_FLTE`, Hz); zero disables it. */
  readonly errorCutoffHz: number
  /** Derivative filter cut-off (`_FLTD`, Hz); zero disables it. */
  readonly derivativeCutoffHz: number
}

/** A rate PID at the main loop rate (upstream `PID`). */
export interface Pid {
  readonly kind: 'pid'
  readonly sampleRate: number
  readonly gains: PidGains
  readonly errorFilter: FirstOrderLowPass
  readonly derivativeFilter: FirstOrderLowPass
}

export function designPid(sampleRate: number, gains: PidGains): Pid {
  return {
    kind: 'pid',
    sampleRate,
    gains,
    errorFilter: designFirstOrderLowPass(sampleRate, gains.errorCutoffHz),
    derivativeFilter: designFirstOrderLowPass(sampleRate, gains.derivativeCutoffHz)
  }
}

/** I term z / (z - 1) (upstream `Z_less_one` construction). */
function integrator(z: ComplexArray): ComplexArray {
  const zLessOne: ComplexArray = { re: z.re.map((v) => v + -1), im: z.im.slice() }
  return complexDiv(z, zLessOne)
}

/** D term 1 - z^-1 (upstream `one_less_Z1` construction). */
function differentiator(z1: ComplexArray): ComplexArray {
  return { re: z1.re.map((v) => v * -1 + 1), im: z1.im.map((v) => v * -1) }
}

/** Response of the PID and of each of its terms; `total` is p + i + d, summed in that order. */
export interface PidResponse {
  readonly total: ComplexArray
  readonly p: ComplexArray
  readonly i: ComplexArray
  readonly d: ComplexArray
}

export function pidResponse(pid: Pid, grid: ZGrid): PidResponse {
  const { z, z1 } = grid
  const len = z1.re.length
  const eTrans = firstOrderLowPassResponse(pid.errorFilter, grid)
  const dTrans = complexMul(eTrans, firstOrderLowPassResponse(pid.derivativeFilter, grid))

  const iComp = complexMul(integrator(z), eTrans)
  const kI = pid.gains.kI / pid.sampleRate

  const dComp = complexMul(differentiator(z1), dTrans)
  const kD = pid.gains.kD * pid.sampleRate
  const kP = pid.gains.kP

  const total = complexArrayOf(len)
  const p = complexArrayOf(len)
  const i = complexArrayOf(len)
  const d = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    p.re[n] = eTrans.re[n]! * kP
    p.im[n] = eTrans.im[n]! * kP
    i.re[n] = iComp.re[n]! * kI
    i.im[n] = iComp.im[n]! * kI
    d.re[n] = dComp.re[n]! * kD
    d.im[n] = dComp.im[n]! * kD
    total.re[n] = p.re[n]! + i.re[n]! + d.re[n]!
    total.im[n] = p.im[n]! + i.im[n]! + d.im[n]!
  }
  return { total, p, i, d }
}

/** Angle P controller seen from the angle error: kP / sample rate x z / (z - 1) (upstream `Ang_P`). */
export interface AngleP {
  readonly kind: 'angle-p'
  readonly sampleRate: number
  readonly kP: number
}

export const designAngleP = (sampleRate: number, kP: number): AngleP => ({ kind: 'angle-p', sampleRate, kP })

export function anglePResponse(controller: AngleP, grid: ZGrid): ComplexArray {
  const len = grid.z1.re.length
  const iComp = integrator(grid.z)
  const kI = controller.kP / controller.sampleRate
  const out = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    out.re[n] = iComp.re[n]! * kI
    out.im[n] = iComp.im[n]! * kI
  }
  return out
}

/** Feedforward kFF + kFF_D x sample rate x (1 - z^-1) (upstream `feedforward`). */
export interface Feedforward {
  readonly kind: 'feedforward'
  readonly sampleRate: number
  readonly kFF: number
  readonly kFFD: number
}

export const designFeedforward = (sampleRate: number, kFF: number, kFFD: number): Feedforward => ({
  kind: 'feedforward',
  sampleRate,
  kFF,
  kFFD
})

export function feedforwardResponse(ff: Feedforward, grid: ZGrid): ComplexArray {
  const len = grid.z1.re.length
  const oneLessZ1 = differentiator(grid.z1)
  const kFFD = ff.kFFD * ff.sampleRate
  const out = complexArrayOf(len)
  for (let n = 0; n < len; n++) {
    out.re[n] = oneLessZ1.re[n]! * kFFD + ff.kFF
    out.im[n] = oneLessZ1.im[n]! * kFFD
  }
  return out
}
