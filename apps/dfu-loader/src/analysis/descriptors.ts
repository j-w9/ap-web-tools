/** USB DFU class constants and descriptor parsing, independent of WebUSB. */

/** Interface class 0xFE (application specific), subclass 1: DFU. */
export const DFU_INTERFACE_CLASS = 0xfe
export const DFU_INTERFACE_SUBCLASS = 0x01
/** STM32 system bootloader vendor id, used as a fallback device filter. */
export const STM32_VENDOR_ID = 0x0483
/** STM32 default when the functional descriptor cannot be read. */
export const DEFAULT_TRANSFER_SIZE = 2048

const DFU_FUNCTIONAL_DESCRIPTOR = 0x21

/**
 * Read `wTransferSize` from the DFU functional descriptor inside a configuration descriptor
 * blob. Returns the STM32 default when it is absent or zero.
 */
export function transferSizeFromConfiguration(blob: Uint8Array): number {
  let i = 0
  while (i + 1 < blob.length) {
    const length = blob[i]!
    if (length < 2) break
    if (blob[i + 1] === DFU_FUNCTIONAL_DESCRIPTOR && i + 7 <= blob.length) {
      const size = blob[i + 5]! | (blob[i + 6]! << 8)
      return size > 0 ? size : DEFAULT_TRANSFER_SIZE
    }
    i += length
  }
  return DEFAULT_TRANSFER_SIZE
}
