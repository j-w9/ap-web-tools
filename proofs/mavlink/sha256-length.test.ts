/**
 * #156: upstream `mavlink20.sha256` writes only the low 32 bits of the message bit length. The
 * reference digest is Node's `crypto` SHA-256. Hashing 512 MiB in upstream's pure-JavaScript
 * implementation takes about ten seconds and roughly 1 GiB of memory.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hex, loadUpstream } from './_harness.js'
import { SLOW_PROOFS } from '../_meta/slow.js'

function reference(bytes: Uint8Array): string {
  return hex(createHash('sha256').update(bytes).digest())
}

describe('#156 SHA-256 length block holds only 32 bits', () => {
  it('matches the reference below 512 MiB (empty, one block, a signing-sized input)', async () => {
    const u = await loadUpstream()
    for (const length of [0, 55, 56, 64, 306]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 7 + 3) & 0xff)
      expect(hex(u.mavlink20.sha256(bytes))).toBe(reference(bytes))
    }
  })

  it.runIf(SLOW_PROOFS)('gives a wrong digest for 2^29 bytes (bit length 2^32)', async () => {
    const u = await loadUpstream()
    const bytes = new Uint8Array(2 ** 29)
    // The length bytes upstream writes: `(bitLen >>> k) & 0xff` of 2^32 are all zero.
    const bitLen = bytes.length * 8
    expect([bitLen >>> 24, bitLen >>> 16, bitLen >>> 8, bitLen].map((v) => v & 0xff)).toEqual([0, 0, 0, 0])
    expect(reference(bytes)).toBe(
      '9a cc a8 e8 c2 22 01 15 53 89 f6 5a bb f6 bc 97 23 ed c7 38 4e ad 80 50 38 39 f4 9d cc 56 d7 67'
    )
    expect(hex(u.mavlink20.sha256(bytes))).toBe(
      '75 4b 83 b4 86 5f a2 13 49 b7 a1 a1 bc 52 0b 29 1e cf 80 03 64 77 1d fe 38 38 f8 a5 50 ac 15 1c'
    )
  })
})
