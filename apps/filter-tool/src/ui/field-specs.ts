/**
 * How each input is presented: short labels (the full ArduPilot description is the tooltip),
 * input steps from upstream's form, and the operating-point inputs that are not parameters.
 */
import type { NotchField, PidTerm, SimInputName } from '../analysis/params.js'

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

export const PID_TERM_LABELS: Readonly<Record<PidTerm, string>> = {
  P: 'P gain',
  I: 'I gain',
  D: 'D gain',
  FLTE: 'Error filter',
  FLTD: 'Derivative filter'
}

/** Input steps, as in upstream's form. */
export const NOTCH_STEPS: Readonly<Record<NotchField, number>> = {
  ENABLE: 1,
  MODE: 1,
  FREQ: 0.1,
  BW: 0.1,
  ATT: 0.1,
  REF: 0.01,
  FM_RAT: 0.01,
  HMNCS: 1,
  OPTS: 1
}

export const PID_STEPS: Readonly<Record<PidTerm, number>> = { P: 0.01, I: 0.01, D: 0.0001, FLTE: 0.01, FLTD: 0.01 }

/** Operating-point inputs: label, unit and help. */
export const SIM_INPUTS: Readonly<Record<SimInputName, { label: string; units?: string; step: number; help: string }>> = {
  GyroSampleRate: {
    label: 'Gyro sample rate',
    units: 'Hz',
    step: 1,
    help: 'Rate the gyro filters run at, typically 1 to 2 kHz.'
  },
  Throttle: { label: 'Throttle', step: 0.01, help: 'Throttle (0 to 1) at which to place throttle-based notches.' },
  NUM_MOTORS: { label: 'Number of motors', step: 1, help: 'Motors reporting ESC telemetry. Used with the Multi-Source option.' },
  ESC_RPM: { label: 'ESC RPM', units: 'RPM', step: 1, help: 'Motor speed reported by ESC telemetry.' },
  RPM1: { label: 'RPM sensor 1', units: 'RPM', step: 1, help: 'Reading of the first RPM sensor.' },
  RPM2: { label: 'RPM sensor 2', units: 'RPM', step: 1, help: 'Reading of the second RPM sensor.' }
}

/** Shorter chip labels for the harmonics bitmask; the metadata labels are the tooltips. */
export const HARMONIC_BIT_LABELS: readonly string[] = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']
