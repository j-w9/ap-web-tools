/**
 * Saving and loading `.param` files, and reading settings from the page URL. Ported from upstream
 * `save_parameters`, `load_parameters` and `load`.
 */
import { paramToString, parseParamFile } from '@apwt/ardupilot'
import { PARAM_METADATA } from './metadata.js'
import type { ControlLoop, DisplaySettings } from './display.js'
import {
  INPUT_NAMES,
  controllerParams,
  isInputName,
  isSimInputName,
  targetPrefixes,
  type InputName,
  type Inputs,
  type TuneTarget
} from './params.js'

/** Upstream shows enumerated parameters as drop-downs, which its save collects after the number inputs. */
function isDropDown(name: InputName): boolean {
  return !isSimInputName(name) && PARAM_METADATA[name].kind === 'values'
}

/**
 * The inputs upstream saves for the target, in upstream's order: input shaping (roll and pitch
 * `INPUT_` or yaw pilot rate), the rate and angle controllers, the `FILTn_` notches the rate
 * controller selects, every `INS_` and `SCHED_` parameter.
 */
export function savedParamNames(inputs: Inputs, target: TuneTarget): InputName[] {
  const prefix = targetPrefixes(target)
  const rate = controllerParams(target).rate
  const nef = inputs[rate.NEF]
  const ntf = inputs[rate.NTF]
  const rollPitch = target.axis === 'Roll' || target.axis === 'Pitch'

  const select = (name: InputName): InputName[] => {
    const out: InputName[] = []
    if (name.startsWith(prefix.atc + 'INPUT_') && rollPitch) out.push(name)
    if (name.startsWith(prefix.pilot) && target.axis === 'Yaw') out.push(name)
    if (name.startsWith(prefix.rate)) out.push(name)
    if (name.startsWith(prefix.angle)) out.push(name)
    if (nef > 0 && name.startsWith(`FILT${nef}_`)) out.push(name)
    if (ntf > 0 && nef !== ntf && name.startsWith(`FILT${ntf}_`)) out.push(name)
    if (name.startsWith('INS_')) out.push(name)
    if (name.startsWith('SCHED_')) out.push(name)
    return out
  }
  return [...INPUT_NAMES.filter((n) => !isDropDown(n)), ...INPUT_NAMES.filter(isDropDown)].flatMap(select)
}

/** `.param` text for the target (upstream `save_parameters`, saved as `filter.param`). */
export function saveParamText(inputs: Inputs, target: TuneTarget): string {
  return savedParamNames(inputs, target)
    .map((name) => name + ',' + paramToString(inputs[name]) + '\n')
    .join('')
}

/** Inputs set by a `.param` file, and how many of its parameters the tool does not model. */
export interface LoadedParamFile {
  readonly values: ReadonlyMap<InputName, number>
  readonly ignored: number
}

/**
 * Read a `.param` file; parameters the tool models are applied, others ignored.
 *
 * Deviation: upstream sets any page input whose id matches, including non-numeric junk values;
 * here only modelled inputs with numeric values are taken, using the shared parser.
 */
export function loadParamText(text: string): LoadedParamFile {
  const values = new Map<InputName, number>()
  let ignored = 0
  for (const entry of parseParamFile(text).entries) {
    if (isInputName(entry.name)) values.set(entry.name, entry.value)
    else ignored++
  }
  return { values, ignored }
}

// ---------- URL ----------

/** Upstream radio values of each graph setting, lower case. */
const LOOP_VALUES: Readonly<Record<string, ControlLoop>> = {
  bare_ac: 'bare-aircraft',
  rate_ctrlr: 'rate',
  att_ctrlr: 'attitude-feedforward',
  att_ctrlr_nff: 'attitude-no-feedforward',
  pilot_ctrlr: 'input-shaping',
  att_drb: 'disturbance-rejection',
  rate_stab: 'rate-stability',
  att_stab: 'attitude-stability',
  sys_stab: 'system-stability'
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/** Settings given in the page URL. */
export interface UrlSettings {
  readonly inputs: ReadonlyMap<InputName, number>
  readonly display: Partial<DisplaySettings>
}

/**
 * Inputs and graph settings from URL query parameters (upstream `load`): names are matched
 * ignoring case, numbers with `parseFloat`, radios by value and the attitude checkbox by `true`.
 */
export function urlSettings(href: string): UrlSettings {
  const inputs = new Map<InputName, number>()
  const display: Mutable<Partial<DisplaySettings>> = {}
  const url = href.toLowerCase()
  if (!url.includes('?')) return { inputs, display }
  const params = new URL(url).searchParams

  for (const name of INPUT_NAMES) {
    const text = params.get(name.toLowerCase())
    if (text === null) continue
    const value = parseFloat(text)
    if (!Number.isNaN(value)) inputs.set(name, value)
  }

  const loopText = params.get('control_loop')
  const loop = loopText === null ? undefined : LOOP_VALUES[loopText]
  if (loop !== undefined) display.loop = loop
  const gain = params.get('pid_scale')
  if (gain === 'log') display.gain = 'dB'
  if (gain === 'linear') display.gain = 'linear'
  const phase = params.get('pid_phasescale')
  if (phase === 'unwrap') display.phase = 'unwrapped'
  if (phase === 'wrap') display.phase = 'wrapped'
  const freqScale = params.get('pid_feq_scale')
  if (freqScale === 'log') display.frequencyAxis = 'log'
  if (freqScale === 'linear') display.frequencyAxis = 'linear'
  const unit = params.get('pid_feq_unit')
  if (unit === 'hz') display.frequencyUnit = 'Hz'
  if (unit === 'rps') display.frequencyUnit = 'rad/s'
  const useAttitude = params.get('useattitude')
  if (useAttitude !== null) display.useAttitude = useAttitude === 'true'
  return { inputs, display }
}
