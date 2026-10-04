// Oracle tests against the upstream page functions (see test-utils/page.ts): plots, saved
// file, loaded file, share links and which inputs are shown or greyed out.
import { describe, expect, it } from 'vitest'
import type { Layout, PlotData } from '@apwt/plot'
import { gyroPlot, pidPlot, type BodePlot } from '../ui/traces.js'
import { gyroBode, pidBode } from './bode.js'
import { notchInputsEnabled, trackingSourcesShown } from './config.js'
import { formatParamFile, parseParamFile } from './param-file.js'
import {
  DEFAULT_INPUTS,
  INPUT_NAMES,
  NOTCH_FIELDS,
  NOTCH_PREFIXES,
  PID_AXES,
  notchParam,
  type InputName,
  type Inputs,
  type PidAxis
} from './params.js'
import { DEFAULT_STATE, stateFromQuery, stateToQuery, type BodeSettings, type PidSettings, type ToolState } from './settings.js'
import { attempt } from './validate.js'
import { isSelectField } from './fields.js'
import { PARAM_METADATA } from './metadata.js'
import { randomInputs } from './test-utils/inputs.js'
import { provenChainedSpreadCase } from './test-utils/chained-spread.js'
import { loadUpstreamPage, type UpstreamPage } from './test-utils/page.js'
import { rng } from './test-utils/random.js'

const AXIS_BUTTONS: Readonly<Record<PidAxis, string>> = { RLL: 'CalculateRoll', PIT: 'CalculatePitch', YAW: 'CalculateYaw' }
const AXIS_TITLES: Readonly<Record<PidAxis, string>> = { RLL: 'Roll axis', PIT: 'Pitch axis', YAW: 'Yaw axis' }

// The page is loaded with the proven chained harmonic-notch spread bug fixed
// (docs/bug-proofs/filters.md, row 2); outside that case it is the original page (see bode.test.ts).
function freshPage(href?: string): UpstreamPage {
  const page = loadUpstreamPage({ fixChainedSpread: true })
  if (href !== undefined) page.setHref(href)
  page.call('load')
  return page
}

function setInputs(page: UpstreamPage, inputs: Inputs): void {
  for (const name of INPUT_NAMES) page.el(name).value = String(inputs[name])
}

function readInputs(page: UpstreamPage): Record<InputName, number> {
  return Object.fromEntries(INPUT_NAMES.map((n) => [n, page.read(n)])) as Record<InputName, number>
}

function setBodeRadios(page: UpstreamPage, p: '' | 'PID_', s: BodeSettings): void {
  page.el(s.magnitude === 'dB' ? `${p}ScaleLog` : `${p}ScaleLinear`).checked = true
  page.el(s.phase === 'unwrapped' ? `${p}ScaleUnWrap` : `${p}ScaleWrap`).checked = true
  page.el(s.frequencyAxis === 'log' ? `${p}freq_ScaleLog` : `${p}freq_ScaleLinear`).checked = true
  page.el(s.frequencyUnit === 'Hz' ? `${p}freq_Scale_Hz` : `${p}freq_Scale_RPM`).checked = true
  page.el(`${p}ShowComponents`).checked = s.showComponents
}

function readBodeRadios(page: UpstreamPage, p: '' | 'PID_'): BodeSettings {
  return {
    magnitude: page.el(`${p}ScaleLog`).checked ? 'dB' : 'linear',
    phase: page.el(`${p}ScaleUnWrap`).checked ? 'unwrapped' : 'wrapped',
    frequencyAxis: page.el(`${p}freq_ScaleLog`).checked ? 'log' : 'linear',
    frequencyUnit: page.el(`${p}freq_Scale_RPM`).checked ? 'RPM' : 'Hz',
    showComponents: page.el(`${p}ShowComponents`).checked
  }
}

interface UpstreamPlot {
  data: Record<string, unknown>[]
  layout: {
    xaxis: { type: string }
    xaxis2: { type: string; title: { text: string } }
    yaxis: { title: { text: string } }
    yaxis2: { range?: number[]; autorange: boolean; fixedrange: boolean }
    showlegend: boolean
  }
}

