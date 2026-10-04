/**
 * The inputs of the analytic tune tool: the ArduPilot parameters it models and the operating-point
 * values (gyro rate, throttle, RPM) that place tracking notches but are not parameters.
 *
 * Names are the ArduPilot parameter names (and upstream's form ids for the extra inputs), so
 * `.param` files and share links stay compatible with the upstream tool.
 */

// ---------- Vehicle and axis ----------

/** Vehicle configurations the tool models (upstream `vehicle_type`). */
export const TUNE_VEHICLES = ['copter', 'quadplane', 'fixed-wing'] as const
export type TuneVehicle = (typeof TUNE_VEHICLES)[number]
export type MultirotorVehicle = Exclude<TuneVehicle, 'fixed-wing'>

/** Rate controller axes (upstream `page_axis`). */
export const TUNE_AXES = ['Roll', 'Pitch', 'Yaw'] as const
export type TuneAxis = (typeof TUNE_AXES)[number]

/**
 * Upstream has no fixed-wing yaw rate controller inputs (the page throws when asked to model
 * one), so fixed-wing tuning covers roll and pitch only.
 */
export type FixedWingAxis = Exclude<TuneAxis, 'Yaw'>

/** The controller being tuned. */
export type TuneTarget =
  | { readonly vehicle: MultirotorVehicle; readonly axis: TuneAxis }
  | { readonly vehicle: 'fixed-wing'; readonly axis: FixedWingAxis }

/** Build a target, or null for the unsupported fixed-wing yaw axis. */
export function tuneTarget(vehicle: TuneVehicle, axis: TuneAxis): TuneTarget | null {
  if (vehicle !== 'fixed-wing') return { vehicle, axis }
  return axis === 'Yaw' ? null : { vehicle, axis }
}

// ---------- Parameter names ----------

/** `ATC_` for copter, `Q_A_` for quadplane (upstream `get_vehicle_atc_prefix`). */
const ATC_PREFIX = { copter: 'ATC', quadplane: 'Q_A' } as const
type AtcPrefix = (typeof ATC_PREFIX)[MultirotorVehicle]

/** Axis codes in multirotor parameter names (upstream `get_axis_prefix`). */
const MULTIROTOR_AXIS_CODE = { Roll: 'RLL', Pitch: 'PIT', Yaw: 'YAW' } as const
type MultirotorAxisCode = (typeof MULTIROTOR_AXIS_CODE)[TuneAxis]

/** Fixed-wing names use `PTCH` for pitch. */
const FIXED_WING_AXIS_CODE = { Roll: 'RLL', Pitch: 'PTCH' } as const
type FixedWingAxisCode = (typeof FIXED_WING_AXIS_CODE)[FixedWingAxis]

/** Rate controller gains and filters, in upstream form order. */
export const RATE_GAIN_TERMS = ['FF', 'P', 'I', 'D', 'D_FF', 'FLTT', 'FLTE', 'FLTD'] as const
/** Rate controller notch selections (index of a `FILTn_` notch, 0 for none). */
export const RATE_NOTCH_TERMS = ['NTF', 'NEF'] as const
export type RateTerm = (typeof RATE_GAIN_TERMS)[number] | (typeof RATE_NOTCH_TERMS)[number]

export type MultirotorRateParam = `${AtcPrefix}_RAT_${MultirotorAxisCode}_${RateTerm}`
export type FixedWingRateParam = `${FixedWingAxisCode}_RATE_${RateTerm}`
export type RateParam = MultirotorRateParam | FixedWingRateParam

/** Angle controller: a P gain on multirotors, a time constant on fixed wing. */
export type AngleParam = `${AtcPrefix}_ANG_${MultirotorAxisCode}_P` | `${FixedWingAxisCode}2SRV_TCONST`

/** Input shaping time constants (multirotor only). */
export type InputTcParam = 'ATC_INPUT_TC' | 'Q_A_INPUT_TC' | 'PILOT_Y_RATE_TC' | 'Q_PLT_Y_RATE_TC'

