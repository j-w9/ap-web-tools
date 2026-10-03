// Keeps the UI audit fixture (apps/magfit/test-fixtures/ui-three-compasses.bin, used by
// scripts/ui-audit.config.mjs) in step with its builder: three compasses with known errors,
// battery current for motor compensation. Regenerate with:
//   WRITE_UI_FIXTURE=1 npx vitest run apps/magfit/src/ui-fixture.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildSyntheticMagLog } from './test-utils/synthetic-mag-log.js'

const path = resolve(dirname(fileURLToPath(import.meta.url)), '../test-fixtures/ui-three-compasses.bin')

describe('UI audit fixture', () => {
  const bytes = new Uint8Array(buildSyntheticMagLog({ duration: 60 }))
  if (process.env.WRITE_UI_FIXTURE === '1') {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }

  it('matches its builder', () => {
    expect(existsSync(path)).toBe(true)
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
  })
})
