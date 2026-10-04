// SHA-256 against Node's crypto. Upstream's `mavlink20.sha256` writes only the low 32 bits of the bit
// length, so it is wrong from 512 MiB on (proven upstream bug #156, see docs/bug-proofs/mavlink.md and
// proofs/mavlink/sha256-length.test.ts, which pins upstream's digest). The port writes all 64 bits.
// Below 512 MiB the port equals upstream byte for byte (parser.oracle.test.ts).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256 } from './sha256.js'

const reference = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** Hashing 512 MiB needs about 1 GiB of memory; it runs with the slow proofs (APWT_SLOW_PROOFS=1). */
const SLOW = process.env['APWT_SLOW_PROOFS'] === '1'

describe('sha256', () => {
  it('matches the reference around the block and length-field boundaries', () => {
    for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 306, 1000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 7 + 3) & 0xff)
      expect(hex(sha256(bytes)), String(length)).toBe(reference(bytes))
    }
  })

  it.runIf(SLOW)('writes the full 64-bit bit length: 2^29 bytes hash correctly (proven bug #156)', () => {
    const bytes = new Uint8Array(2 ** 29)
    // Upstream gives 754b83b4865fa21349b7a1a1bc520b291ecf800364771dfe3838f8a550ac151c here.
    expect(hex(sha256(bytes))).toBe('9acca8e8c22201155389f65abbf6bc9723edc7384ead80503839f49dcc56d767')
  })
})
