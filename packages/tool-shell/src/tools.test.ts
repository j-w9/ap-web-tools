import { describe, expect, it } from 'vitest'
import { OPEN_IN_DESTINATIONS, canOpenIn } from './open-in.js'
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

describe('open in', () => {
  it('lists upstream OpenIn.js destinations with the same message rules', () => {
    const byName = new Map(OPEN_IN_DESTINATIONS.map((d) => [d.name, d]))
    // Upstream destinations: UAV Log Viewer (always), Hardware Report (PARM), Filter Review
    // (GYR or ISBD), MAGFit (MAG), PID Review (any rate/PID message).
    expect(byName.get('UAV Log Viewer')?.accepts([])).toBe(true)
    expect(byName.get('UAV Log Viewer')?.path).toBe('https://plotbeta.ardupilot.org/#')
    expect(byName.get('Hardware Report')?.accepts(['PARM'])).toBe(true)
    expect(byName.get('Hardware Report')?.accepts(['GYR'])).toBe(false)
    expect(byName.get('Filter Review')?.accepts(['ISBD'])).toBe(true)
    expect(byName.get('Filter Review')?.accepts(['PARM'])).toBe(false)
    expect(byName.get('MAGFit')?.accepts(['MAG'])).toBe(true)
    for (const m of ['RATE', 'PIDR', 'PIDP', 'PIDY', 'PIQR', 'PIQP', 'PIQY', 'PIDS', 'PIDA']) {
      expect(byName.get('PID Review')?.accepts([m])).toBe(true)
    }
    expect(byName.get('PID Review')?.accepts(['GYR'])).toBe(false)
  })

  it('enables the hand-off only for .bin files, as upstream setup_open_in', () => {
    expect(canOpenIn('flight.bin')).toBe(true)
    expect(canOpenIn('FLIGHT.BIN')).toBe(true)
    expect(canOpenIn('flight.log')).toBe(false)
    expect(canOpenIn('flight.tlog')).toBe(false)
  })
})
