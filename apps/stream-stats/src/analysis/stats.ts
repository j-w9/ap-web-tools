/**
 * What Stream Stats plots: a rate series per message stream, the total rate and the share of
 * each stream in the log, for either a tlog (filtered by component and message) or a
 * DataFlash log.
 *
 * Port of upstream `plot_tlog` and `plot_log` (`StreamStats/StreamStats.js`).
 */
import type { BinLog } from './bin.js'
import type { MavlinkVersion } from './mavlink/frame.js'
import { binCount, emptyTotal, totalCount, type RateSeries } from './rates.js'
import type { Tlog, TlogComponent } from './tlog.js'

/** What the rates and composition count. */
export type RateUnit = 'bits' | 'messages'

/** Identifies one component of a tlog: `"<system id>,<component id>"`. */
export type ComponentKey = `${number},${number}`

/** Identifies one message stream of a tlog component: `"<system id>,<component id>,<name>"`. */
export type MessageKey = `${ComponentKey},${string}`

export function componentKey(c: Pick<TlogComponent, 'systemId' | 'componentId'>): ComponentKey {
  return `${c.systemId},${c.componentId}`
}

export function messageKey(c: Pick<TlogComponent, 'systemId' | 'componentId'>, name: string): MessageKey {
  return `${componentKey(c)},${name}`
}

/** Streams the user has switched off. A message of an excluded component is excluded too. */
export interface TlogSelection {
  readonly excludedComponents: ReadonlySet<ComponentKey>
  readonly excludedMessages: ReadonlySet<MessageKey>
}

export const EMPTY_SELECTION: TlogSelection = { excludedComponents: new Set(), excludedMessages: new Set() }

/** A loaded log ready for analysis. */
export type StreamSource =
  | { readonly kind: 'tlog'; readonly tlog: Tlog; readonly selection: TlogSelection }
  | { readonly kind: 'bin'; readonly log: BinLog }

export interface StatsSettings {
  readonly unit: RateUnit
  /**
   * Width of each rate bin, seconds, as upstream `parseFloat` reads it. Not validated: a negative
   * width gives upstream's odd results and 0 or NaN throws a `RangeError`, as upstream does.
   */
  readonly binWidth: number
}

/** Rate of one message stream. */
export interface StreamRate extends RateSeries {
  /** Unique within one result. */
  readonly key: string
  /** Message name, used as the trace name. */
  readonly name: string
}

/** One slice of the composition pie. */
export interface CompositionSlice {
  readonly label: string
  /** Bits or message count, depending on the unit. */
  readonly value: number
}

export interface StreamStats {
  readonly rates: readonly StreamRate[]
  /** Total rate of every included stream, or `null` when nothing is included. */
  readonly total: RateSeries | null
  readonly composition: readonly CompositionSlice[]
}

function sum(values: ArrayLike<number>): number {
  let total = 0
  for (let i = 0; i < values.length; i++) total += values[i]!
  return total
}

function tlogStats(tlog: Tlog, selection: TlogSelection, { unit, binWidth }: StatsSettings): StreamStats {
  const rates: StreamRate[] = []
  const total = emptyTotal()
  const composition: CompositionSlice[] = []
  for (const component of tlog.components) {
    if (selection.excludedComponents.has(componentKey(component))) continue
    for (const message of component.messages) {
      const key = messageKey(component, message.name)
      if (selection.excludedMessages.has(key)) continue
      const rate = binCount(message.time, unit === 'bits' ? message.sizeBits : 1, binWidth, total)
      rates.push({ key, name: message.name, ...rate })
      composition.push({
        label: `(${component.systemId}, ${component.componentId}) ${message.name}`,
        value: unit === 'bits' ? sum(message.sizeBits) : message.sizeBits.length
      })
    }
  }
  return { rates, total: totalCount(total, binWidth), composition }
}

function binLogStats(log: BinLog, { unit, binWidth }: StatsSettings): StreamStats {
  // Upstream bug reproduced: in bits mode the pie plots each type's size in bytes, while its
  // hover text says bits (docs/upstream-bugs.md). Types without records are included at 0.
  const composition: CompositionSlice[] = log.messages.map((m) => ({
    label: m.name,
    value: unit === 'bits' ? m.totalBytes : m.count
  }))
  const rates: StreamRate[] = []
  const total = emptyTotal()
  for (const message of log.messages) {
    if (message.count === 0 || message.time === null) continue
    const rate = binCount(message.time, unit === 'bits' ? message.recordBytes * 8 : 1, binWidth, total)
    rates.push({ key: message.name, name: message.name, ...rate })
  }
  return { rates, total: totalCount(total, binWidth), composition }
}

/**
 * Rates and composition of a log under the given settings.
 *
 * @throws {RangeError} for a window of 0 or NaN when any stream is included (upstream crashes too).
 */
export function streamStats(source: StreamSource, settings: StatsSettings): StreamStats {
  switch (source.kind) {
    case 'tlog':
      return tlogStats(source.tlog, source.selection, settings)
    case 'bin':
      return binLogStats(source.log, settings)
  }
}

/** Versions as upstream lists them: ascending, comma separated. */
export function versionsLabel(versions: ReadonlySet<MavlinkVersion>): string {
  return [...versions].sort((a, b) => a - b).join(', ')
}

/** Dropped frames as a percentage of received frames. */
export function dropPercent(component: Pick<TlogComponent, 'dropped' | 'received'>): number {
  return (component.dropped / component.received) * 100
}