const list = (v: unknown) => Array.from(v as ArrayLike<number>)

function expectSamePlot(up: UpstreamPlot, port: BodePlot): void {
  expect(port.data).toHaveLength(up.data.length)
  up.data.forEach((u, k) => {
    const p: Partial<PlotData> = port.data[k]!
    const visible = (u.visible as boolean | undefined) ?? true
    expect(p.visible, `trace ${k} visible`).toBe(visible)
    expect([p.name, p.meta, p.showlegend, p.xaxis, p.yaxis]).toEqual([u.name, u.meta, u.showlegend, u.xaxis, u.yaxis])
    expect(p.line?.color).toBe((u.line as { color: string }).color)
    if (!visible) return
    expect(p.hovertemplate).toBe(u.hovertemplate)
    expect(list(p.x)).toEqual(list(u.x))
    // Upstream's unwrap of an empty phase array returns [undefined]; with no x there is nothing to plot either way.
    if (list(u.x).length === 0) expect(list(p.y)).toEqual([])
    else expect(list(p.y)).toEqual(list(u.y))
  })
  const l: Partial<Layout> = port.layout
  expect(l.xaxis?.type).toBe(up.layout.xaxis.type)
  expect(l.xaxis2?.type).toBe(up.layout.xaxis2.type)
  expect(l.xaxis2?.title).toEqual({ text: up.layout.xaxis2.title.text })
  expect(l.yaxis?.title).toEqual({ text: up.layout.yaxis.title.text })
  expect(l.showlegend).toBe(up.layout.showlegend)
  expect(l.yaxis2?.autorange).toBe(up.layout.yaxis2.autorange)
  expect(l.yaxis2?.fixedrange).toBe(up.layout.yaxis2.fixedrange)
  if (!up.layout.yaxis2.autorange) expect(l.yaxis2?.range).toEqual(up.layout.yaxis2.range)
}

function randomSettings(next: () => number): BodeSettings {
  const coin = () => next() < 0.5
  return {
    magnitude: coin() ? 'dB' : 'linear',
    phase: coin() ? 'unwrapped' : 'wrapped',
    frequencyAxis: coin() ? 'log' : 'linear',
    frequencyUnit: coin() ? 'Hz' : 'RPM',
    showComponents: next() < 0.7
  }
}