/** The eight general purpose notch filters the rate controller can reference. */
export const FILTER_INDICES = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type FilterIndex = (typeof FILTER_INDICES)[number]
export const FILTER_FIELDS = ['TYPE', 'NOTCH_FREQ', 'NOTCH_Q', 'NOTCH_ATT'] as const
export type FilterField = (typeof FILTER_FIELDS)[number]
export type FilterParam = `FILT${FilterIndex}_${FilterField}`

/** The two harmonic notch parameter groups. */
export const NOTCH_PREFIXES = ['INS_HNTCH', 'INS_HNTC2'] as const
export type NotchPrefix = (typeof NOTCH_PREFIXES)[number]
export const NOTCH_FIELDS = ['ENABLE', 'MODE', 'FREQ', 'BW', 'ATT', 'REF', 'FM_RAT', 'HMNCS', 'OPTS'] as const
export type NotchField = (typeof NOTCH_FIELDS)[number]
export type NotchParam = `${NotchPrefix}_${NotchField}`

/**
 * Fixed-wing yaw rate controller notch selections: the only fixed-wing yaw controller inputs on
 * upstream's page. The tool has no fixed-wing yaw model; they are read, shown and saved as upstream
 * does (its fixed-wing yaw save, a proven bug fixed: docs/bug-proofs/analytic-tune.md, row 112).
 */
export type FixedWingYawNotchParam = `YAW_RATE_${(typeof RATE_NOTCH_TERMS)[number]}`
export const FIXED_WING_YAW_NOTCH: Readonly<Record<(typeof RATE_NOTCH_TERMS)[number], FixedWingYawNotchParam>> = {
  NTF: 'YAW_RATE_NTF',
  NEF: 'YAW_RATE_NEF'
}

export type ParamName =
  | 'SCHED_LOOP_RATE'
  | 'INS_GYRO_FILTER'
  | NotchParam
  | InputTcParam
  | AngleParam
  | RateParam
  | FixedWingYawNotchParam
  | FilterParam

/** Operating-point inputs (upstream form ids). */
export const SIM_INPUT_NAMES = ['GyroSampleRate', 'Throttle', 'NUM_MOTORS', 'ESC_RPM', 'RPM1', 'RPM2'] as const
export type SimInputName = (typeof SIM_INPUT_NAMES)[number]

/** Every numeric input of the tool. */
export type InputName = ParamName | SimInputName

/** Current value of every input. */
export type Inputs = Readonly<Record<InputName, number>>

export const notchParam = (prefix: NotchPrefix, field: NotchField): NotchParam => `${prefix}_${field}`
export const filterParam = (index: FilterIndex, field: FilterField): FilterParam => `FILT${index}_${field}`

/** The `FILTn_` index a rate controller notch selection refers to, or null for none or an invalid value. */
export function filterIndex(value: number): FilterIndex | null {
  return FILTER_INDICES.find((i) => i === value) ?? null
}

// ---------- Controller parameters of a target ----------

/** The parameters of one rate and angle controller. */
export interface ControllerParams {
  readonly rate: Readonly<Record<RateTerm, RateParam>>
  /** Angle P gain (multirotor) or time constant whose inverse is the P gain (fixed wing). */
  readonly angle: { readonly kind: 'gain' | 'time-constant'; readonly param: AngleParam }
  /** Input shaping time constant: `INPUT_TC` for roll and pitch, pilot yaw rate TC for yaw; none on fixed wing. */
  readonly inputTc: InputTcParam | null
}

function rateParams(make: (term: RateTerm) => RateParam): Readonly<Record<RateTerm, RateParam>> {
  return {
    FF: make('FF'),
    P: make('P'),
    I: make('I'),
    D: make('D'),
    D_FF: make('D_FF'),
    FLTT: make('FLTT'),
    FLTE: make('FLTE'),
    FLTD: make('FLTD'),
    NTF: make('NTF'),
    NEF: make('NEF')
  }
}

const INPUT_TC: Readonly<Record<MultirotorVehicle, { readonly rollPitch: InputTcParam; readonly yaw: InputTcParam }>> = {
  copter: { rollPitch: 'ATC_INPUT_TC', yaw: 'PILOT_Y_RATE_TC' },
  quadplane: { rollPitch: 'Q_A_INPUT_TC', yaw: 'Q_PLT_Y_RATE_TC' }
}

