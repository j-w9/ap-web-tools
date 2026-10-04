// Real-log validation (not run in CI): with APWT_REAL_LOGS pointing to a directory of DataFlash
// .bin files, load each one into upstream HardwareReport.js (in a vm, test-utils/upstream.ts) and
// into the port, and compare every section exactly as the oracle tests do: parameters, changes,
// defaults and the three downloads, sensor sections and position plot, firmware and board, the
// release check hash, watchdog and internal errors, IOMCU, board health, performance, stacks, data
// rates, DroneCAN, missions, embedded files, warnings, logger stats and clock drift. No log content
// is stored: the logs stay outside the repository.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { compareFaults } from '../test-utils/compare-faults.js'
import { compareExports, compareParams } from '../test-utils/compare-params.js'
import { compareLogSections } from '../test-utils/compare-sections.js'
import { compareSensorSections } from '../test-utils/compare-sensors.js'
import { createUpstreamHardwareReport } from '../test-utils/upstream.js'
import { buildLogReport, type LogReport } from './report.js'

const dir = process.env['APWT_REAL_LOGS']
const logs =
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.bin'))
        .sort()

/** Same bytes in both arrays. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

describe.skipIf(dir === undefined)('Hardware Report on real logs', () => {
  it.each(logs)('%s matches upstream', async (name) => {
    const bytes = new Uint8Array(readFileSync(join(dir ?? '', name)))
    const up = await createUpstreamHardwareReport()
    const hashes: unknown[] = []
    up.get('check_release = async function (hash) { __hashes.push(hash) }')
    Reflect.set(up.get('globalThis') as object, '__hashes', hashes)
    await up.loadLog(bytes)

    let port: LogReport
    try {
      port = buildLogReport(DataflashLog.parse(bytes))
    } catch (e) {
      // Upstream alerts and stops when the log has no parameters; the port throws the same text.
      expect(up.alerts).toEqual([(e as Error).message])
      expect(up.alerts).toEqual(['No parameter values found in log'])
      return
    }
    expect(up.alerts).toEqual([])

    up.dom.getElementById('fileItem').value = name
    compareParams(up, port)
    compareExports(up, port.params, name)
    compareSensorSections(up, port)
    compareFaults(up, port)
    expect(hashes).toEqual(
      port.firmware.fwString !== undefined && port.firmware.fwHash !== undefined ? [port.firmware.fwHash] : []
    )

    // Embedded files upstream appends twice or reads without trailing zero bytes (proven upstream
    // bug, docs/bug-proofs/js-dataflash-parser.md) are compared the documented way; all others
    // must be identical.
    const links = up.dom.getElementById('FILES').getElementsByTagName('a')
    const fixed = port.files
      .filter((f, i) => {
        up.saved.length = 0
        links[i]?.dispatch('click')
        const theirs = up.saved[0]?.parts[0]
        return theirs instanceof Uint8Array && !sameBytes(f.data, theirs)
      })
      .map((f) => f.name)
    compareLogSections({ up, port }, fixed)
  })
})
