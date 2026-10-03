// Keeps the UI audit fixture (apps/sysid/test-fixtures/ui-sid.bin, used by scripts/ui-audit.config.mjs)
// in step with its builder: a System ID flight with RATE chirps, SIDD responses and ATT. Regenerate with:
//   WRITE_UI_FIXTURE=1 npx vitest run apps/sysid/src/ui-fixture.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSyntheticSidLog } from './test-utils/synthetic-sid.js'

const path = resolve(dirname(fileURLToPath(import.meta.url)), '../test-fixtures/ui-sid.bin')

describe('UI audit fixture', () => {
  const bytes = buildSyntheticSidLog({ duration: 20, rate: 100 })
  if (process.env.WRITE_UI_FIXTURE === '1') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }

  it('matches its builder', () => {
    expect(existsSync(path)).toBe(true)
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
  })
})