/** Parameter names of the target's controllers (upstream `get_rate_param_prefix` and friends). */
export function controllerParams(target: TuneTarget): ControllerParams {
  if (target.vehicle === 'fixed-wing') {
    const code = FIXED_WING_AXIS_CODE[target.axis]
    return {
      rate: rateParams((term): FixedWingRateParam => `${code}_RATE_${term}`),
      angle: { kind: 'time-constant', param: `${code}2SRV_TCONST` },
      inputTc: null
    }
  }
  const atc = ATC_PREFIX[target.vehicle]
  const code = MULTIROTOR_AXIS_CODE[target.axis]
  const tc = INPUT_TC[target.vehicle]
  return {
    rate: rateParams((term): MultirotorRateParam => `${atc}_RAT_${code}_${term}`),
    angle: { kind: 'gain', param: `${atc}_ANG_${code}_P` },
    inputTc: target.axis === 'Yaw' ? tc.yaw : tc.rollPitch
  }
}

/** Name prefixes of a target's parameters, as upstream builds them for saving. */
export interface TargetPrefixes {
  /** `ATC_`, `Q_A_`, or empty on fixed wing (upstream `get_vehicle_atc_prefix`). */
  readonly atc: string
  /** `PILOT_`, `Q_PLT_`, or empty on fixed wing (upstream `get_vehicle_plt_prefix`). */
  readonly pilot: string
  /** Rate controller, e.g. `ATC_RAT_RLL_` (upstream `get_rate_param_prefix`). */
  readonly rate: string
  /** Angle controller, e.g. `ATC_ANG_RLL_` (upstream `get_angle_param_prefix`). */
  readonly angle: string
}

const PILOT_PREFIX: Readonly<Record<MultirotorVehicle, string>> = { copter: 'PILOT_', quadplane: 'Q_PLT_' }

export function targetPrefixes(target: TuneTarget): TargetPrefixes {
  if (target.vehicle === 'fixed-wing') {
    const code = FIXED_WING_AXIS_CODE[target.axis]
    return { atc: '', pilot: '', rate: `${code}_RATE_`, angle: `${code}2SRV_` }
  }
  const atc = `${ATC_PREFIX[target.vehicle]}_`
  const code = MULTIROTOR_AXIS_CODE[target.axis]
  return { atc, pilot: PILOT_PREFIX[target.vehicle], rate: `${atc}RAT_${code}_`, angle: `${atc}ANG_${code}_` }
}

/** Every target, for listing parameters. */
export const ALL_TARGETS: readonly TuneTarget[] = [
  ...TUNE_AXES.flatMap((axis): TuneTarget[] => [
    { vehicle: 'copter', axis },
    { vehicle: 'quadplane', axis }
  ]),
  { vehicle: 'fixed-wing', axis: 'Roll' },
  { vehicle: 'fixed-wing', axis: 'Pitch' }
]

// ---------- Every input, in upstream form order ----------

const controllerBlock = (target: TuneTarget): InputName[] => {
  const p = controllerParams(target)
  return [p.angle.param, ...RATE_GAIN_TERMS.map((t) => p.rate[t])]
}

const notchBlock = (target: TuneTarget): InputName[] => {
  const p = controllerParams(target)
  return RATE_NOTCH_TERMS.map((t) => p.rate[t])
}

const AXIS_ORDER: readonly TuneTarget[] = TUNE_AXES.flatMap((axis): TuneTarget[] => {
  const multirotor: TuneTarget[] = [
    { vehicle: 'copter', axis },
    { vehicle: 'quadplane', axis }
  ]
  return axis === 'Yaw' ? multirotor : [...multirotor, { vehicle: 'fixed-wing', axis }]
})

