/**
 * The state space presets of upstream `SysID/index.html` (`setinputValues`, `setParamValues`,
 * `setInputFields`, `setOutputFields`, `setConstraintList`, `setBounds`, `setMatrixA`,
 * `setMatrixB`, `setH0`, `setH1`), written out as complete tables. Every preset fills each cell
 * of its matrices, so the tables are exactly what upstream leaves in the fields.
 */
import type { CompensationAxis } from './prepare.js'

export const PRESET_IDS = ['MR_Roll', 'MR_Pitch', 'MR_Yaw', 'MR_Vertical'] as const
export type PresetId = (typeof PRESET_IDS)[number]

/** Upstream dropdown value: `manual` or a preset. */
export type PresetChoice = 'manual' | PresetId

export const PRESET_LABELS: Readonly<Record<PresetChoice, string>> = {
  manual: 'Manual entry',
  MR_Roll: 'Multirotor roll',
  MR_Pitch: 'Multirotor pitch',
  MR_Yaw: 'Multirotor yaw',
  MR_Vertical: 'Multirotor vertical'
}

/** What a preset writes into one output's fields (upstream `setOutputFields`). */
export interface PresetOutput {
  readonly message: string
  readonly field: string
  /** Ticks the multiplier box and writes this text. */
  readonly multiplier?: string
  /** Ticks gravity compensation and selects this axis. */
  readonly compensation?: CompensationAxis
}

export interface Preset {
  /** Sizes written into the setup inputs (upstream `setinputValues`), as the text upstream writes. */
  readonly sizes: { readonly outputs: string; readonly params: string; readonly order: string; readonly constraints: string }
  readonly input: { readonly message: string; readonly field: string }
  readonly outputs: readonly PresetOutput[]
  readonly params: readonly string[]
  /** `[min, max]` text per parameter field, in parameter-field order (upstream `setBounds`; MR_Yaw reordered, see there). */
  readonly bounds: readonly (readonly [string, string])[]
  readonly constraints: readonly (readonly [string, string])[]
  readonly a: readonly (readonly string[])[]
  readonly b: readonly (readonly string[])[]
  readonly h0: readonly (readonly string[])[]
  readonly h1: readonly (readonly string[])[]
}

const DEG_TO_RAD = '0.01745'

const LATERAL_SIZES = { outputs: '2', params: '6', order: '4', constraints: '1' } as const
const LATERAL_BOUNDS = [
  ['-1', '0'],
  ['-30', '30'],
  ['-10', '10'],
  ['50', '200'],
  ['-50', '0'],
  ['0', '50']
] as const
const LATERAL_B = [['0'], ['0'], ['0'], ['wlg']] as const
const LATERAL_H0 = [
  ['0', '1', '0', '0'],
  ['0', '0', '0', '0']
] as const
const LATERAL_H1 = [
  ['0', '0', '0', '0'],
  ['1', '0', '0', '0']
] as const
const LATERAL_CONSTRAINT = [['A_3_3', '-B_3_0']] as const
const AXIAL_CONSTRAINT = [['A_1_1', '-B_1_0']] as const

export const PRESETS: Readonly<Record<PresetId, Preset>> = {
  MR_Roll: {
    sizes: LATERAL_SIZES,
    input: { message: 'RATE', field: 'ROut' },
    outputs: [
      { message: 'SIDD', field: 'Gx', multiplier: DEG_TO_RAD },
      { message: 'SIDD', field: 'Ay', compensation: 'Roll' }
    ],
    params: ['Yv', 'Ylat', 'Lv', 'Llat', 'wlag', 'wlg'],
    bounds: LATERAL_BOUNDS,
    constraints: LATERAL_CONSTRAINT,
    a: [
      ['Yv', '0', '9.81', 'Ylat'],
      ['Lv', '0', '0', 'Llat'],
      ['0', '1', '0', '0'],
      ['0', '0', '0', 'wlag']
    ],
    b: LATERAL_B,
    h0: LATERAL_H0,
    h1: LATERAL_H1
  },
  MR_Pitch: {
    sizes: LATERAL_SIZES,
    input: { message: 'RATE', field: 'POut' },
    outputs: [
      { message: 'SIDD', field: 'Gy', multiplier: DEG_TO_RAD },
      { message: 'SIDD', field: 'Ax', compensation: 'Pitch' }
    ],
    params: ['Xu', 'Xlon', 'Mu', 'Mlon', 'wlag', 'wlg'],
    bounds: LATERAL_BOUNDS,
    constraints: LATERAL_CONSTRAINT,
    a: [
      ['Xu', '0', '-9.81', 'Xlon'],
      ['Mu', '0', '0', 'Mlon'],
      ['0', '1', '0', '0'],
      ['0', '0', '0', 'wlag']
    ],
    b: LATERAL_B,
    h0: LATERAL_H0,
    h1: LATERAL_H1
  },
  MR_Yaw: {
    sizes: { outputs: '1', params: '5', order: '2', constraints: '1' },
    input: { message: 'RATE', field: 'YOut' },
    outputs: [{ message: 'SIDD', field: 'Gz', multiplier: DEG_TO_RAD }],
    // Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 1): upstream lists Npedp before
    // wlag, but pyAircraftIden applies bounds by position in matrix-cell order (A then B), so
    // Npedp's (-10, 10) landed on wlag and wlag's (-50, 0) on Npedp. Listed in cell order here.
    params: ['Nr', 'Nped', 'wlag', 'Npedp', 'wlg'],
    bounds: [
      ['-1', '0'],
      ['0', '80'],
      ['-50', '0'],
      ['-10', '10'],
      ['0', '50']
    ],
    constraints: AXIAL_CONSTRAINT,
    a: [
      ['Nr', 'Nped'],
      ['0', 'wlag']
    ],
    b: [['Npedp'], ['wlg']],
    h0: [['1', '0']],
    h1: [['0', '0']]
  },
  MR_Vertical: {
    sizes: { outputs: '1', params: '4', order: '2', constraints: '1' },
    input: { message: 'RATE', field: 'AOut' },
    outputs: [{ message: 'SIDD', field: 'Az' }],
    params: ['Zw', 'Zcoll', 'wlag', 'wlg'],
    bounds: [
      ['-1', '0'],
      ['-100', '100'],
      ['-50', '0'],
      ['0', '50']
    ],
    constraints: AXIAL_CONSTRAINT,
    a: [
      ['Zw', 'Zcoll'],
      ['0', 'wlag']
    ],
    b: [['0'], ['wlg']],
    h0: [['0', '0']],
    h1: [['1', '0']]
  }
}
