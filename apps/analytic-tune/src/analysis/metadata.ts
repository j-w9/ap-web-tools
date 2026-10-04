/**
 * Parameter metadata for the modelled parameters, as typed data. Ported from the entries of
 * upstream `AnalyticTune/params.json` (ArduPilot's generated metadata) that the tool uses; the
 * oracle test checks every entry against that file.
 *
 * Note: upstream's `params.json` carries the helicopter (`AC_AttitudeControl_Heli`) variant of
 * the `ATC_RAT_*` metadata, so ranges for those differ slightly from multicopter firmware.
 */
import type { ParamName } from './params.js'

interface MetadataBase {
  readonly displayName: string
  readonly description: string
  readonly user: 'Standard' | 'Advanced'
  readonly units?: string
  readonly range?: { readonly low: number; readonly high: number }
  readonly increment?: number
  readonly rebootRequired?: true
}

/** One named value of an enumerated parameter. */
export interface ParamValueOption {
  readonly value: number
  readonly label: string
}

/** One bit of a bitmask parameter. */
export interface ParamBit {
  readonly bit: number
  readonly label: string
}

/** How a parameter is edited: free number, one of a list of values, or a set of bits. */
export type ParamMetadata = MetadataBase &
  (
    | { readonly kind: 'number' }
    | { readonly kind: 'values'; readonly values: readonly ParamValueOption[] }
    | { readonly kind: 'bitmask'; readonly bits: readonly ParamBit[] }
  )

