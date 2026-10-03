/** Telemetry display text and colour bands (upstream `SimpleGCS/app.js`, `updateTelemetryDisplay`). */
import type { Telemetry } from '../session.js'

export type Band = 'good' | 'warn' | 'bad' | 'neutral'

export interface Readout {
  readonly text: string
  readonly band: Band
}

export function batteryReadout(t: Telemetry): Readout {
  const pct = t.batteryPct
  if (pct === null || pct < 0) return { text: '---', band: 'neutral' }
  return { text: `${pct}%`, band: pct < 20 ? 'bad' : pct < 40 ? 'warn' : 'good' }
}

export const currentText = (t: Telemetry): string =>
  t.currentA !== null && t.currentA >= 0 ? `${t.currentA.toFixed(1)} A` : '--- A'

export const speedText = (t: Telemetry): string =>
  t.speed !== null && t.speed >= 0 ? `${(1.94384449 * t.speed).toFixed(1)} knots` : '--- knots'

export function armedReadout(t: Telemetry): Readout {
  if (t.armed === null) return { text: '—', band: 'neutral' }
  return t.armed ? { text: 'ARMED', band: 'good' } : { text: 'DISARM', band: 'neutral' }
}

export function satsReadout(t: Telemetry): Readout {
  return t.numSats === null
    ? { text: '— sats', band: 'neutral' }
    : { text: `${t.numSats} sats`, band: t.numSats >= 20 ? 'good' : 'neutral' }
}
