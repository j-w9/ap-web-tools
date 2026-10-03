// Keeps the UI audit fixture (apps/filter-review/test-fixtures/ui-batch.bin) in step with its
// builder. Regenerate with: WRITE_UI_FIXTURE=1 npx vitest run apps/filter-review/src/analysis/ui-fixture.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadFilterReviewLog } from './load.js'
import { buildUiFixture } from './test-utils/ui-fixture.js'

const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/ui-batch.bin')

describe('UI audit fixture', () => {
  const bytes = buildUiFixture()
  if (process.env.WRITE_UI_FIXTURE === '1') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }

  it('matches its builder', () => {
    expect(existsSync(path)).toBe(true)
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
  })

  it('loads as two gyros with batch data before and after the filters', () => {
    const log = loadFilterReviewLog(bytes)
    expect(log.gyro.type).toBe('batch')
    expect(log.numGyro).toBe(2)
    expect(log.havePre && log.havePost).toBe(true)
    expect(log.loggedNotches.some((l) => l.haveData())).toBe(true)
  })
})