describe('plots match upstream calculate_filter and calculate_pid', () => {
  const next = rng(1234)
  const cases: Inputs[] = [
    DEFAULT_INPUTS,
    // More than one filter enabled, so components can show.
    { ...DEFAULT_INPUTS, INS_HNTCH_ENABLE: 1, INS_HNTCH_FREQ: 80, INS_HNTCH_BW: 40, INS_HNTCH_ATT: 40, INS_HNTCH_HMNCS: 3 },
    // Empty (NaN) fields are calculated with, as upstream reads them.
    { ...DEFAULT_INPUTS, INS_HNTCH_ENABLE: NaN, INS_HNTCH_FREQ: 80, INS_HNTCH_BW: 40, INS_HNTCH_HMNCS: 1, INS_GYRO_FILTER: NaN },
    { ...DEFAULT_INPUTS, ATC_RAT_RLL_P: NaN, ATC_RAT_PIT_FLTD: NaN },
    // A gyro rate of 0 plots nothing.
    { ...DEFAULT_INPUTS, GyroSampleRate: 0 },
    ...Array.from({ length: 10 }, () => randomInputs(next))
  ]
  cases.forEach((inputs, n) => {
    it(`case ${n}`, () => {
      const page = freshPage()
      setInputs(page, inputs)
      // The original page differs from the patched one only in the proven chained-spread case.
      const original = loadUpstreamPage()
      setInputs(original, inputs)
      const centres = (p: UpstreamPage) =>
        JSON.stringify(
          (p.call('get_filters', inputs.GyroSampleRate) as { notches?: { center_freq_hz: number }[] }[]).map((f) =>
            (f.notches ?? []).map((x) => x.center_freq_hz)
          )
        )
      if (centres(original) !== centres(page)) expect(provenChainedSpreadCase(inputs, inputs.GyroSampleRate)).toBe(true)
      const gyroSettings = randomSettings(next)
      setBodeRadios(page, '', gyroSettings)
      page.call('calculate_filter')
      expectSamePlot(page.context.Bode as UpstreamPlot, gyroPlot(gyroBode(inputs, gyroSettings), gyroSettings))

      for (const axis of PID_AXES) {
        for (const filtering of ['pre', 'post'] as const) {
          const s: PidSettings = { ...randomSettings(next), filtering, axis }
          setBodeRadios(page, 'PID_', s)
          page.el(filtering === 'pre' ? 'PID_filtering_Pre' : 'PID_filtering_Post').checked = true
          page.call('calculate_pid', AXIS_BUTTONS[axis])
          expect(page.el('PID_title').innerHTML).toBe(AXIS_TITLES[axis])
          expectSamePlot(page.context.BodePID as UpstreamPlot, pidPlot(pidBode(inputs, axis, filtering, s), s))
        }
      }
    })
  })

  it('PID with post filtering fails when the gyro rate is empty, as upstream', () => {
    const inputs = { ...DEFAULT_INPUTS, GyroSampleRate: NaN }
    const page = freshPage()
    setInputs(page, inputs)
    page.el('PID_filtering_Post').checked = true
    expect(() => page.call('calculate_pid', 'CalculateRoll')).toThrow(/error is not defined/)
    expect(attempt(() => pidBode(inputs, 'RLL', 'post', DEFAULT_STATE.pid)).ok).toBe(false)
    // With pre filtering the gyro rate is not used.
    page.el('PID_filtering_Pre').checked = true
    expect(() => page.call('calculate_pid', 'CalculateRoll')).not.toThrow()
    expect(attempt(() => pidBode(inputs, 'RLL', 'pre', DEFAULT_STATE.pid)).ok).toBe(true)
  })

  it.each([NaN, -10, -0.2, -1e-3])('a gyro rate of %d fails where upstream throws', (rate) => {
    const inputs = { ...DEFAULT_INPUTS, GyroSampleRate: rate }
    const page = freshPage()
    setInputs(page, inputs)
    // -1e-3 gives an empty grid upstream (length 0) and in the port.
    const upstreamThrows = (() => {
      try {
        page.call('calculate_filter')
        return false
      } catch {
        return true
      }
    })()
    expect(attempt(() => gyroBode(inputs, DEFAULT_STATE.gyro)).ok).toBe(!upstreamThrows)
  })

  it.each([NaN, -50])('a loop rate of %d fails where upstream throws', (rate) => {
    const inputs = { ...DEFAULT_INPUTS, SCHED_LOOP_RATE: rate }
    const page = freshPage()
    setInputs(page, inputs)
    expect(() => page.call('calculate_pid')).toThrow(/Invalid array length/)
    expect(attempt(() => pidBode(inputs, 'RLL', 'pre', DEFAULT_STATE.pid)).ok).toBe(false)
  })
})

describe('saved file matches upstream save_parameters', () => {
  const next = rng(99)
  const cases: Inputs[] = [
    DEFAULT_INPUTS,
    {
      ...DEFAULT_INPUTS,
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_MODE: 3,
      INS_HNTCH_FREQ: 82.123456789,
      INS_HNTC2_BW: NaN,
      INS_HNTCH_REF: 0.1
    },
    { ...DEFAULT_INPUTS, INS_HNTCH_ENABLE: NaN, INS_HNTC2_MODE: NaN, INS_GYRO_FILTER: 1e-7, INS_HNTCH_OPTS: -1 },
    ...Array.from({ length: 6 }, () => randomInputs(next))
  ]
  cases.forEach((inputs, n) => {
    it(`case ${n}`, () => {
      const page = freshPage()
      page.finishMetadata()
      setInputs(page, inputs)
      page.call('save_parameters')
      // The port saves what the page's controls hold.
      expect(page.saved).toEqual([{ name: 'filter.param', text: formatParamFile(readInputs(page)) }])
    })
  })
})

