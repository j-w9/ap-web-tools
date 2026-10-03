/**
 * @apwt/filters — framework-free models of ArduPilot's digital filters and rate controllers:
 * one typed design plus frequency-response evaluation per element, harmonic-notch configuration,
 * chain evaluation and phase unwrap/wrap. Ported from upstream `FilterTool/filters.js`,
 * `AnalyticTune.js` and `FilterReview.js`; where those tools compute differently, each variant
 * is kept under its own name so every tool's numbers match its upstream bit for bit.
 */
export { zGrid, frequencyGrid, unityResponse, type ZGrid } from './z-grid.js'
export {
  biquadResponse,
  unitAccumulator,
  copyAccumulator,
  accumulatorResponse,
  accumulateBiquad,
  type Biquad,
  type TransferAccumulator
} from './biquad.js'
export {
  designBiquadLowPass,
  biquadLowPassResponse,
  designFirstOrderLowPass,
  firstOrderLowPassResponse,
  type BiquadLowPass,
  type FirstOrderLowPass
} from './low-pass.js'
export {
  designNotchWithQ,
  designNotchWithBandwidth,
  notchResponse,
  type Notch,
  type BandwidthNotch,
  type QNotch
} from './notch.js'
export {
  HARMONICS,
  COMPOSITE_NOTCHES,
  trackedFrequency,
  designHarmonicNotch,
  harmonicNotchResponse,
  type Harmonic,
  type NotchComposition,
  type NotchTracking,
  type TrackingMode,
  type HarmonicNotchConfig,
  type OperatingPoint,
  type HarmonicNotch
} from './harmonic-notch.js'
export {
  designTrackedNotch,
  designTrackedNotchGroup,
  accumulateTrackedNotch,
  accumulateTrackedNotchGroup,
  type MinFrequency,
  type TrackedNotch
} from './tracked-notch.js'
export {
  designPid,
  pidResponse,
  designAngleP,
  anglePResponse,
  designFeedforward,
  feedforwardResponse,
  type PidGains,
  type Pid,
  type PidResponse,
  type AngleP,
  type Feedforward
} from './controllers.js'
export { elementResponse, isElementEnabled, chainResponse, type TransferElement } from './chain.js'
export { phaseDegrees, unwrapPhase, unwrapPhaseInclusive, wrapPhase } from './phase.js'
