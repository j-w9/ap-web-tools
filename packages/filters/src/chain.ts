/** Filter chains: any modelled element, evaluated alone or multiplied together (upstream `evaluate_transfer_functions`). */
import { complexMul, type ComplexArray } from '@apwt/signal'
import { anglePResponse, feedforwardResponse, pidResponse, type AngleP, type Feedforward, type Pid } from './controllers.js'
import { harmonicNotchResponse, type HarmonicNotch } from './harmonic-notch.js'
import { biquadLowPassResponse, firstOrderLowPassResponse, type BiquadLowPass, type FirstOrderLowPass } from './low-pass.js'
import { notchResponse, type Notch } from './notch.js'
import { unityResponse, zGrid, type ZGrid } from './z-grid.js'

/** Any modelled element. */
export type TransferElement = BiquadLowPass | FirstOrderLowPass | Notch | HarmonicNotch | Pid | AngleP | Feedforward

export function elementResponse(element: TransferElement, grid: ZGrid): ComplexArray {
  switch (element.kind) {
    case 'biquad-low-pass':
      return biquadLowPassResponse(element, grid)
    case 'first-order-low-pass':
      return firstOrderLowPassResponse(element, grid)
    case 'notch':
      return notchResponse(element, grid)
    case 'harmonic-notch':
      return harmonicNotchResponse(element, grid)
    case 'pid':
      return pidResponse(element, grid).total
    case 'angle-p':
      return anglePResponse(element, grid)
    case 'feedforward':
      return feedforwardResponse(element, grid)
  }
}

/** Whether an element filters at all (a harmonic notch that is enabled, a low-pass with a cut-off). */
export function isElementEnabled(element: TransferElement): boolean {
  switch (element.kind) {
    case 'harmonic-notch':
      return element.enabled
    case 'biquad-low-pass':
    case 'notch':
      return element.biquad !== null
    case 'first-order-low-pass':
      return element.alpha !== null
    case 'pid':
    case 'angle-p':
    case 'feedforward':
      return true
  }
}

/**
 * Product of every element's response on `freq`. Each group shares the first element's sample
 * rate and its own z grid; the product starts from unity and follows group and element order,
 * as upstream.
 */
export function chainResponse(freq: ArrayLike<number>, groups: readonly (readonly TransferElement[])[]): ComplexArray {
  let total = unityResponse(freq.length)
  for (const group of groups) {
    const first = group[0]
    if (first === undefined) continue
    const grid = zGrid(freq, first.sampleRate)
    for (const element of group) total = complexMul(total, elementResponse(element, grid))
  }
  return total
}
