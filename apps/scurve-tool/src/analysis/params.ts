/**
 * The ArduPilot parameters the S-curve simulation takes, with the metadata upstream reads from
 * `SCurveTool/params.json` (display name, units, range, increment, description).
 *
 * Upstream: the `ATC_`, `PSC` and `WP_` inputs of `SCurveTool/index.html`, laid out by
 * `load_param_inputs` in `Libraries/ParameterMetadata.js`.
 */

/** The three parameter groups upstream shows, in its order. */
export type ParamGroup = 'attitude' | 'position' | 'waypoint'

export const PARAM_GROUPS = [
  { group: 'attitude', label: 'Attitude control' },
  { group: 'position', label: 'Position control' },
  { group: 'waypoint', label: 'Waypoint navigation' }
] as const satisfies readonly { group: ParamGroup; label: string }[]

interface ParamCommon {
  readonly name: string
  readonly group: ParamGroup
  readonly displayName: string
  readonly description: string
  readonly defaultValue: number
}

/** A free numeric parameter, entered in a number field. */
export interface NumberParam extends ParamCommon {
  readonly kind: 'number'
  readonly units?: string
  readonly range?: readonly [low: number, high: number]
  readonly increment?: number
}

/** A parameter with named values, picked from a list. */
export interface EnumParam extends ParamCommon {
  readonly kind: 'enum'
  readonly values: readonly { readonly value: number; readonly label: string }[]
}

export type ParamSpec = NumberParam | EnumParam

/**
 * Upstream marks the attitude limits `data-paramValues="false"`, so they stay number fields even
 * though their metadata lists named values; only `ATC_RATE_FF_ENAB` becomes a picker.
 */
