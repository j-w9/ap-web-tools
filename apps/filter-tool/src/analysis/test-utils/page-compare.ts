// Test-only: drive the upstream FilterTool page (test-utils/page.ts) and compare its inputs, radios
// and Bode plots with the port's. Shared by the page oracle tests and the real-log tests.
import { expect } from 'vitest'
import type { Layout, PlotData } from '@apwt/plot'
import type { BodePlot } from '../../ui/traces.js'
import { INPUT_NAMES, type InputName, type Inputs, type PidAxis } from '../params.js'
import type { BodeSettings, ToolState } from '../settings.js'
import { loadUpstreamPage, type UpstreamPage } from './page.js'

export const AXIS_BUTTONS: Readonly<Record<PidAxis, string>> = {
  RLL: 'CalculateRoll',
  PIT: 'CalculatePitch',
  YAW: 'CalculateYaw'
}
export const AXIS_TITLES: Readonly<Record<PidAxis, string>> = { RLL: 'Roll axis', PIT: 'Pitch axis', YAW: 'Yaw axis' }

// The page is loaded with the proven chained harmonic-notch spread bug fixed
// (docs/bug-proofs/filters.md, row 2); outside that case it is the original page (see bode.test.ts).
export function freshPage(href?: string): UpstreamPage {
  const page = loadUpstreamPage({ fixChainedSpread: true })
  if (href !== undefined) page.setHref(href)
  page.call('load')
  return page
}

export function setInputs(page: UpstreamPage, inputs: Inputs): void {
  for (const name of INPUT_NAMES) page.el(name).value = String(inputs[name])
}

export function readInputs(page: UpstreamPage): Record<InputName, number> {
  return Object.fromEntries(INPUT_NAMES.map((n) => [n, page.read(n)])) as Record<InputName, number>
}

export function setBodeRadios(page: UpstreamPage, p: '' | 'PID_', s: BodeSettings): void {
  page.el(s.magnitude === 'dB' ? `${p}ScaleLog` : `${p}ScaleLinear`).checked = true
  page.el(s.phase === 'unwrapped' ? `${p}ScaleUnWrap` : `${p}ScaleWrap`).checked = true
  page.el(s.frequencyAxis === 'log' ? `${p}freq_ScaleLog` : `${p}freq_ScaleLinear`).checked = true
  page.el(s.frequencyUnit === 'Hz' ? `${p}freq_Scale_Hz` : `${p}freq_Scale_RPM`).checked = true
  page.el(`${p}ShowComponents`).checked = s.showComponents
}

export function readBodeRadios(page: UpstreamPage, p: '' | 'PID_'): BodeSettings {
  return {
    magnitude: page.el(`${p}ScaleLog`).checked ? 'dB' : 'linear',
    phase: page.el(`${p}ScaleUnWrap`).checked ? 'unwrapped' : 'wrapped',
    frequencyAxis: page.el(`${p}freq_ScaleLog`).checked ? 'log' : 'linear',
    frequencyUnit: page.el(`${p}freq_Scale_RPM`).checked ? 'RPM' : 'Hz',
    showComponents: page.el(`${p}ShowComponents`).checked
  }
}

export interface UpstreamPlot {
  data: Record<string, unknown>[]
  layout: {
    xaxis: { type: string }
    xaxis2: { type: string; title: { text: string } }
    yaxis: { title: { text: string } }
    yaxis2: { range?: number[]; autorange: boolean; fixedrange: boolean }
    showlegend: boolean
  }
}

export const list = (v: unknown) => Array.from(v as ArrayLike<number>)

export function expectSamePlot(up: UpstreamPlot, port: BodePlot): void {
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

/** Inputs and radios of the upstream page as the port's state, for a PID axis. */
export function pageState(page: UpstreamPage, axis: PidAxis): ToolState {
  return {
    inputs: readInputs(page),
    gyro: readBodeRadios(page, ''),
    pid: { ...readBodeRadios(page, 'PID_'), filtering: page.el('PID_filtering_Post').checked ? 'post' : 'pre', axis }
  }
}
