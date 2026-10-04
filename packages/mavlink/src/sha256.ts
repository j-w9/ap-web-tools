/**
 * Synchronous SHA-256, for MAVLink 2 signing on the encode/decode path where the asynchronous
 * `crypto.subtle.digest` cannot be used.
 *
 * Port of `mavlink20.sha256` in upstream `modules/MAVLink/mavlink.js` (pymavlink's JavaScript
 * generator, "with thanks to https://geraintluff.github.io/sha256/"). Upstream's length block holds
 * only the low 32 bits of the message's bit length, so it hashes inputs of 512 MiB or more incorrectly;
 * the port writes the full 64-bit length (proven upstream bug #156, see `docs/bug-proofs/mavlink.md`).
 * MAVLink signing hashes at most 306 bytes, where both agree.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

const INITIAL_HASH = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19] as const

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n))
}

const bigSigma0 = (x: number): number => rotr(2, x) ^ rotr(13, x) ^ rotr(22, x)
const bigSigma1 = (x: number): number => rotr(6, x) ^ rotr(11, x) ^ rotr(25, x)
const smallSigma0 = (x: number): number => rotr(7, x) ^ rotr(18, x) ^ (x >>> 3)
const smallSigma1 = (x: number): number => rotr(17, x) ^ rotr(19, x) ^ (x >>> 10)
const choose = (x: number, y: number, z: number): number => (x & y) ^ (~x & z)
const majority = (x: number, y: number, z: number): number => (x & y) ^ (x & z) ^ (y & z)

/** SHA-256 digest (32 bytes) of `input`. */
export function sha256(input: Uint8Array): Uint8Array {
  const hash = Uint32Array.from(INITIAL_HASH)
  const length = input.length
  const bitLength = length * 8

  // Message, 0x80, zero padding to a multiple of 64 bytes, then the bit length, big-endian, in the
  // last 8 bytes (upstream fills only the low 4).
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
  padded.set(input)
  padded[length] = 0x80
  const lengthBlock = new DataView(padded.buffer, padded.length - 8)
  lengthBlock.setUint32(0, Math.floor(bitLength / 2 ** 32))
  lengthBlock.setUint32(4, bitLength >>> 0)

  const w = new Uint32Array(64)
  for (let block = 0; block < padded.length; block += 64) {
    for (let j = 0; j < 16; j++) {
      const at = block + 4 * j
      w[j] = ((padded[at]! << 24) | (padded[at + 1]! << 16) | (padded[at + 2]! << 8) | padded[at + 3]!) >>> 0
    }
    for (let j = 16; j < 64; j++) w[j] = (smallSigma1(w[j - 2]!) + w[j - 7]! + smallSigma0(w[j - 15]!) + w[j - 16]!) >>> 0

    let a = hash[0]!
    let b = hash[1]!
    let c = hash[2]!
    let d = hash[3]!
    let e = hash[4]!
    let f = hash[5]!
    let g = hash[6]!
    let h = hash[7]!
    for (let j = 0; j < 64; j++) {
      const t1 = (h + bigSigma1(e) + choose(e, f, g) + K[j]! + w[j]!) >>> 0
      const t2 = (bigSigma0(a) + majority(a, b, c)) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    // Uint32Array stores modulo 2^32, as upstream's `(H[i] + x) >>> 0`.
    hash[0] = hash[0]! + a
    hash[1] = hash[1]! + b
    hash[2] = hash[2]! + c
    hash[3] = hash[3]! + d
    hash[4] = hash[4]! + e
    hash[5] = hash[5]! + f
    hash[6] = hash[6]! + g
    hash[7] = hash[7]! + h
  }

  const output = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
    const word = hash[i]!
    output[i * 4] = (word >>> 24) & 0xff
    output[i * 4 + 1] = (word >>> 16) & 0xff
    output[i * 4 + 2] = (word >>> 8) & 0xff
    output[i * 4 + 3] = word & 0xff
  }
  return output
}
