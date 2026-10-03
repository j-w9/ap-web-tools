import { describe, expect, it } from 'vitest'
import type { Telemetry } from '../session.js'
import { armedReadout, batteryReadout, currentText, satsReadout, speedText } from './telemetry-format.js'

const t = (patch: Partial<Telemetry>): Telemetry => ({
  batteryPct: null,
  currentA: null,
  speed: null,
  lastUpdate: 0,
  armed: null,
  modeName: '—',
  numSats: null,
  ...patch
})

describe('telemetry display', () => {
  it('formats like updateTelemetryDisplay', () => {
    expect(batteryReadout(t({}))).toEqual({ text: '---', band: 'neutral' })
    expect(batteryReadout(t({ batteryPct: -1 })).text).toBe('---')
    expect(batteryReadout(t({ batteryPct: 19 })).band).toBe('bad')
    expect(batteryReadout(t({ batteryPct: 39 })).band).toBe('warn')
    expect(batteryReadout(t({ batteryPct: 40 }))).toEqual({ text: '40%', band: 'good' })
    expect(currentText(t({ currentA: 1.25 }))).toBe('1.3 A')
    expect(currentText(t({ currentA: -0.01 }))).toBe('--- A')
    expect(speedText(t({ speed: 1 }))).toBe('1.9 knots')
    expect(speedText(t({}))).toBe('--- knots')
    expect(armedReadout(t({ armed: true })).text).toBe('ARMED')
    expect(armedReadout(t({ armed: false })).text).toBe('DISARM')
    expect(satsReadout(t({ numSats: 20 }))).toEqual({ text: '20 sats', band: 'good' })
  })
})
