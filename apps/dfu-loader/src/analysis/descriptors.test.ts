import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSFER_SIZE, transferSizeFromConfiguration } from './descriptors.js'

describe('transferSizeFromConfiguration', () => {
  it('finds wTransferSize in the DFU functional descriptor', () => {
    // A 9-byte configuration descriptor, then a 9-byte DFU functional descriptor with size 1024.
    const blob = new Uint8Array([9, 2, 27, 0, 1, 1, 0, 0x80, 50, 9, 0x21, 0x0b, 0xff, 0, 0x00, 0x04, 0x1a, 0x01])
    expect(transferSizeFromConfiguration(blob)).toBe(1024)
  })

  it('falls back to the STM32 default', () => {
    expect(transferSizeFromConfiguration(new Uint8Array([9, 2, 9, 0, 1, 1, 0, 0x80, 50]))).toBe(DEFAULT_TRANSFER_SIZE)
    expect(transferSizeFromConfiguration(new Uint8Array([0]))).toBe(DEFAULT_TRANSFER_SIZE)
  })
})
