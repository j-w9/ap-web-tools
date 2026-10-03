/**
 * WebUSB glue between a DFU-mode board and firmware-flash's transport-agnostic `DfuSeDevice`.
 * Adapted from ArduConfigurator's `apps/web/src/firmware/web-usb-dfu.ts` (same authors, GPL-3.0),
 * typed with `@types/w3c-web-usb` instead of hand-written shims, and split so the UI can show
 * the device and let the user pick an interface before flashing.
 */
import { parseDfuSeMemoryLayout, type DfuMemorySector, type DfuUsbInterface } from '@arduconfig/firmware-flash'
import {
  DEFAULT_TRANSFER_SIZE,
  DFU_INTERFACE_CLASS,
  DFU_INTERFACE_SUBCLASS,
  STM32_VENDOR_ID,
  transferSizeFromConfiguration
} from '../analysis/descriptors.js'

const GET_DESCRIPTOR = 0x06
const CONFIGURATION_DESCRIPTOR = 0x0200

/** One DFU alternate setting a device offers, e.g. "@Internal Flash" or "@Option Bytes". */
export interface DfuAlternate {
  readonly interfaceNumber: number
  readonly alternateSetting: number
  /** DfuSe layout string, e.g. "@Internal Flash  /0x08000000/04*016Kg,...". Empty if unnamed. */
  readonly name: string
  readonly memory: readonly DfuMemorySector[]
}

/** A connected DFU device, opened but with no interface claimed yet. */
export interface DfuDevice {
  readonly device: USBDevice
  readonly productName: string
  readonly manufacturerName: string
  readonly vendorId: number
  readonly productId: number
  readonly alternates: readonly DfuAlternate[]
  readonly transferSize: number
}

/** A claimed interface ready for `DfuSeDevice`. */
export interface ClaimedDfu {
  readonly usb: DfuUsbInterface
  readonly alternate: DfuAlternate
  release(): Promise<void>
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

/** Ask the user to pick a DFU device and open it. Must run inside a user gesture. */
export async function connectDfuDevice(): Promise<DfuDevice> {
  if (!isWebUsbSupported()) throw new Error('This browser does not support WebUSB. Use Chrome or Edge.')
  const device = await navigator.usb.requestDevice({
    filters: [{ classCode: DFU_INTERFACE_CLASS, subclassCode: DFU_INTERFACE_SUBCLASS }, { vendorId: STM32_VENDOR_ID }]
  })
  await device.open()
  if (device.configuration === null) await device.selectConfiguration(1)
  const alternates = listAlternates(device)
  if (alternates.length === 0) {
    await device.close().catch(() => undefined)
    throw new Error('No DFU interface found on this device. Put the board in DFU mode and connect again.')
  }
  return {
    device,
    productName: device.productName ?? 'DFU device',
    manufacturerName: device.manufacturerName ?? '',
    vendorId: device.vendorId,
    productId: device.productId,
    alternates,
    transferSize: await readTransferSize(device).catch(() => DEFAULT_TRANSFER_SIZE)
  }
}

/** The alternate to flash by default: internal flash if the device names it, else the first. */
export function defaultAlternate(alternates: readonly DfuAlternate[]): DfuAlternate | undefined {
  return alternates.find((a) => a.name.startsWith('@Internal Flash')) ?? alternates[0]
}

/** Claim an alternate and expose DFU class control transfers on it. */
export async function claimAlternate(dfu: DfuDevice, alternate: DfuAlternate): Promise<ClaimedDfu> {
  const { device } = dfu
  const index = alternate.interfaceNumber
  await device.claimInterface(index)
  if (alternate.alternateSetting !== 0) await device.selectAlternateInterface(index, alternate.alternateSetting)

  const usb: DfuUsbInterface = {
    async controlOut(request, value, data) {
      const result = await device.controlTransferOut(
        { requestType: 'class', recipient: 'interface', request, value, index },
        data.length > 0 ? data.slice() : undefined
      )
      if (result.status !== 'ok') throw new Error(`DFU control OUT failed (${result.status})`)
    },
    async controlIn(request, value, length) {
      const result = await device.controlTransferIn(
        { requestType: 'class', recipient: 'interface', request, value, index },
        length
      )
      if (result.status !== 'ok' || result.data === undefined) throw new Error(`DFU control IN failed (${result.status})`)
      return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
    }
  }
  return {
    usb,
    alternate,
    release: async () => {
      await device.releaseInterface(index).catch(() => undefined)
    }
  }
}

/** Close the device. Safe to call more than once. */
export async function disconnect(dfu: DfuDevice): Promise<void> {
  await dfu.device.close().catch(() => undefined)
}

function listAlternates(device: USBDevice): DfuAlternate[] {
  const out: DfuAlternate[] = []
  for (const iface of device.configuration?.interfaces ?? []) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass !== DFU_INTERFACE_CLASS || alt.interfaceSubclass !== DFU_INTERFACE_SUBCLASS) continue
      const name = alt.interfaceName ?? ''
      out.push({
        interfaceNumber: iface.interfaceNumber,
        alternateSetting: alt.alternateSetting,
        name,
        memory: parseDfuSeMemoryLayout(name)
      })
    }
  }
  return out
}

async function readTransferSize(device: USBDevice): Promise<number> {
  const result = await device.controlTransferIn(
    { requestType: 'standard', recipient: 'device', request: GET_DESCRIPTOR, value: CONFIGURATION_DESCRIPTOR, index: 0 },
    4096
  )
  if (result.status !== 'ok' || result.data === undefined) return DEFAULT_TRANSFER_SIZE
  return transferSizeFromConfiguration(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength))
}