/** Every input in the order of upstream's form. */
export const INPUT_NAMES: readonly InputName[] = [
  'GyroSampleRate',
  'INS_GYRO_FILTER',
  ...NOTCH_PREFIXES.flatMap((p) => NOTCH_FIELDS.map((f) => notchParam(p, f))),
  'SCHED_LOOP_RATE',
  'ATC_INPUT_TC',
  'Q_A_INPUT_TC',
  'PILOT_Y_RATE_TC',
  'Q_PLT_Y_RATE_TC',
  ...AXIS_ORDER.flatMap(controllerBlock),
  ...AXIS_ORDER.flatMap(notchBlock),
  FIXED_WING_YAW_NOTCH.NTF,
  FIXED_WING_YAW_NOTCH.NEF,
  ...FILTER_INDICES.flatMap((i) => FILTER_FIELDS.map((f) => filterParam(i, f))),
  'Throttle',
  'NUM_MOTORS',
  'ESC_RPM',
  'RPM1',
  'RPM2'
]

const INPUT_NAME_SET: ReadonlySet<string> = new Set(INPUT_NAMES)

export function isInputName(name: string): name is InputName {
  return INPUT_NAME_SET.has(name)
}

/** Every ArduPilot parameter (inputs that are not operating-point values). */
export const PARAM_NAMES: readonly ParamName[] = INPUT_NAMES.filter((n): n is ParamName => !isSimInputName(n))

export function isSimInputName(name: InputName): name is SimInputName {
  return SIM_INPUT_NAMES.some((s) => s === name)
}

// ---------- Defaults and steps from upstream index.html ----------

/** Build a record with one entry per key. The single assertion is sound: every key is set. */
function recordOf<K extends string, V>(keys: readonly K[], make: (key: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map((k) => [k, make(k)])) as Record<K, V>
}

const RATE_DEFAULTS: Readonly<Record<RateTerm, number>> = {
  FF: 0,
  P: 0.288,
  I: 0.288,
  D: 0.0117,
  D_FF: 0,
  FLTT: 1.77,
  FLTE: 0,
  FLTD: 20,
  NTF: 0,
  NEF: 0
}

const RATE_STEPS: Readonly<Record<RateTerm, number>> = {
  FF: 0.01,
  P: 0.01,
  I: 0.01,
  D: 0.0001,
  D_FF: 0.0001,
  FLTT: 0.01,
  FLTE: 0.01,
  FLTD: 0.01,
  NTF: 1,
  NEF: 1
}

const NOTCH_DEFAULTS: Readonly<Record<NotchPrefix, Readonly<Record<NotchField, number>>>> = {
  INS_HNTCH: { ENABLE: 1, MODE: 1, FREQ: 150, BW: 75, ATT: 40, REF: 0.29, FM_RAT: 0, HMNCS: 3, OPTS: 0 },
  INS_HNTC2: { ENABLE: 0, MODE: 0, FREQ: 0, BW: 0, ATT: 0, REF: 0, FM_RAT: 0, HMNCS: 0, OPTS: 0 }
}