export const PARAMS = [
  {
    name: 'ATC_RATE_R_MAX',
    group: 'attitude',
    kind: 'number',
    displayName: 'Angular Velocity Max for Roll',
    description: 'Maximum angular velocity in roll axis',
    units: 'deg/s',
    range: [0, 1080],
    increment: 1,
    defaultValue: 0
  },
  {
    name: 'ATC_RATE_P_MAX',
    group: 'attitude',
    kind: 'number',
    displayName: 'Angular Velocity Max for Pitch',
    description: 'Maximum angular velocity in pitch axis',
    units: 'deg/s',
    range: [0, 1080],
    increment: 1,
    defaultValue: 0
  },
  {
    name: 'ATC_ACC_R_MAX',
    group: 'attitude',
    kind: 'number',
    displayName: 'Acceleration Max for Roll',
    description: 'Maximum acceleration in roll axis',
    units: 'deg/s/s',
    range: [0, 1800],
    increment: 10,
    defaultValue: 1100
  },
  {
    name: 'ATC_ACC_P_MAX',
    group: 'attitude',
    kind: 'number',
    displayName: 'Acceleration Max for Pitch',
    description: 'Maximum acceleration in pitch axis',
    units: 'deg/s/s',
    range: [0, 1800],
    increment: 10,
    defaultValue: 1100
  },
  {
    name: 'ATC_INPUT_TC',
    group: 'attitude',
    kind: 'number',
    displayName: 'Attitude control input time constant',
    description: 'Attitude control input time constant. Low numbers lead to sharper response, higher numbers to softer response',
    units: 's',
    range: [0, 1],
    increment: 0.01,
    defaultValue: 0.15
  },
  {
    name: 'ATC_RATE_FF_ENAB',
    group: 'attitude',
    kind: 'enum',
    displayName: 'Rate Feedforward Enable',
    description: 'Controls whether body-frame rate feedforward is enabled or disabled',
    values: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: 'Enabled' }
    ],
    defaultValue: 1
  },
  {
    name: 'PSC_JERK_NE',
    group: 'position',
    kind: 'number',
    displayName: 'Jerk limit for the horizontal kinematic input shaping',
    description:
      'Jerk limit of the horizontal kinematic path generation used to determine how quickly the aircraft varies the acceleration target',
    units: 'm/s/s/s',
    range: [1, 50],
    increment: 1,
    defaultValue: 5
  },
  {
    name: 'PSC_JERK_D',
    group: 'position',
    kind: 'number',
    displayName: 'Jerk limit for the vertical kinematic input shaping',
    description:
      'Jerk limit of the vertical kinematic path generation used to determine how quickly the aircraft varies the acceleration target',
    units: 'm/s/s/s',
    range: [1, 50],
    increment: 1,
    defaultValue: 5
  },
  {
    name: 'PSC_NE_POS_P',
    group: 'position',
    kind: 'number',
    displayName: 'Position (horizontal) controller P gain',
    description:
      'Position controller P gain. Converts the distance (in the latitude direction) to the target location into a desired speed which is then passed to the loiter latitude rate controller.',
    range: [0.5, 4],
    increment: 0.01,
    defaultValue: 1
  },
  {
    name: 'PSC_D_ACC_FLTT',
    group: 'position',
    kind: 'number',
    displayName: 'Acceleration (vertical) controller target frequency in Hz',
    description: 'Acceleration (vertical) controller target frequency in Hz.',
    units: 'Hz',
    range: [1, 50],
    increment: 1,
    defaultValue: 0
  },
  {
    name: 'PSC_D_ACC_FLTE',
    group: 'position',
    kind: 'number',
    displayName: 'Acceleration (vertical) controller error frequency in Hz',
    description: 'Acceleration (vertical) controller error frequency in Hz.',
    units: 'Hz',
    range: [1, 100],
    increment: 1,
    defaultValue: 20
  },
  {
    name: 'WP_JERK',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Jerk',
    description: 'Defines the horizontal jerk in m/s/s used during missions',
    units: 'm/s/s/s',
    range: [1, 20],
    defaultValue: 1
  },
  {
    name: 'WP_ACC_Z',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Vertical Acceleration',
    description: 'Vertical acceleration in m/s/s used during missions',
    units: 'm/s/s',
    range: [0.5, 5],
    increment: 0.1,
    defaultValue: 1
  },
  {
    name: 'WP_ACC',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Acceleration',
    description: 'Horizontal acceleration in m/s/s used during missions',
    units: 'm/s/s',
    range: [0.5, 5],
    increment: 0.1,
    defaultValue: 2.5
  },
  {
    name: 'WP_ACC_CNR',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Cornering Acceleration',
    description: 'Maximum cornering acceleration in m/s/s used during missions. If zero uses 2x accel value.',
    units: 'm/s/s',
    range: [0, 5],
    increment: 0.1,
    defaultValue: 0
  },
  {
    name: 'WP_SPD',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Horizontal Speed Target',
    description: 'Speed in m/s which the aircraft will attempt to maintain horizontally during a WP mission',
    units: 'm/s',
    range: [0.1, 20],
    increment: 0.1,
    defaultValue: 10
  },
  {
    name: 'WP_SPD_UP',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Climb Speed Target',
    description: 'Speed in m/s which the aircraft will attempt to maintain while climbing during a WP mission',
    units: 'm/s',
    range: [0.1, 10],
    increment: 0.1,
    defaultValue: 2.5
  },
  {
    name: 'WP_SPD_DN',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Descent Speed Target',
    description: 'Speed in m/s which the aircraft will attempt to maintain while descending during a WP mission',
    units: 'm/s',
    range: [0.1, 10],
    increment: 0.1,
    defaultValue: 1.5
  },
  {
    name: 'WP_RADIUS_M',
    group: 'waypoint',
    kind: 'number',
    displayName: 'Waypoint Radius',
    description: 'Distance from a waypoint, that when crossed indicates the wp has been reached.',
    units: 'm',
    range: [0.05, 10],
    increment: 0.01,
    defaultValue: 50
  }
] as const satisfies readonly ParamSpec[]

export type ParamName = (typeof PARAMS)[number]['name']

/** A parameter spec known to be one of `PARAMS`. */
export type Param = ParamSpec & { readonly name: ParamName }

/** A value for every parameter. */
export type ParamValues = Readonly<Record<ParamName, number>>

/** The values upstream's inputs start with. */
export const DEFAULT_PARAMS: ParamValues = Object.fromEntries(PARAMS.map((p) => [p.name, p.defaultValue])) as Record<
  ParamName,
  number
>

/** The parameters of one group, in upstream order. */
export function paramsInGroup(group: ParamGroup): readonly Param[] {
  return PARAMS.filter((p) => p.group === group)
}

/** Range and increment as a tooltip line, e.g. "Range 0.5 to 5, step 0.1". */
export function rangeHint(spec: ParamSpec): string | null {
  if (spec.kind === 'enum') return null
  const parts: string[] = []
  if (spec.range) parts.push(`Range ${spec.range[0]} to ${spec.range[1]}`)
  if (spec.increment !== undefined) parts.push(`step ${spec.increment}`)
  return parts.length > 0 ? parts.join(', ') : null
}
