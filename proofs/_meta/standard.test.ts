import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Keeps the proofs project non-empty and checks the standard document is present.
describe('bug proof standard', () => {
  it('is documented', () => {
    expect(existsSync(resolve(__dirname, '../../docs/bug-proofs/README.md'))).toBe(true)
  })
})
