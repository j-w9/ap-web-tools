/**
 * How each input is presented: short labels (the full ArduPilot description is the tooltip) and
 * the operating-point inputs that are not parameters.
 */
import type { FilterField, InputTcParam, NotchField, RateTerm, SimInputName } from '../analysis/params.js'

export const NOTCH_FIELD_LABELS: Readonly<Record<NotchField, string>> = {
  ENABLE: 'Enable',
  MODE: 'Tracking mode',
  FREQ: 'Base frequency',
  BW: 'Bandwidth',
  ATT: 'Attenuation',
  REF: 'Reference value',
  FM_RAT: 'Minimum frequency ratio',
  HMNCS: 'Harmonics',
  OPTS: 'Options'
}

export const RATE_TERM_LABELS: Readonly<Record<RateTerm, string>> = {
  FF: 'Feedforward',
  P: 'P gain',
  I: 'I gain',
  D: 'D gain',
  D_FF: 'Derivative feedforward',
  FLTT: 'Target filter',
  FLTE: 'Error filter',
  FLTD: 'Derivative filter',
  NTF: 'Target notch filter',
  NEF: 'Error notch filter'
}

export const INPUT_TC_LABELS: Readonly<Record<InputTcParam, string>> = {
  ATC_INPUT_TC: 'Input time constant',
  Q_A_INPUT_TC: 'Input time constant',
  PILOT_Y_RATE_TC: 'Pilot yaw rate time constant',
  Q_PLT_Y_RATE_TC: 'Pilot yaw rate time constant'
}

export const FILTER_FIELD_LABELS: Readonly<Record<FilterField, string>> = {
  TYPE: 'Type',
  NOTCH_FREQ: 'Centre frequency',
  NOTCH_Q: 'Quality factor',
  NOTCH_ATT: 'Attenuation'
}

/** Operating-point inputs: label, unit and help. */
export const SIM_INPUTS: Readonly<Record<SimInputName, { label: string; units?: string; help: string }>> = {
  GyroSampleRate: {
    label: 'Gyro sample rate',
    units: 'Hz',
    help: 'Rate the gyro filters run at. Estimated from INS_GYRO_RATE when a log is loaded.'
  },
  Throttle: { label: 'Throttle', help: 'Throttle (0 to 1) at which to place throttle-based notches.' },
  NUM_MOTORS: { label: 'Number of motors', help: 'Motors reporting ESC telemetry. Used with the Multi-Source option.' },
  ESC_RPM: { label: 'ESC RPM', units: 'RPM', help: 'Motor speed reported by ESC telemetry.' },
  RPM1: { label: 'RPM sensor 1', units: 'RPM', help: 'Reading of the first RPM sensor.' },
  RPM2: { label: 'RPM sensor 2', units: 'RPM', help: 'Reading of the second RPM sensor.' }
}

/** Shorter chip labels for the harmonics bitmask; the metadata labels are the tooltips. */
export const HARMONIC_BIT_LABELS: readonly string[] = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']