describe('loaded file matches upstream load_parameters', () => {
  const files = [
    ['INS_HNTCH_ENABLE,1', 'INS_HNTCH_MODE,1', 'INS_HNTCH_FREQ,82.5', 'INS_GYRO_FILTER=40', 'ATC_RAT_RLL_P\t0.2'].join('\n'),
    // MAVProxy's format: upstream's selects get no matching option and read as NaN (proven bug, fixed).
    ['INS_HNTCH_ENABLE       1.000000', 'INS_HNTCH_MODE         3.000000', 'INS_HNTCH_FREQ         80.000000'].join('\n'),
    // CRLF, indentation, empty values, invalid number text, comments, Q_A_RAT_, operating-point inputs.
    [
      'INS_HNTC2_ENABLE,1\r',
      '  INS_HNTC2_FREQ,90',
      'INS_HNTC2_BW,',
      'INS_HNTC2_ATT,5.',
      'INS_HNTC2_REF,+1',
      'INS_HNTC2_HMNCS,1e2',
      '# INS_HNTC2_OPTS,2',
      'Q_A_RAT_PIT_D,0.004',
      'GyroSampleRate,1000',
      'Throttle,0.45',
      'RPM1 3000',
      'INS_HNTC2_MODE,4',
      'SCHED_LOOP_RATE,333',
      'GPS_TYPE,1',
      'INS_HNTC2_FM_RAT,Infinity',
      'INS_HNTCH_ATT,.5',
      'INS_HNTCH_ATT,-2.5e-1',
      ''
    ].join('\n'),
    'INS_HNTCH_ENABLE,2\nINS_HNTC2_MODE,6\nINS_HNTCH_MODE,-0\n'
  ]
  files.forEach((text, n) => {
    it(`file ${n}`, async () => {
      const page = freshPage()
      page.finishMetadata()
      expect(readInputs(page)).toEqual(DEFAULT_INPUTS)
      page.context.update_all_hidden = () => undefined
      page.context.calculate_filter = () => undefined
      await (page.call('load_parameters', { text: () => Promise.resolve(text) }) as Promise<void>)
      const { expected, fixed } = withProvenSelectFix(text, readInputs(page))
      expect({ ...DEFAULT_INPUTS, ...parseParamFile(text) }).toEqual(expected)
      // Files 1 and 3 hold drop-down values written as numbers (`1.000000`, `-0`).
      expect(fixed.length > 0).toBe(n === 1 || n === 3)
    })
  })
})

/**
 * Upstream's inputs after a file load, with the proven drop-down bug fixed
 * (docs/bug-proofs/filter-tool.md, row 2): where upstream's drop-down read NaN because the file's
 * value is a number equal to an option but written differently (`1.000000`), the fixed value is that
 * option. Every other input is upstream's value unchanged.
 */
function withProvenSelectFix(
  text: string,
  upstream: Record<InputName, number>
): { expected: Record<InputName, number>; fixed: string[] } {
  const expected = { ...upstream }
  const fixed: string[] = []
  const last = new Map<string, string>()
  for (const line of text.split('\n')) {
    const v = line.split(/[\s,=\t]+/)
    if (v.length >= 2) last.set(v[0]!, v[1]!)
  }
  for (const name of INPUT_NAMES) {
    const value = last.get(name)
    if (!isSelectField(name) || value === undefined || !Number.isNaN(upstream[name])) continue
    const meta = PARAM_METADATA[name]
    const option = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value) ? String(parseFloat(value)) : ''
    if (meta.kind === 'values' && meta.values.some((o) => String(o.value) === option)) {
      expected[name] = parseFloat(option)
      fixed.push(name)
    }
  }
  return { expected, fixed }
}

