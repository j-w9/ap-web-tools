import { describe, expect, it } from 'vitest'
import { themeLayout, type PlotTheme } from './theme.js'

const theme: PlotTheme = { text: 't', muted: 'm', grid: 'g', line: 'l', hoverBg: 'h', accent: 'a', font: 'f' }

describe('themeLayout', () => {
  it('makes backgrounds transparent and themes every axis, including unlisted defaults', () => {
    const out = themeLayout({ yaxis2: { title: { text: 'Pitch' } } }, theme) as Record<string, Record<string, unknown>>
    expect(out.paper_bgcolor).toBe('rgba(0,0,0,0)')
    expect(out.xaxis?.gridcolor).toBe('g')
    expect(out.yaxis?.gridcolor).toBe('g')
    expect(out.yaxis2).toMatchObject({ gridcolor: 'g', title: { text: 'Pitch' } })
  })

  it('keeps explicit axis colours from the layout', () => {
    const out = themeLayout({ xaxis: { gridcolor: 'red' } }, theme) as Record<string, Record<string, unknown>>
    expect(out.xaxis?.gridcolor).toBe('red')
  })
})

describe('themeLayout for 3D', () => {
  it('themes scene axes and keeps explicit settings', () => {
    const out = themeLayout({ scene: { xaxis: { range: [0, 1] } } }, theme) as { scene: Record<string, Record<string, unknown>> }
    expect(out.scene.xaxis).toMatchObject({ gridcolor: 'g', range: [0, 1] })
    expect(out.scene.zaxis?.gridcolor).toBe('g')
  })
})

describe('themeLayout layout defaults', () => {
  it('lets axes grow their margins and themes the modebar', () => {
    const out = themeLayout({ xaxis: { automargin: false } }, theme) as Record<string, Record<string, unknown>>
    expect(out.yaxis?.automargin).toBe(true)
    expect(out.xaxis?.automargin).toBe(false)
    expect(out.modebar).toMatchObject({ color: 'm', activecolor: 'a' })
  })

  it('leaves legend and margins alone on wide plots', () => {
    const out = themeLayout({}, theme) as Record<string, Record<string, unknown>>
    expect(out.legend?.orientation).toBeUndefined()
    expect(out.margin).toBeUndefined()
  })

  it('puts an unplaced legend below narrow plots and tightens default margins', () => {
    const out = themeLayout({ legend: { itemclick: false }, yaxis2: { side: 'right' } }, theme, { narrow: true }) as Record<
      string,
      Record<string, unknown>
    >
    expect(out.legend).toMatchObject({ orientation: 'h', yref: 'container', y: 0, yanchor: 'bottom', itemclick: false })
    expect(out.margin).toEqual({ l: 48, r: 48, t: 24, b: 40 })
  })

  it('keeps a legend position the layout sets and caps its margins on narrow plots', () => {
    const margin = { l: 80, r: 80, t: 20, b: 60, pad: 2 }
    const out = themeLayout({ legend: { x: 1, y: 1 }, margin }, theme, { narrow: true }) as Record<
      string,
      Record<string, unknown>
    >
    expect(out.legend?.orientation).toBeUndefined()
    expect(out.margin).toEqual({ l: 48, r: 16, t: 20, b: 40, pad: 2 })
  })

  it('leaves margins alone when the layout turns automargin off', () => {
    const margin = { l: 80, r: 80, t: 20, b: 60 }
    const out = themeLayout({ margin, xaxis: { automargin: false } }, theme, { narrow: true }) as Record<string, unknown>
    expect(out.margin).toBe(margin)
  })

  it('themes range sliders and keeps their own settings', () => {
    const out = themeLayout({ xaxis: { rangeslider: { thickness: 0.1 } } }, theme) as Record<string, Record<string, unknown>>
    expect(out.xaxis?.rangeslider).toEqual({ bgcolor: 'rgba(0,0,0,0)', bordercolor: 'g', borderwidth: 1, thickness: 0.1 })
    expect((themeLayout({}, theme) as Record<string, Record<string, unknown>>).xaxis?.rangeslider).toBeUndefined()
  })
})