export const PARAM_METADATA: Readonly<Record<ParamName, ParamMetadata>> = {
  INS_GYRO_FILTER: {
    displayName: 'Gyro filter cutoff frequency',
    description:
      'Filter cutoff frequency for gyroscopes. This can be set to a lower value to try to cope with very high vibration levels in aircraft. A value of zero means no filtering (not recommended!)',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 0, high: 256 },
    kind: 'number'
  },
  INS_HNTCH_ENABLE: {
    displayName: 'Harmonic Notch Filter enable',
    description: 'Harmonic Notch Filter enable',
    user: 'Advanced',
    kind: 'values',
    values: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'Enabled' }
    ]
  },
  INS_HNTCH_MODE: {
    displayName: 'Harmonic Notch Filter dynamic frequency tracking mode',
    description:
      'Harmonic Notch Filter dynamic frequency tracking mode. Dynamic updates can be throttle, RPM sensor, ESC telemetry or dynamic FFT based. Throttle-based updates should only be used with multicopters.',
    user: 'Advanced',
    range: { low: 0, high: 5 },
    kind: 'values',
    values: [
      { value: 0, label: 'Fixed' },
      { value: 1, label: 'Throttle' },
      { value: 2, label: 'RPM Sensor' },
      { value: 3, label: 'ESC Telemetry' },
      { value: 4, label: 'Dynamic FFT' },
      { value: 5, label: 'Second RPM Sensor' }
    ]
  },
  INS_HNTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  INS_HNTCH_BW: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 5, high: 250 },
    kind: 'number'
  },
  INS_HNTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  INS_HNTCH_REF: {
    displayName: 'Harmonic Notch Filter reference value',
    description:
      'A reference value of zero disables dynamic updates on the Harmonic Notch Filter and a positive value enables dynamic updates on the Harmonic Notch Filter.  For throttle-based scaling, this parameter is the reference value associated with the specified frequency to facilitate frequency scaling of the Harmonic Notch Filter. For RPM and ESC telemetry based tracking, this parameter is set to 1 to enable the Harmonic Notch Filter using the RPM sensor or ESC telemetry set to measure rotor speed.  The sensor data is converted to Hz automatically for use in the Harmonic Notch Filter.  This reference value may also be used to scale the sensor data, if required.  For example, rpm sensor data is required to measure heli motor RPM. Therefore the reference value can be used to scale the RPM sensor to the rotor RPM.',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    rebootRequired: true,
    kind: 'number'
  },
  INS_HNTCH_FM_RAT: {
    displayName: 'Throttle notch min freqency ratio',
    description:
      'The minimum ratio below the configured frequency to take throttle based notch filters when flying at a throttle level below the reference throttle. Note that lower frequency notch filters will have more phase lag. If you want throttle based notch filtering to be effective at a throttle up to 30% below the configured notch frequency then set this parameter to 0.7. The default of 1.0 means the notch will not go below the frequency in the FREQ parameter.',
    user: 'Advanced',
    range: { low: 0.1, high: 1 },
    kind: 'number'
  },
  INS_HNTCH_HMNCS: {
    displayName: 'Harmonic Notch Filter harmonics',
    description:
      'Bitmask of harmonic frequencies to apply Harmonic Notch Filter to. This option takes effect on the next reboot. A value of 0 disables this filter. The first harmonic refers to the base frequency.',
    user: 'Advanced',
    rebootRequired: true,
    kind: 'bitmask',
    bits: [
      { bit: 0, label: '1st harmonic' },
      { bit: 1, label: '2nd harmonic' },
      { bit: 2, label: '3rd harmonic' },
      { bit: 3, label: '4th hamronic' },
      { bit: 4, label: '5th harmonic' },
      { bit: 5, label: '6th harmonic' },
      { bit: 6, label: '7th harmonic' },
      { bit: 7, label: '8th harmonic' }
    ]
  },
  INS_HNTCH_OPTS: {
    displayName: 'Harmonic Notch Filter options',
    description:
      'Harmonic Notch Filter options. Triple and double-notches can provide deeper attenuation across a wider bandwidth with reduced latency than single notches and are suitable for larger aircraft. Multi-Source attaches a harmonic notch to each detected noise frequency instead of simply being multiples of the base frequency, in the case of FFT it will attach notches to each of three detected noise peaks, in the case of ESC it will attach notches to each of four motor RPM values. Loop rate update changes the notch center frequency at the scheduler loop rate rather than at the default of 200Hz. If both double and triple notches are specified only double notches will take effect.',
    user: 'Advanced',
    rebootRequired: true,
    kind: 'bitmask',
    bits: [
      { bit: 0, label: 'Double notch' },
      { bit: 1, label: 'Multi-Source' },
      { bit: 2, label: 'Update at loop rate' },
      { bit: 3, label: 'EnableOnAllIMUs' },
      { bit: 4, label: 'Triple notch' }
    ]
  },
  INS_HNTC2_ENABLE: {
    displayName: 'Harmonic Notch Filter enable',
    description: 'Harmonic Notch Filter enable',
    user: 'Advanced',
    kind: 'values',
    values: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'Enabled' }
    ]
  },
  INS_HNTC2_MODE: {
    displayName: 'Harmonic Notch Filter dynamic frequency tracking mode',
    description:
      'Harmonic Notch Filter dynamic frequency tracking mode. Dynamic updates can be throttle, RPM sensor, ESC telemetry or dynamic FFT based. Throttle-based updates should only be used with multicopters.',
    user: 'Advanced',
    range: { low: 0, high: 5 },
    kind: 'values',
    values: [
      { value: 0, label: 'Fixed' },
      { value: 1, label: 'Throttle' },
      { value: 2, label: 'RPM Sensor' },
      { value: 3, label: 'ESC Telemetry' },
      { value: 4, label: 'Dynamic FFT' },
      { value: 5, label: 'Second RPM Sensor' }
    ]
  },
  INS_HNTC2_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  INS_HNTC2_BW: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 5, high: 250 },
    kind: 'number'
  },
  INS_HNTC2_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  INS_HNTC2_REF: {
    displayName: 'Harmonic Notch Filter reference value',
    description:
      'A reference value of zero disables dynamic updates on the Harmonic Notch Filter and a positive value enables dynamic updates on the Harmonic Notch Filter.  For throttle-based scaling, this parameter is the reference value associated with the specified frequency to facilitate frequency scaling of the Harmonic Notch Filter. For RPM and ESC telemetry based tracking, this parameter is set to 1 to enable the Harmonic Notch Filter using the RPM sensor or ESC telemetry set to measure rotor speed.  The sensor data is converted to Hz automatically for use in the Harmonic Notch Filter.  This reference value may also be used to scale the sensor data, if required.  For example, rpm sensor data is required to measure heli motor RPM. Therefore the reference value can be used to scale the RPM sensor to the rotor RPM.',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    rebootRequired: true,
    kind: 'number'
  },
  INS_HNTC2_FM_RAT: {
    displayName: 'Throttle notch min freqency ratio',
    description:
      'The minimum ratio below the configured frequency to take throttle based notch filters when flying at a throttle level below the reference throttle. Note that lower frequency notch filters will have more phase lag. If you want throttle based notch filtering to be effective at a throttle up to 30% below the configured notch frequency then set this parameter to 0.7. The default of 1.0 means the notch will not go below the frequency in the FREQ parameter.',
    user: 'Advanced',
    range: { low: 0.1, high: 1 },
    kind: 'number'
  },
  INS_HNTC2_HMNCS: {
    displayName: 'Harmonic Notch Filter harmonics',
    description:
      'Bitmask of harmonic frequencies to apply Harmonic Notch Filter to. This option takes effect on the next reboot. A value of 0 disables this filter. The first harmonic refers to the base frequency.',
    user: 'Advanced',
    rebootRequired: true,
    kind: 'bitmask',
    bits: [
      { bit: 0, label: '1st harmonic' },
      { bit: 1, label: '2nd harmonic' },
      { bit: 2, label: '3rd harmonic' },
      { bit: 3, label: '4th hamronic' },
      { bit: 4, label: '5th harmonic' },
      { bit: 5, label: '6th harmonic' },
      { bit: 6, label: '7th harmonic' },
      { bit: 7, label: '8th harmonic' }
    ]
  },
  INS_HNTC2_OPTS: {
    displayName: 'Harmonic Notch Filter options',
    description:
      'Harmonic Notch Filter options. Triple and double-notches can provide deeper attenuation across a wider bandwidth with reduced latency than single notches and are suitable for larger aircraft. Multi-Source attaches a harmonic notch to each detected noise frequency instead of simply being multiples of the base frequency, in the case of FFT it will attach notches to each of three detected noise peaks, in the case of ESC it will attach notches to each of four motor RPM values. Loop rate update changes the notch center frequency at the scheduler loop rate rather than at the default of 200Hz. If both double and triple notches are specified only double notches will take effect.',
    user: 'Advanced',
    rebootRequired: true,
    kind: 'bitmask',
    bits: [
      { bit: 0, label: 'Double notch' },
      { bit: 1, label: 'Multi-Source' },
      { bit: 2, label: 'Update at loop rate' },
      { bit: 3, label: 'EnableOnAllIMUs' },
      { bit: 4, label: 'Triple notch' }
    ]
  },
  SCHED_LOOP_RATE: {
    displayName: 'Scheduling main loop rate',
    description:
      'This controls the rate of the main control loop in Hz. This should only be changed by developers. This only takes effect on restart. Values over 400 are considered highly experimental.',
    user: 'Advanced',
    rebootRequired: true,
    kind: 'number'
  },
  ATC_INPUT_TC: {
    displayName: 'Attitude control input time constant',
    description: 'Attitude control input time constant.  Low numbers lead to sharper response, higher numbers to softer response',
    user: 'Standard',
    units: 's',
    range: { low: 0, high: 1 },
    increment: 0.01,
    kind: 'number'
  },
  Q_A_INPUT_TC: {
    displayName: 'Attitude control input time constant',
    description: 'Attitude control input time constant.  Low numbers lead to sharper response, higher numbers to softer response',
    user: 'Standard',
    units: 's',
    range: { low: 0, high: 1 },
    increment: 0.01,
    kind: 'number'
  },
  PILOT_Y_RATE_TC: {
    displayName: 'Pilot yaw rate control input time constant',
    description: 'Pilot yaw rate control input time constant',
    user: 'Advanced',
    units: 's',
    range: { low: 0.01, high: 0.5 },
    kind: 'number'
  },
  Q_PLT_Y_RATE_TC: {
    displayName: 'Pilot yaw rate control input time constant',
    description:
      'Pilot yaw rate control input time constant. Low numbers lead to sharper response, higher numbers to softer response.',
    user: 'Standard',
    units: 's',
    range: { low: 0, high: 1 },
    increment: 0.01,
    kind: 'number'
  },
  ATC_ANG_RLL_P: {
    displayName: 'Roll axis angle controller P gain',
    description:
      'Roll axis angle controller P gain.  Converts the error between the desired roll angle and actual angle to a desired roll rate',
    user: 'Standard',
    range: { low: 3, high: 12 },
    kind: 'number'
  },
  ATC_RAT_RLL_FF: {
    displayName: 'Roll axis rate controller feed forward',
    description: 'Roll axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0.05, high: 0.5 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_RLL_P: {
    displayName: 'Roll axis rate controller P gain',
    description:
      'Roll axis rate controller P gain.  Corrects in proportion to the difference between the desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0, high: 0.35 },
    increment: 0.005,
    kind: 'number'
  },
  ATC_RAT_RLL_I: {
    displayName: 'Roll axis rate controller I gain',
    description: 'Roll axis rate controller I gain.  Corrects long-term difference in desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0, high: 0.6 },
    increment: 0.01,
    kind: 'number'
  },
  ATC_RAT_RLL_D: {
    displayName: 'Roll axis rate controller D gain',
    description: 'Roll axis rate controller D gain.  Compensates for short-term change in desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_RLL_D_FF: {
    displayName: 'Roll axis rate controller D feedforward gain',
    description: 'Roll axis rate controller D feedforward gain.',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_RLL_FLTT: {
    displayName: 'Roll axis rate controller target frequency in Hz',
    description: 'Roll axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_RLL_FLTE: {
    displayName: 'Roll axis rate controller error frequency in Hz',
    description: 'Roll axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_RLL_FLTD: {
    displayName: 'Roll axis rate controller derivative frequency in Hz',
    description: 'Roll axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_ANG_RLL_P: {
    displayName: 'Roll axis angle controller P gain',
    description:
      'Roll axis angle controller P gain.  Converts the error between the desired roll angle and actual angle to a desired roll rate',
    user: 'Standard',
    range: { low: 3, high: 12 },
    kind: 'number'
  },
  Q_A_RAT_RLL_FF: {
    displayName: 'Roll axis rate controller feed forward',
    description: 'Roll axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0.05, high: 0.5 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_RLL_P: {
    displayName: 'Roll axis rate controller P gain',
    description:
      'Roll axis rate controller P gain.  Corrects in proportion to the difference between the desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0, high: 0.35 },
    increment: 0.005,
    kind: 'number'
  },
  Q_A_RAT_RLL_I: {
    displayName: 'Roll axis rate controller I gain',
    description: 'Roll axis rate controller I gain.  Corrects long-term difference in desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0, high: 0.6 },
    increment: 0.01,
    kind: 'number'
  },
  Q_A_RAT_RLL_D: {
    displayName: 'Roll axis rate controller D gain',
    description: 'Roll axis rate controller D gain.  Compensates for short-term change in desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_RLL_D_FF: {
    displayName: 'Roll axis rate controller D feedforward gain',
    description: 'Roll axis rate controller D feedforward gain.',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_RLL_FLTT: {
    displayName: 'Roll axis rate controller target frequency in Hz',
    description: 'Roll axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_RLL_FLTE: {
    displayName: 'Roll axis rate controller error frequency in Hz',
    description: 'Roll axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_RLL_FLTD: {
    displayName: 'Roll axis rate controller derivative frequency in Hz',
    description: 'Roll axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  RLL2SRV_TCONST: {
    displayName: 'Roll Time Constant',
    description:
      'Time constant in seconds from demanded to achieved roll angle. Most models respond well to 0.5. May be reduced for faster responses, but setting lower than a model can achieve will not help.',
    user: 'Advanced',
    units: 's',
    range: { low: 0.4, high: 1 },
    increment: 0.1,
    kind: 'number'
  },
  RLL_RATE_FF: {
    displayName: 'Roll axis rate controller feed forward',
    description: 'Roll axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0, high: 3 },
    increment: 0.001,
    kind: 'number'
  },
  RLL_RATE_P: {
    displayName: 'Roll axis rate controller P gain',
    description:
      'Roll axis rate controller P gain. Corrects in proportion to the difference between the desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0.08, high: 0.35 },
    increment: 0.005,
    kind: 'number'
  },
  RLL_RATE_I: {
    displayName: 'Roll axis rate controller I gain',
    description: 'Roll axis rate controller I gain.  Corrects long-term difference in desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0.01, high: 0.6 },
    increment: 0.01,
    kind: 'number'
  },
  RLL_RATE_D: {
    displayName: 'Roll axis rate controller D gain',
    description: 'Roll axis rate controller D gain.  Compensates for short-term change in desired roll rate vs actual roll rate',
    user: 'Standard',
    range: { low: 0.001, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  RLL_RATE_D_FF: {
    displayName: 'Roll Derivative FeedForward Gain',
    description: 'FF D Gain which produces an output that is proportional to the rate of change of the target',
    user: 'Advanced',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  RLL_RATE_FLTT: {
    displayName: 'Roll axis rate controller target frequency in Hz',
    description: 'Roll axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 2, high: 50 },
    increment: 1,
    kind: 'number'
  },
  RLL_RATE_FLTE: {
    displayName: 'Roll axis rate controller error frequency in Hz',
    description: 'Roll axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 2, high: 50 },
    increment: 1,
    kind: 'number'
  },
  RLL_RATE_FLTD: {
    displayName: 'Roll axis rate controller derivative frequency in Hz',
    description: 'Roll axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_ANG_PIT_P: {
    displayName: 'Pitch axis angle controller P gain',
    description:
      'Pitch axis angle controller P gain.  Converts the error between the desired pitch angle and actual angle to a desired pitch rate',
    user: 'Standard',
    range: { low: 3, high: 12 },
    kind: 'number'
  },
  ATC_RAT_PIT_FF: {
    displayName: 'Pitch axis rate controller feed forward',
    description: 'Pitch axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0.05, high: 0.5 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_PIT_P: {
    displayName: 'Pitch axis rate controller P gain',
    description:
      'Pitch axis rate controller P gain.  Corrects in proportion to the difference between the desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0, high: 0.35 },
    increment: 0.005,
    kind: 'number'
  },
  ATC_RAT_PIT_I: {
    displayName: 'Pitch axis rate controller I gain',
    description: 'Pitch axis rate controller I gain.  Corrects long-term difference in desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0, high: 0.6 },
    increment: 0.01,
    kind: 'number'
  },
  ATC_RAT_PIT_D: {
    displayName: 'Pitch axis rate controller D gain',
    description:
      'Pitch axis rate controller D gain.  Compensates for short-term change in desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_PIT_D_FF: {
    displayName: 'Pitch axis rate controller D feedforward gain',
    description: 'Pitch axis rate controller D feedforward gain.',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_PIT_FLTT: {
    displayName: 'Pitch axis rate controller target frequency in Hz',
    description: 'Pitch axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_PIT_FLTE: {
    displayName: 'Pitch axis rate controller error frequency in Hz',
    description: 'Pitch axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_PIT_FLTD: {
    displayName: 'Pitch axis rate controller derivative frequency in Hz',
    description: 'Pitch axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_ANG_PIT_P: {
    displayName: 'Pitch axis angle controller P gain',
    description:
      'Pitch axis angle controller P gain.  Converts the error between the desired pitch angle and actual angle to a desired pitch rate',
    user: 'Standard',
    range: { low: 3, high: 12 },
    kind: 'number'
  },
  Q_A_RAT_PIT_FF: {
    displayName: 'Pitch axis rate controller feed forward',
    description: 'Pitch axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0.05, high: 0.5 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_PIT_P: {
    displayName: 'Pitch axis rate controller P gain',
    description:
      'Pitch axis rate controller P gain.  Corrects in proportion to the difference between the desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0, high: 0.35 },
    increment: 0.005,
    kind: 'number'
  },
  Q_A_RAT_PIT_I: {
    displayName: 'Pitch axis rate controller I gain',
    description: 'Pitch axis rate controller I gain.  Corrects long-term difference in desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0, high: 0.6 },
    increment: 0.01,
    kind: 'number'
  },
  Q_A_RAT_PIT_D: {
    displayName: 'Pitch axis rate controller D gain',
    description:
      'Pitch axis rate controller D gain.  Compensates for short-term change in desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_PIT_D_FF: {
    displayName: 'Pitch axis rate controller D feedforward gain',
    description: 'Pitch axis rate controller D feedforward gain.',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_PIT_FLTT: {
    displayName: 'Pitch axis rate controller target frequency in Hz',
    description: 'Pitch axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_PIT_FLTE: {
    displayName: 'Pitch axis rate controller error frequency in Hz',
    description: 'Pitch axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_PIT_FLTD: {
    displayName: 'Pitch axis rate controller derivative frequency in Hz',
    description: 'Pitch axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  PTCH2SRV_TCONST: {
    displayName: 'Pitch Time Constant',
    description:
      'Time constant in seconds from demanded to achieved pitch angle. Most models respond well to 0.5. May be reduced for faster responses, but setting lower than a model can achieve will not help.',
    user: 'Advanced',
    units: 's',
    range: { low: 0.4, high: 1 },
    increment: 0.1,
    kind: 'number'
  },
  PTCH_RATE_FF: {
    displayName: 'Pitch axis rate controller feed forward',
    description: 'Pitch axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0, high: 3 },
    increment: 0.001,
    kind: 'number'
  },
  PTCH_RATE_P: {
    displayName: 'Pitch axis rate controller P gain',
    description:
      'Pitch axis rate controller P gain. Corrects in proportion to the difference between the desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0.08, high: 0.35 },
    increment: 0.005,
    kind: 'number'
  },
  PTCH_RATE_I: {
    displayName: 'Pitch axis rate controller I gain',
    description: 'Pitch axis rate controller I gain.  Corrects long-term difference in desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0.01, high: 0.6 },
    increment: 0.01,
    kind: 'number'
  },
  PTCH_RATE_D: {
    displayName: 'Pitch axis rate controller D gain',
    description:
      'Pitch axis rate controller D gain.  Compensates for short-term change in desired pitch rate vs actual pitch rate',
    user: 'Standard',
    range: { low: 0.001, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  PTCH_RATE_D_FF: {
    displayName: 'Pitch Derivative FeedForward Gain',
    description: 'FF D Gain which produces an output that is proportional to the rate of change of the target',
    user: 'Advanced',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  PTCH_RATE_FLTT: {
    displayName: 'Pitch axis rate controller target frequency in Hz',
    description: 'Pitch axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 2, high: 50 },
    increment: 1,
    kind: 'number'
  },
  PTCH_RATE_FLTE: {
    displayName: 'Pitch axis rate controller error frequency in Hz',
    description: 'Pitch axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 2, high: 50 },
    increment: 1,
    kind: 'number'
  },
  PTCH_RATE_FLTD: {
    displayName: 'Pitch axis rate controller derivative frequency in Hz',
    description: 'Pitch axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_ANG_YAW_P: {
    displayName: 'Yaw axis angle controller P gain',
    description:
      'Yaw axis angle controller P gain.  Converts the error between the desired yaw angle and actual angle to a desired yaw rate',
    user: 'Standard',
    range: { low: 3, high: 12 },
    kind: 'number'
  },
  ATC_RAT_YAW_FF: {
    displayName: 'Yaw axis rate controller feed forward',
    description: 'Yaw axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0, high: 0.5 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_YAW_P: {
    displayName: 'Yaw axis rate controller P gain',
    description:
      'Yaw axis rate controller P gain.  Corrects in proportion to the difference between the desired yaw rate vs actual yaw rate',
    user: 'Standard',
    range: { low: 0.18, high: 0.6 },
    increment: 0.005,
    kind: 'number'
  },
  ATC_RAT_YAW_I: {
    displayName: 'Yaw axis rate controller I gain',
    description: 'Yaw axis rate controller I gain.  Corrects long-term difference in desired yaw rate vs actual yaw rate',
    user: 'Standard',
    range: { low: 0.01, high: 0.2 },
    increment: 0.01,
    kind: 'number'
  },
  ATC_RAT_YAW_D: {
    displayName: 'Yaw axis rate controller D gain',
    description: 'Yaw axis rate controller D gain.  Compensates for short-term change in desired yaw rate vs actual yaw rate',
    user: 'Standard',
    range: { low: 0, high: 0.02 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_YAW_D_FF: {
    displayName: 'Yaw axis rate controller D feedforward gain',
    description: 'Yaw axis rate controller D feedforward gain.',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  ATC_RAT_YAW_FLTT: {
    displayName: 'Yaw axis rate controller target frequency in Hz',
    description: 'Yaw axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_YAW_FLTE: {
    displayName: 'Yaw axis rate controller error frequency in Hz',
    description: 'Yaw axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_YAW_FLTD: {
    displayName: 'Yaw axis rate controller derivative frequency in Hz',
    description: 'Yaw axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_ANG_YAW_P: {
    displayName: 'Yaw axis angle controller P gain',
    description:
      'Yaw axis angle controller P gain.  Converts the error between the desired yaw angle and actual angle to a desired yaw rate',
    user: 'Standard',
    range: { low: 3, high: 12 },
    kind: 'number'
  },
  Q_A_RAT_YAW_FF: {
    displayName: 'Yaw axis rate controller feed forward',
    description: 'Yaw axis rate controller feed forward',
    user: 'Standard',
    range: { low: 0, high: 0.5 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_YAW_P: {
    displayName: 'Yaw axis rate controller P gain',
    description:
      'Yaw axis rate controller P gain.  Corrects in proportion to the difference between the desired yaw rate vs actual yaw rate',
    user: 'Standard',
    range: { low: 0.18, high: 0.6 },
    increment: 0.005,
    kind: 'number'
  },
  Q_A_RAT_YAW_I: {
    displayName: 'Yaw axis rate controller I gain',
    description: 'Yaw axis rate controller I gain.  Corrects long-term difference in desired yaw rate vs actual yaw rate',
    user: 'Standard',
    range: { low: 0.01, high: 0.2 },
    increment: 0.01,
    kind: 'number'
  },
  Q_A_RAT_YAW_D: {
    displayName: 'Yaw axis rate controller D gain',
    description: 'Yaw axis rate controller D gain.  Compensates for short-term change in desired yaw rate vs actual yaw rate',
    user: 'Standard',
    range: { low: 0, high: 0.02 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_YAW_D_FF: {
    displayName: 'Yaw axis rate controller D feedforward gain',
    description: 'Yaw axis rate controller D feedforward gain.',
    user: 'Standard',
    range: { low: 0, high: 0.03 },
    increment: 0.001,
    kind: 'number'
  },
  Q_A_RAT_YAW_FLTT: {
    displayName: 'Yaw axis rate controller target frequency in Hz',
    description: 'Yaw axis rate controller target frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_YAW_FLTE: {
    displayName: 'Yaw axis rate controller error frequency in Hz',
    description: 'Yaw axis rate controller error frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 5, high: 50 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_YAW_FLTD: {
    displayName: 'Yaw axis rate controller derivative frequency in Hz',
    description: 'Yaw axis rate controller derivative frequency in Hz',
    user: 'Standard',
    units: 'Hz',
    range: { low: 0, high: 50 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_RLL_NTF: {
    displayName: 'Roll Target Notch Filter Index',
    description: 'Roll Target Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_RLL_NEF: {
    displayName: 'Roll Error Notch Filter Index',
    description: 'Roll Error Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_RLL_NTF: {
    displayName: 'Roll Target Notch Filter Index',
    description: 'Roll Target Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_RLL_NEF: {
    displayName: 'Roll Error Notch Filter Index',
    description: 'Roll Error Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  RLL_RATE_NTF: {
    displayName: 'Roll Target notch filter index',
    description: 'Roll Target notch filter index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    kind: 'number'
  },
  RLL_RATE_NEF: {
    displayName: 'Roll Error notch filter index',
    description: 'Roll Error notch filter index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    kind: 'number'
  },
  ATC_RAT_PIT_NTF: {
    displayName: 'Pitch Target Notch Filter Index',
    description: 'Pitch Target Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_PIT_NEF: {
    displayName: 'Pitch Error Notch Filter Index',
    description: 'Pitch Error Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_PIT_NTF: {
    displayName: 'Pitch Target Notch Filter Index',
    description: 'Pitch Target Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_PIT_NEF: {
    displayName: 'Pitch Error Notch Filter Index',
    description: 'Pitch Error Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  PTCH_RATE_NTF: {
    displayName: 'Pitch Target notch filter index',
    description: 'Pitch Target notch filter index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    kind: 'number'
  },
  PTCH_RATE_NEF: {
    displayName: 'Pitch Error notch filter index',
    description: 'Pitch Error notch filter index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    kind: 'number'
  },
  YAW_RATE_NTF: {
    displayName: 'Yaw Target notch filter index',
    description: 'Yaw Target notch filter index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    kind: 'number'
  },
  YAW_RATE_NEF: {
    displayName: 'Yaw Error notch filter index',
    description: 'Yaw Error notch filter index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    kind: 'number'
  },
  ATC_RAT_YAW_NTF: {
    displayName: 'Yaw Target Notch Filter Index',
    description: 'Yaw Target Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  ATC_RAT_YAW_NEF: {
    displayName: 'Yaw Error Notch Filter Index',
    description: 'Yaw Error Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_YAW_NTF: {
    displayName: 'Yaw Target Notch Filter Index',
    description: 'Yaw Target Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  Q_A_RAT_YAW_NEF: {
    displayName: 'Yaw Error Notch Filter Index',
    description: 'Yaw Error Notch Filter Index',
    user: 'Advanced',
    range: { low: 1, high: 8 },
    increment: 1,
    kind: 'number'
  },
  FILT1_TYPE: {
    displayName: 'filter 1 type',
    description: 'filter 1 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT1_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT1_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT1_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT2_TYPE: {
    displayName: 'filter 2 type',
    description: 'filter 2 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT2_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT2_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT2_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT3_TYPE: {
    displayName: 'filter 3 type',
    description: 'filter 3 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT3_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT3_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT3_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT4_TYPE: {
    displayName: 'filter 4 type',
    description: 'filter 4 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT4_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT4_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT4_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT5_TYPE: {
    displayName: 'filter 5 type',
    description: 'filter 5 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT5_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT5_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT5_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT6_TYPE: {
    displayName: 'filter 6 type',
    description: 'filter 6 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT6_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT6_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT6_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT7_TYPE: {
    displayName: 'filter 7 type',
    description: 'filter 7 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT7_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT7_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT7_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  },
  FILT8_TYPE: {
    displayName: 'filter 8 type',
    description: 'filter 8 type',
    user: 'Advanced',
    range: { low: 0, high: 1 },
    kind: 'number'
  },
  FILT8_NOTCH_FREQ: {
    displayName: 'Harmonic Notch Filter base frequency',
    description:
      'Harmonic Notch Filter base center frequency in Hz. This is the center frequency for static notches, the center frequency for Throttle based notches at the reference thrust value, and the minimum limit of center frequency variation for all other notch types. This should always be set lower than half the backend gyro rate (which is typically 1Khz).',
    user: 'Advanced',
    units: 'Hz',
    range: { low: 10, high: 495 },
    kind: 'number'
  },
  FILT8_NOTCH_Q: {
    displayName: 'Harmonic Notch Filter bandwidth',
    description:
      'Harmonic Notch Filter bandwidth in Hz. This is typically set to half the base frequency. The ratio of base frequency to bandwidth determines the notch quality factor and is fixed across harmonics.',
    user: 'Advanced',
    range: { low: 1, high: 5 },
    kind: 'number'
  },
  FILT8_NOTCH_ATT: {
    displayName: 'Harmonic Notch Filter attenuation',
    description:
      'Harmonic Notch Filter attenuation in dB. Values greater than 40dB will typically produce a hard notch rather than a modest attenuation of motor noise.',
    user: 'Advanced',
    units: 'dB',
    range: { low: 5, high: 50 },
    kind: 'number'
  }
}
