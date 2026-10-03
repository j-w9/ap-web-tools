// Keeps the UI audit fixture (apps/pid-review/test-fixtures/ui-param-sets.bin, used by
// scripts/ui-audit.config.mjs) in step with its builder: roll PID messages with
// three parameter sets. Regenerate with:
//   WRITE_UI_FIXTURE=1 npx vitest run apps/pid-review/src/ui-fixture.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadLog } from './analysis/load.js'
import { buildPidLog } from './test-utils/synthetic.js'

const path = resolve(dirname(fileURLToPath(import.meta.url)), '../test-fixtures/ui-param-sets.bin')

function build(): Uint8Array {
  return new Uint8Array(
    buildPidLog({
      banner: 'ArduCopter V4.6.0 (1234abcd)',
      pidMessages: ['PIDR'],
      rate: false,
      rateHz: 100,
      duration: 21,
      changes: [
        { time: 7, name: 'ATC_RAT_RLL_P', value: 0.15 },
        { time: 7, name: 'ATC_RAT_RLL_D', value: 0.004 },
        { time: 14, name: 'ATC_RAT_RLL_P', value: 0.17 }
      ]
    })
  )
}

describe('UI audit fixture', () => {
  const bytes = build()
  if (process.env.WRITE_UI_FIXTURE === '1') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }

  it('matches its builder', () => {
    expect(existsSync(path)).toBe(true)
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
  })

  it('has three roll parameter sets', () => {
    const log = loadLog(bytes.slice().buffer)
    expect(log.axes.find((a) => a.spec.key === 'PIDR')?.paramSets.sets.length).toBe(3)
  })
})
