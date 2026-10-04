/**
 * Real-log oracle (gated): the port against the upstream JsDataflashParser on every `.bin` in
 * `APWT_REAL_LOGS`, comparing everything the oracle tests compare on the committed fixtures: message
 * types, fields, instances, record counts, units and multipliers, `stats()`, every column of every
 * message and instance, whole-message decoding, parameters, mode names, start time and embedded
 * files. Proven upstream bugs (docs/bug-proofs/js-dataflash-parser.md) are asserted as documented
 * by the shared comparisons. Skipped when `APWT_REAL_LOGS` is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from './log.js'
import { expectColumnEqual, expectSameFiles, expectSameStats, expectSameTypes } from './test-support/oracle-compare.js'
import { REAL_LOG_TIMEOUT_MS, readRealLog, realLogDir, realLogFiles, yieldToEventLoop } from './test-support/real-logs.js'
import { quietly, upstreamParse, type UpstreamParser } from './test-support/upstream-parser.js'

/** Upstream field arrays of one message (`get_instance(name, inst)` without a field). */
type UpstreamMessage = Record<string, ArrayLike<unknown>> | undefined

describe.skipIf(realLogDir === undefined)('real logs: JsDataflashParser oracle', () => {
  for (const file of realLogFiles()) {
    describe(file, () => {
      let loaded: { bytes: Uint8Array; up: UpstreamParser; log: DataflashLog } | undefined
      const state = () => {
        if (loaded === undefined) throw new Error(`${file} not loaded`)
        return loaded
      }

      beforeAll(async () => {
        const bytes = new Uint8Array(readRealLog(file))
        const up = await upstreamParse(bytes)
        await yieldToEventLoop()
        loaded = { bytes, up, log: DataflashLog.parse(bytes) }
      }, REAL_LOG_TIMEOUT_MS)

      // Release the buffers before the next log is read.
      afterAll(() => {
        loaded = undefined
      })

      it('matches message types, fields, instances, counts, units and multipliers', () => {
        const { up, log } = state()
        expectSameTypes(log, up)
        expect(log.messageTypes().size).toBeGreaterThan(0)
      })

      it('matches stats()', () => {
        const { up, log } = state()
        expectSameStats(log, up)
      })

      it(
        'decodes every column of every message and instance identically',
        async () => {
          const { up, log } = state()
          for (const [name, info] of log.messageTypes()) {
            const instances = log.instances(name)
            for (const field of info.fieldNames) {
              if (instances.length === 0) {
                expectColumnEqual(log.get(name, field), up.get(name, field), `${name}.${field}`)
              } else {
                for (const inst of instances) {
                  expectColumnEqual(
                    log.getInstance(name, inst, field),
                    up.get_instance(name, String(inst), field),
                    `${name}[${inst}].${field}`
                  )
                }
              }
            }
            await yieldToEventLoop()
          }
        },
        REAL_LOG_TIMEOUT_MS
      )

      it(
        'decodes whole messages identically (getMessage against get_instance without a field)',
        async () => {
          // A fresh log, so the column cache of the previous test does not mask the whole-message path.
          const { bytes, up } = state()
          const fresh = DataflashLog.parse(bytes)
          for (const [name, info] of fresh.messageTypes()) {
            const instances = fresh.instances(name)
            const pairs: [number | undefined, UpstreamMessage][] =
              instances.length === 0
                ? [[undefined, up.get(name) as UpstreamMessage]]
                : instances.map((inst) => [inst, up.get_instance(name, String(inst)) as UpstreamMessage])
            for (const [inst, theirs] of pairs) {
              const label = inst === undefined ? name : `${name}[${inst}]`
              const mine = fresh.getMessage(name, inst)
              expect(Object.keys(mine?.columns ?? {}), label).toEqual(Object.keys(theirs ?? {}))
              expect(Object.keys(mine?.columns ?? {}), label).toEqual(info.fieldNames)
              for (const field of info.fieldNames) {
                expectColumnEqual(mine?.columns[field], theirs?.[field], `${label}.${field}`)
              }
            }
            await yieldToEventLoop()
          }
        },
        REAL_LOG_TIMEOUT_MS
      )

      it('matches parameters (last value wins)', () => {
        const { up, log } = state()
        const names = (up.get('PARM', 'Name') ?? []) as string[]
        const values = (up.get('PARM', 'Value') ?? []) as ArrayLike<number>
        const expected = new Map<string, number>()
        for (let i = 0; i < names.length; i++) expected.set(names[i]!, values[i]!)
        expect(log.params()).toEqual(expected)
      })

      it('matches mode names and start time', () => {
        const { up, log } = state()
        quietly(() => {
          up.parseAtOffset('MSG')
          up.parseAtOffset('MODE')
        })
        const theirs = (up.messages['MODE']?.['asText'] ?? []) as string[]
        expect(log.modes().map((m) => m.name)).toEqual(theirs)
        expect(log.startTime()?.getTime()).toBe(up.extractStartTime()?.getTime())
      })

      it('matches the embedded files', () => {
        const { up, log } = state()
        expectSameFiles(log, up)
      })
    })
  }
})
