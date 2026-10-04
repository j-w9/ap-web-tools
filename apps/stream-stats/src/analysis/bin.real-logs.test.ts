/**
 * Real-log oracle (gated): the port against upstream Stream Stats `plot_log` (run in a vm, fed by
 * the upstream JsDataflashParser as upstream `load_log` does) on every `.bin` in `APWT_REAL_LOGS`:
 * every per-message rate trace, the total rate and the composition pie, in both units and at the
 * window sizes the fixture oracle tests use. In bits mode upstream's pie holds bytes (proven
 * upstream bug, docs/bug-proofs/stream-stats.md); that difference is asserted. Skipped when
 * `APWT_REAL_LOGS` is not set.
 */
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { REAL_LOG_TIMEOUT_MS, readRealLog, realLogDir, realLogFiles, yieldToEventLoop } from '@apwt/dataflash/testing'
import { binStreams } from './bin.js'
import { streamStats, type RateUnit, type StreamStats } from './stats.js'
import { loadUpstream, type UpstreamFakeBinLog, type UpstreamStreamStats } from './test-support/upstream.js'

type UpstreamParserCtor = new (sendPostMessage: boolean) => UpstreamFakeBinLog & {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
}

/** The real upstream JsDataflashParser, as upstream `load_log` uses it. */
async function upstreamParser(buffer: ArrayBuffer): Promise<UpstreamFakeBinLog> {
  const g: Record<string, unknown> = globalThis
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const path = resolve(__dirname, '../../../../upstream/modules/JsDataflashParser/parser.js')
  const mod: { default: UpstreamParserCtor } = await import(/* @vite-ignore */ path)
  const log = new mod.default(false)
  const orig = console.log
  console.log = () => undefined
  try {
    log.processData(buffer, [])
  } finally {
    console.log = orig
  }
  return log
}

function upstreamResult(upstream: UpstreamStreamStats, unit: RateUnit) {
  const total = upstream.total()
  const composition = upstream.composition()
  return {
    rates: upstream.rates().map((r) => ({ name: r.name, time: Array.from(r.x ?? []), rate: Array.from(r.y ?? []) })),
    total: total.x === null ? null : { time: Array.from(total.x), rate: Array.from(total.y ?? []) },
    // Upstream's bits-mode pie holds bytes; the port's bits (proven upstream bug, fixed).
    composition: Array.from(composition.labels, (label, i) => ({
      label,
      value: unit === 'bits' ? (composition.values[i] ?? 0) * 8 : composition.values[i]
    }))
  }
}

function portResult(stats: StreamStats) {
  return {
    rates: stats.rates.map((r) => ({ name: r.name, time: Array.from(r.time), rate: Array.from(r.rate) })),
    total: stats.total === null ? null : { time: Array.from(stats.total.time), rate: Array.from(stats.total.rate) },
    composition: stats.composition.map((c) => ({ ...c }))
  }
}

describe.skipIf(realLogDir === undefined)('real logs: Stream Stats plot_log oracle', () => {
  for (const file of realLogFiles()) {
    it(
      `${file}: matches every rate trace, the total and the composition`,
      async () => {
        const upLog = await upstreamParser(readRealLog(file))
        const log = binStreams(DataflashLog.parse(readRealLog(file)))
        for (const unit of ['bits', 'messages'] as const satisfies readonly RateUnit[]) {
          for (const width of [2, 10]) {
            const upstream = loadUpstream()
            upstream.setSettings(width, unit === 'bits')
            upstream.plotLog(upLog)
            expect(upstream.alerts, `${unit} ${width} s alerts`).toEqual([])
            const stats = streamStats({ kind: 'bin', log }, { unit, binWidth: width })
            expect(portResult(stats), `${unit} ${width} s`).toEqual(upstreamResult(upstream, unit))
            await yieldToEventLoop()
          }
        }
      },
      REAL_LOG_TIMEOUT_MS
    )
  }
})