describe('share links match upstream load and get_link', () => {
  function pageState(page: UpstreamPage, axis: PidAxis): ToolState {
    return {
      inputs: readInputs(page),
      gyro: readBodeRadios(page, ''),
      pid: { ...readBodeRadios(page, 'PID_'), filtering: page.el('PID_filtering_Post').checked ? 'post' : 'pre', axis }
    }
  }

  const next = rng(5)
  const states: ToolState[] = Array.from({ length: 6 }, () => ({
    inputs: randomInputs(next),
    gyro: randomSettings(next),
    pid: { ...randomSettings(next), filtering: next() < 0.5 ? 'pre' : 'post', axis: 'RLL' }
  }))

  states.forEach((state, n) => {
    it(`port link ${n} opens the same in upstream`, () => {
      const query = stateToQuery(state)
      const page = freshPage(`https://example.org/FilterTool/?${query}`)
      page.finishMetadata()
      expect(stateFromQuery(query)).toEqual(pageState(page, 'RLL'))
    })

    it(`upstream link ${n} opens the same in the port`, () => {
      const source = freshPage()
      setInputs(source, state.inputs)
      setBodeRadios(source, '', state.gyro)
      setBodeRadios(source, 'PID_', state.pid)
      source.el(state.pid.filtering === 'pre' ? 'PID_filtering_Pre' : 'PID_filtering_Post').checked = true
      source.call('get_link')
      const link = source.clipboard[0]!
      const page = freshPage(link)
      page.finishMetadata()
      expect(stateFromQuery(new URL(link).search)).toEqual(pageState(page, 'RLL'))
    })
  })

  it.each([
    'INS_HNTCH_MODE=1.5&INS_HNTCH_ENABLE=1&Throttle=Infinity&GyroSampleRate=abc&RPM1=1e3',
    'scale=LINEAR&PhaseScale=Wrap&ShowComponents=1&PID_ShowComponents=TRUE&filtering=POST&feq_unit=rpm',
    'ins_hntc2_enable=0.5&INS_HNTC2_MODE=2&ATC_RAT_YAW_P=-1&SCHED_LOOP_RATE=12.5'
  ])('%s', (query) => {
    const page = freshPage(`https://example.org/FilterTool/?${query}`)
    page.finishMetadata()
    expect(stateFromQuery(`?${query}`)).toEqual(pageState(page, 'RLL'))
  })
})

describe('visibility matches upstream update_all_hidden', () => {
  const next = rng(77)
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!
  const cases = Array.from({ length: 40 }, (): Inputs => {
    const inputs: Record<InputName, number> = { ...DEFAULT_INPUTS }
    for (const prefix of NOTCH_PREFIXES) {
      inputs[notchParam(prefix, 'ENABLE')] = pick([0, 1, 2, 0.5, -1, NaN])
      inputs[notchParam(prefix, 'MODE')] = pick([0, 1, 1.5, 2, 2.9, 3, 4, 5, 5.5, 6, -1, NaN])
    }
    return inputs
  })
  cases.forEach((inputs, n) => {
    it(`case ${n}`, () => {
      const page = freshPage()
      setInputs(page, inputs)
      page.call('update_all_hidden')
      const shown = trackingSourcesShown(inputs)
      expect(page.el('Throttle_input').hidden).toBe(!shown.has('throttle'))
      expect(page.el('ESC_input').hidden).toBe(!shown.has('esc'))
      expect(page.el('RPM_input').hidden).toBe(!shown.has('rpm'))
      for (const prefix of NOTCH_PREFIXES) {
        for (const field of NOTCH_FIELDS) {
          if (field === 'ENABLE') continue
          expect(page.el(notchParam(prefix, field)).disabled).toBe(!notchInputsEnabled(inputs, prefix))
        }
      }
    })
  })
})

describe('page defaults', () => {
  it('match upstream index.html', () => {
    const page = freshPage()
    expect(readInputs(page)).toEqual(DEFAULT_INPUTS)
    expect(readBodeRadios(page, '')).toEqual(DEFAULT_STATE.gyro)
    const { axis: _axis, filtering, ...pid } = DEFAULT_STATE.pid
    expect(readBodeRadios(page, 'PID_')).toEqual(pid)
    expect(page.el('PID_filtering_Pre').checked).toBe(filtering === 'pre')
  })
})
