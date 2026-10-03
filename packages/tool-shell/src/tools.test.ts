import { describe, expect, it } from 'vitest'
import { TOOLS, TOOL_IDS, acceptsLog, toolById, toolHref } from './tools.js'

describe('tool registry', () => {
  it('describes every tool id exactly once', () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual([...TOOL_IDS].sort())
  })

  it('links ported tools relatively and others to the original site', () => {
    const pid = toolById('pid-review')
    expect(toolHref(pid, 'home')).toBe(`apps/${pid.id}/`)
    expect(toolHref(pid, 'tool')).toBe(`../${pid.id}/`)
    const original = TOOLS.find((t) => t.home === 'original')
    if (original) expect(toolHref(original, 'tool')).toMatch(/^https:\/\/firmware\.ardupilot\.org\//)
  })

  it('accepts logs by message type', () => {
    const pid = toolById('pid-review')
    expect(acceptsLog(pid, ['RATE'])).toBe(true)
    expect(acceptsLog(pid, ['GPS'])).toBe(false)
    expect(acceptsLog(pid, null)).toBe(true)
    expect(acceptsLog(toolById('dfu-loader'), ['RATE'])).toBe(false)
  })
})