const NOTCH_STEPS: Readonly<Record<NotchField, number>> = {
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

const FILTER_DEFAULTS: Readonly<Record<FilterField, number>> = { TYPE: 0, NOTCH_FREQ: 0, NOTCH_Q: 2, NOTCH_ATT: 40 }
const FILTER_STEPS: Readonly<Record<FilterField, number>> = { TYPE: 1, NOTCH_FREQ: 1, NOTCH_Q: 0.1, NOTCH_ATT: 1 }

const OTHER_DEFAULTS = {
  GyroSampleRate: 2000,
  INS_GYRO_FILTER: 20,
  SCHED_LOOP_RATE: 400,
  ATC_INPUT_TC: 0.15,
  Q_A_INPUT_TC: 0.15,
  PILOT_Y_RATE_TC: 0,
  Q_PLT_Y_RATE_TC: 0,
  Throttle: 0.3,
  NUM_MOTORS: 1,
  ESC_RPM: 2500,
  RPM1: 2500,
  RPM2: 2500
} as const satisfies Partial<Record<InputName, number>>

const OTHER_STEPS = {
  GyroSampleRate: 1,
  INS_GYRO_FILTER: 0.1,
  SCHED_LOOP_RATE: 1,
  ATC_INPUT_TC: 0.01,
  Q_A_INPUT_TC: 0.01,
  PILOT_Y_RATE_TC: 0.01,
  Q_PLT_Y_RATE_TC: 0.01,
  Throttle: 0.01,
  NUM_MOTORS: 1,
  ESC_RPM: 1,
  RPM1: 1,
  RPM2: 1
} as const satisfies Record<keyof typeof OTHER_DEFAULTS, number>

type OtherInput = keyof typeof OTHER_DEFAULTS

function isOtherInput(name: InputName): name is OtherInput {
  return name in OTHER_DEFAULTS
}

/** Which family an input belongs to, with the parts of its name. */
export type InputKind =
  | { readonly kind: 'other'; readonly name: OtherInput }
  | { readonly kind: 'notch'; readonly prefix: NotchPrefix; readonly field: NotchField }
  | { readonly kind: 'filter'; readonly index: FilterIndex; readonly field: FilterField }
  | { readonly kind: 'rate'; readonly term: RateTerm }
  | { readonly kind: 'angle'; readonly control: ControllerParams['angle']['kind'] }

const RATE_TERM_BY_PARAM = new Map<InputName, RateTerm>()
const ANGLE_KIND_BY_PARAM = new Map<InputName, ControllerParams['angle']['kind']>()
for (const target of ALL_TARGETS) {
  const p = controllerParams(target)
  for (const term of [...RATE_GAIN_TERMS, ...RATE_NOTCH_TERMS]) RATE_TERM_BY_PARAM.set(p.rate[term], term)
  ANGLE_KIND_BY_PARAM.set(p.angle.param, p.angle.kind)
}
for (const term of RATE_NOTCH_TERMS) RATE_TERM_BY_PARAM.set(FIXED_WING_YAW_NOTCH[term], term)

/** Classify an input by name. */
export function inputKind(name: InputName): InputKind {
  if (isOtherInput(name)) return { kind: 'other', name }
  for (const prefix of NOTCH_PREFIXES) {
    for (const field of NOTCH_FIELDS) if (notchParam(prefix, field) === name) return { kind: 'notch', prefix, field }
  }
  for (const index of FILTER_INDICES) {
    for (const field of FILTER_FIELDS) if (filterParam(index, field) === name) return { kind: 'filter', index, field }
  }
  const term = RATE_TERM_BY_PARAM.get(name)
  if (term !== undefined) return { kind: 'rate', term }
  const control = ANGLE_KIND_BY_PARAM.get(name)
  if (control !== undefined) return { kind: 'angle', control }
  throw new Error(`Unknown input ${name}`)
}

/** Upstream angle defaults: P gains 4.5, roll time constant 0.25 s, pitch 0.5 s. */
function angleDefault(name: InputName): number {
  if (name === 'RLL2SRV_TCONST') return 0.25
  if (name === 'PTCH2SRV_TCONST') return 0.5
  return 4.5
}

function defaultFor(name: InputName): number {
  const k = inputKind(name)
  switch (k.kind) {
    case 'other':
      return OTHER_DEFAULTS[k.name]
    case 'notch':
      return NOTCH_DEFAULTS[k.prefix][k.field]
    case 'filter':
      return FILTER_DEFAULTS[k.field]
    case 'rate':
      return RATE_DEFAULTS[k.term]
    case 'angle':
      return angleDefault(name)
  }
}

function stepFor(name: InputName): number {
  const k = inputKind(name)
  switch (k.kind) {
    case 'other':
      return OTHER_STEPS[k.name]
    case 'notch':
      return NOTCH_STEPS[k.field]
    case 'filter':
      return FILTER_STEPS[k.field]
    case 'rate':
      return RATE_STEPS[k.term]
    case 'angle':
      return k.control === 'gain' ? 0.1 : 0.01
  }
}

/** Defaults from upstream `index.html`. */
export const DEFAULT_INPUTS: Inputs = recordOf(INPUT_NAMES, defaultFor)

/** Input steps from upstream `index.html`. */
export const INPUT_STEPS: Readonly<Record<InputName, number>> = recordOf(INPUT_NAMES, stepFor)

/** Return `inputs` with the given values applied. */
export function withInputs(inputs: Inputs, values: ReadonlyMap<InputName, number>): Inputs {
  if (values.size === 0) return inputs
  const next: Record<InputName, number> = { ...inputs }
  for (const [name, value] of values) next[name] = value
  return next
}
