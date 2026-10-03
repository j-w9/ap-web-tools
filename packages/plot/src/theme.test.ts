import { describe, expect, it } from 'vitest'
import { themeLayout, type PlotTheme } from './theme.js'

const theme: PlotTheme = { text: 't', muted: 'm', grid: 'g', line: 'l', hoverBg: 'h', font: 'f' }

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
