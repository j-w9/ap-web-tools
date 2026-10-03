/*
 * USB DFU 1.1 host over WebUSB. TypeScript port of upstream/DFULoader/dfu.js, which is
 * devanlai's webdfu (https://github.com/devanlai/webdfu), used under the ISC licence:
 *
 * Copyright (c) 2016, Devan Lai
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or
 * without fee is hereby granted, provided that the above copyright notice and this permission
 * notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
 * SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
 * AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
 * NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
 * OF THIS SOFTWARE.
 *
 * The control-transfer sequence, timings, parsing and messages match upstream; see
 * docs/audit/dfu-loader.md for the few deliberate differences.
 */

/** DFU class requests (bRequest). */
export const DfuRequest = {
  DETACH: 0x00,
  DNLOAD: 0x01,
  UPLOAD: 0x02,
  GETSTATUS: 0x03,
  CLRSTATUS: 0x04,
  GETSTATE: 0x05,
  ABORT: 6
} as const

/** DFU device states (bState). */
export const DfuState = {
  appIDLE: 0,
  appDETACH: 1,
  dfuIDLE: 2,
  dfuDNLOAD_SYNC: 3,
  dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6,
  dfuMANIFEST: 7,
  dfuMANIFEST_WAIT_RESET: 8,
  dfuUPLOAD_IDLE: 9,
  dfuERROR: 10
} as const

export const STATUS_OK = 0x0

/**
 * An error raised by the DFU code. Upstream throws plain strings; this keeps their text as the
 * string form, so `String(error)` and `'prefix: ' + error` read exactly as upstream's do.
 */
export class DfuError extends Error {
  override name = 'DfuError'
  override toString(): string {
    return this.message
  }
}

/** One DFU interface alternate setting of a device (upstream's `settings` object). */
export interface DfuInterfaceSettings {
  readonly configuration: USBConfiguration
  readonly interface: USBInterface
  readonly alternate: USBAlternateInterface
  /** The interface name string; null when the browser could not read it. */
  readonly name: string | null
}

/** Reply to DFU_GETSTATUS. */
export interface DfuStatus {
  readonly status: number
  readonly pollTimeout: number
  readonly state: number
}

/** Messages the DFU code reports while it works (upstream's `logDebug` ... `logProgress`). */
export type DfuLogEvent =
  | { readonly kind: 'debug' | 'info' | 'warning' | 'error'; readonly message: string }
  | { readonly kind: 'progress'; readonly done: number; readonly total: number | undefined }

/** Upstream's default log methods: debug is dropped, the rest go to the console. */
export function consoleLog(event: DfuLogEvent): void {
  switch (event.kind) {
    case 'debug':
      return
    case 'progress':
      console.log(event.total === undefined ? event.done : `${event.done}/${event.total}`)
      return
    default:
      console.log(event.message)
  }
}

export type FirmwareData = ArrayBuffer | Uint8Array<ArrayBuffer>

export function findDeviceDfuInterfaces(device: USBDevice): DfuInterfaceSettings[] {
  const interfaces: DfuInterfaceSettings[] = []
  for (const conf of device.configurations) {
    for (const intf of conf.interfaces) {
      for (const alt of intf.alternates) {
        if (
          alt.interfaceClass === 0xfe &&
          alt.interfaceSubclass === 0x01 &&
          (alt.interfaceProtocol === 0x01 || alt.interfaceProtocol === 0x02)
        ) {
          interfaces.push({ configuration: conf, interface: intf, alternate: alt, name: alt.interfaceName })
        }
      }
    }
  }
  return interfaces
}

export async function findAllDfuInterfaces(usb: USB): Promise<DfuDevice[]> {
  const devices = await usb.getDevices()
  const matches: DfuDevice[] = []
  for (const device of devices) {
    for (const settings of findDeviceDfuInterfaces(device)) matches.push(new DfuDevice(device, settings))
  }
  return matches
}

// ---------------------------------------------------------------------------------------------
// Descriptor parsing

export interface DeviceDescriptor {
  readonly bLength: number
  readonly bDescriptorType: number
  readonly bcdUSB: number
  readonly bDeviceClass: number
  readonly bDeviceSubClass: number
  readonly bDeviceProtocol: number
  readonly bMaxPacketSize: number
  readonly idVendor: number
  readonly idProduct: number
  readonly bcdDevice: number
  readonly iManufacturer: number
  readonly iProduct: number
  readonly iSerialNumber: number
  readonly bNumConfigurations: number
}

export interface InterfaceDescriptor {
  readonly kind: 'interface'
  readonly bLength: number
  readonly bDescriptorType: number
  readonly bInterfaceNumber: number
  readonly bAlternateSetting: number
  readonly bNumEndpoints: number
  readonly bInterfaceClass: number
  readonly bInterfaceSubClass: number
  readonly bInterfaceProtocol: number
  readonly iInterface: number
  /** Descriptors that follow this interface descriptor. */
  readonly descriptors: SubDescriptor[]
}

export interface FunctionalDescriptor {
  readonly kind: 'functional'
  readonly bLength: number
  readonly bDescriptorType: number
  readonly bmAttributes: number
  readonly wDetachTimeOut: number
  readonly wTransferSize: number
  readonly bcdDFUVersion: number
}

export interface OtherDescriptor {
  readonly kind: 'other'
  readonly bLength: number
  readonly bDescriptorType: number
  readonly data: DataView
}

export type SubDescriptor = InterfaceDescriptor | FunctionalDescriptor | OtherDescriptor

export interface ConfigurationDescriptor {
  readonly bLength: number
  readonly bDescriptorType: number
  readonly wTotalLength: number
  readonly bNumInterfaces: number
  readonly bConfigurationValue: number
  readonly iConfiguration: number
  readonly bmAttributes: number
  readonly bMaxPower: number
  readonly descriptors: readonly SubDescriptor[]
}

export function parseDeviceDescriptor(data: DataView): DeviceDescriptor {
  return {
    bLength: data.getUint8(0),
    bDescriptorType: data.getUint8(1),
    bcdUSB: data.getUint16(2, true),
    bDeviceClass: data.getUint8(4),
    bDeviceSubClass: data.getUint8(5),
    bDeviceProtocol: data.getUint8(6),
    bMaxPacketSize: data.getUint8(7),
    idVendor: data.getUint16(8, true),
    idProduct: data.getUint16(10, true),
    bcdDevice: data.getUint16(12, true),
    iManufacturer: data.getUint8(14),
    iProduct: data.getUint8(15),
    iSerialNumber: data.getUint8(16),
    bNumConfigurations: data.getUint8(17)
  }
}

export function parseConfigurationDescriptor(data: DataView): ConfigurationDescriptor {
  // Upstream slices the underlying buffer (ignoring the view's offset); WebUSB views start at 0.
  const descriptorData = new DataView(data.buffer.slice(9))
  const descriptors = parseSubDescriptors(descriptorData)
  return {
    bLength: data.getUint8(0),
    bDescriptorType: data.getUint8(1),
    wTotalLength: data.getUint16(2, true),
    bNumInterfaces: data.getUint8(4),
    bConfigurationValue: data.getUint8(5),
    iConfiguration: data.getUint8(6),
    bmAttributes: data.getUint8(7),
    bMaxPower: data.getUint8(8),
    descriptors
  }
}

export function parseInterfaceDescriptor(data: DataView): InterfaceDescriptor {
  return {
    kind: 'interface',
    bLength: data.getUint8(0),
    bDescriptorType: data.getUint8(1),
    bInterfaceNumber: data.getUint8(2),
    bAlternateSetting: data.getUint8(3),
    bNumEndpoints: data.getUint8(4),
    bInterfaceClass: data.getUint8(5),
    bInterfaceSubClass: data.getUint8(6),
    bInterfaceProtocol: data.getUint8(7),
    iInterface: data.getUint8(8),
    descriptors: []
  }
}

export function parseFunctionalDescriptor(data: DataView): FunctionalDescriptor {
  return {
    kind: 'functional',
    bLength: data.getUint8(0),
    bDescriptorType: data.getUint8(1),
    bmAttributes: data.getUint8(2),
    wDetachTimeOut: data.getUint16(3, true),
    wTransferSize: data.getUint16(5, true),
    bcdDFUVersion: data.getUint16(7, true)
  }
}

export function parseSubDescriptors(descriptorData: DataView): SubDescriptor[] {
  const DT_INTERFACE = 4
  const DT_DFU_FUNCTIONAL = 0x21
  const USB_CLASS_APP_SPECIFIC = 0xfe
  const USB_SUBCLASS_DFU = 0x01
  let remainingData = descriptorData
  const descriptors: SubDescriptor[] = []
  let currIntf: InterfaceDescriptor | undefined
  let inDfuIntf = false
  while (remainingData.byteLength > 2) {
    const bLength = remainingData.getUint8(0)
    const bDescriptorType = remainingData.getUint8(1)
    // Upstream loops forever on a zero-length descriptor; stop with an error instead.
    if (bLength === 0) throw new DfuError('Malformed configuration descriptor: zero-length descriptor')
    const descData = new DataView(remainingData.buffer.slice(0, bLength))
    if (bDescriptorType === DT_INTERFACE) {
      currIntf = parseInterfaceDescriptor(descData)
      inDfuIntf = currIntf.bInterfaceClass === USB_CLASS_APP_SPECIFIC && currIntf.bInterfaceSubClass === USB_SUBCLASS_DFU
      descriptors.push(currIntf)
    } else if (inDfuIntf && currIntf !== undefined && bDescriptorType === DT_DFU_FUNCTIONAL) {
      const funcDesc = parseFunctionalDescriptor(descData)
      descriptors.push(funcDesc)
      currIntf.descriptors.push(funcDesc)
    } else {
      const desc: OtherDescriptor = { kind: 'other', bLength, bDescriptorType, data: descData }
      descriptors.push(desc)
      currIntf?.descriptors.push(desc)
    }
    remainingData = new DataView(remainingData.buffer.slice(bLength))
  }
  return descriptors
}

/** Interface name strings by configuration value, interface number and alternate setting. */
export type InterfaceNameMap = ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string | null | undefined>>>

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

// ---------------------------------------------------------------------------------------------
// Device

/** A DFU interface of a USB device (upstream `dfu.Device`). */
export class DfuDevice {
  readonly intfNumber: number
  /** Set once the device has been seen to disconnect. */
  disconnected = false
  /** Receives everything the device reports while it works. */
  onLog: (event: DfuLogEvent) => void = consoleLog

  constructor(
    readonly usbDevice: USBDevice,
    readonly settings: DfuInterfaceSettings
  ) {
    this.intfNumber = settings.interface.interfaceNumber
  }

  protected logDebug(message: string): void {
    this.onLog({ kind: 'debug', message })
  }
  logInfo(message: string): void {
    this.onLog({ kind: 'info', message })
  }
  logWarning(message: string): void {
    this.onLog({ kind: 'warning', message })
  }
  logError(message: string): void {
    this.onLog({ kind: 'error', message })
  }
  protected logProgress(done: number, total?: number): void {
    this.onLog({ kind: 'progress', done, total })
  }

  async open(): Promise<void> {
    await this.usbDevice.open()
    const confValue = this.settings.configuration.configurationValue
    if (this.usbDevice.configuration === null || this.usbDevice.configuration.configurationValue !== confValue) {
      await this.usbDevice.selectConfiguration(confValue)
    }

    const intfNumber = this.settings.interface.interfaceNumber
    if (!this.activeInterface(intfNumber).claimed) {
      await this.usbDevice.claimInterface(intfNumber)
    }

    const altSetting = this.settings.alternate.alternateSetting
    const intf = this.activeInterface(intfNumber)
    const alternate = currentAlternate(intf)
    if (alternate === null || alternate.alternateSetting !== altSetting || intf.alternates.length > 1) {
      try {
        await this.usbDevice.selectAlternateInterface(intfNumber, altSetting)
      } catch (error) {
        // Upstream tolerates a failed redundant SET_INTERFACE only when the error is a string,
        // which WebUSB never raises (it raises a DOMException), so in practice it always fails.
        if (
          alternate?.alternateSetting === altSetting &&
          typeof error === 'string' &&
          error.endsWith('Unable to set device interface.')
        ) {
          this.logWarning(`Redundant SET_INTERFACE request to select altSetting ${altSetting} failed`)
        } else {
          throw error
        }
      }
    }
  }

  /** `device.configuration.interfaces[intfNumber]`, which upstream indexes by interface number. */
  private activeInterface(intfNumber: number): USBInterface {
    const intf = this.usbDevice.configuration?.interfaces[intfNumber]
    if (intf === undefined) throw new DfuError(`Interface ${intfNumber} not found in the active configuration`)
    return intf
  }

  async close(): Promise<void> {
    try {
      await this.usbDevice.close()
    } catch (error) {
      console.log(error)
    }
  }

  async readDeviceDescriptor(): Promise<DataView> {
    const GET_DESCRIPTOR = 0x06
    const DT_DEVICE = 0x01
    const wValue = DT_DEVICE << 8
    const result = await this.usbDevice.controlTransferIn(
      { requestType: 'standard', recipient: 'device', request: GET_DESCRIPTOR, value: wValue, index: 0 },
      18
    )
    if (result.status === 'ok') return dataOf(result)
    throw new DfuError(result.status)
  }

  /** Reads string descriptor `index`; with langID 0 returns the language ID list instead. */
  async readStringDescriptor(index: number, langID: number): Promise<string>
  async readStringDescriptor(index: number, langID?: 0): Promise<number[]>
  async readStringDescriptor(index: number, langID = 0): Promise<string | number[]> {
    const GET_DESCRIPTOR = 0x06
    const DT_STRING = 0x03
    const wValue = (DT_STRING << 8) | index
    const requestSetup: USBControlTransferParameters = {
      requestType: 'standard',
      recipient: 'device',
      request: GET_DESCRIPTOR,
      value: wValue,
      index: langID
    }

    // Read enough for bLength
    let result = await this.usbDevice.controlTransferIn(requestSetup, 1)
    if (result.status === 'ok') {
      // Retrieve the full descriptor
      const bLength = dataOf(result).getUint8(0)
      result = await this.usbDevice.controlTransferIn(requestSetup, bLength)
      if (result.status === 'ok') {
        const data = dataOf(result)
        const len = (bLength - 2) / 2
        const u16Words: number[] = []
        for (let i = 0; i < len; i++) u16Words.push(data.getUint16(2 + i * 2, true))
        // langID 0 asks for the langID array; otherwise decode from UCS-2 into a string
        return langID === 0 ? u16Words : String.fromCharCode(...u16Words)
      }
    }
    throw new DfuError(`Failed to read string descriptor ${index}: ${result.status}`)
  }

  async readInterfaceNames(): Promise<InterfaceNameMap> {
    const DT_INTERFACE = 4

    const configs = new Map<number, Map<number, Map<number, number>>>()
    const allStringIndices = new Set<number>()
    for (let configIndex = 0; configIndex < this.usbDevice.configurations.length; configIndex++) {
      const rawConfig = await this.readConfigurationDescriptor(configIndex)
      const configDesc = parseConfigurationDescriptor(rawConfig)
      const config = new Map<number, Map<number, number>>()
      configs.set(configDesc.bConfigurationValue, config)

      // Retrieve string indices for interface names
      for (const desc of configDesc.descriptors) {
        if (desc.bDescriptorType === DT_INTERFACE && desc.kind === 'interface') {
          let alternates = config.get(desc.bInterfaceNumber)
          if (alternates === undefined) {
            alternates = new Map()
            config.set(desc.bInterfaceNumber, alternates)
          }
          alternates.set(desc.bAlternateSetting, desc.iInterface)
          if (desc.iInterface > 0) allStringIndices.add(desc.iInterface)
        }
      }
    }

    const strings = new Map<number, string | null>()
    // Retrieve interface name strings
    for (const index of allStringIndices) {
      try {
        strings.set(index, await this.readStringDescriptor(index, 0x0409))
      } catch (error) {
        console.log(error)
        strings.set(index, null)
      }
    }

    // String index 0 (no name) maps to undefined, as upstream's `strings[0]` does.
    // Upstream iterates its configs object with for...in, i.e. in ascending numeric key order.
    const byNumber = <V>(map: Map<number, V>) => [...map.entries()].sort((a, b) => a[0] - b[0])
    return new Map(
      byNumber(configs).map(([configValue, config]) => [
        configValue,
        new Map(
          byNumber(config).map(([intfNumber, alternates]) => [
            intfNumber,
            new Map(byNumber(alternates).map(([alt, iIndex]) => [alt, strings.get(iIndex)]))
          ])
        )
      ])
    )
  }

  async readConfigurationDescriptor(index: number): Promise<DataView> {
    const GET_DESCRIPTOR = 0x06
    const DT_CONFIGURATION = 0x02
    const wValue = (DT_CONFIGURATION << 8) | index
    const setup: USBControlTransferParameters = {
      requestType: 'standard',
      recipient: 'device',
      request: GET_DESCRIPTOR,
      value: wValue,
      index: 0
    }

    const header = await this.usbDevice.controlTransferIn(setup, 4)
    if (header.status !== 'ok') throw new DfuError(header.status)
    // Read out length of the configuration descriptor
    const wLength = dataOf(header).getUint16(2, true)
    const result = await this.usbDevice.controlTransferIn(setup, wLength)
    if (result.status !== 'ok') throw new DfuError(result.status)
    return dataOf(result)
  }

  async requestOut(bRequest: number, data?: BufferSource, wValue = 0): Promise<number> {
    let result: USBOutTransferResult
    try {
      result = await this.usbDevice.controlTransferOut(
        { requestType: 'class', recipient: 'interface', request: bRequest, value: wValue, index: this.intfNumber },
        data
      )
    } catch (error) {
      throw new DfuError(`ControlTransferOut failed: ${String(error)}`)
    }
    if (result.status === 'ok') return result.bytesWritten
    throw new DfuError(result.status)
  }

  async requestIn(bRequest: number, wLength: number, wValue = 0): Promise<DataView> {
    let result: USBInTransferResult
    try {
      result = await this.usbDevice.controlTransferIn(
        { requestType: 'class', recipient: 'interface', request: bRequest, value: wValue, index: this.intfNumber },
        wLength
      )
    } catch (error) {
      throw new DfuError(`ControlTransferIn failed: ${String(error)}`)
    }
    if (result.status === 'ok') return dataOf(result)
    throw new DfuError(result.status)
  }

  detach(): Promise<number> {
    return this.requestOut(DfuRequest.DETACH, undefined, 1000)
  }

  /**
   * Resolves when `usb` reports this device disconnected; rejects after `timeout` ms (if > 0).
   *
   * Reproduced upstream bug: upstream writes an `onTimeout` handler (remove the listener, reject
   * with "Disconnect timeout expired") but passes `reject` itself to `setTimeout`. So a timeout
   * rejects with no reason and the listener stays attached until this device disconnects.
   */
  waitDisconnected(timeout: number, usb: USB = navigator.usb): Promise<this> {
    return new Promise((resolve, reject) => {
      let timeoutID: ReturnType<typeof setTimeout> | undefined
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- reproduces upstream's reasonless rejection
      if (timeout > 0) timeoutID = setTimeout(() => reject(), timeout)
      const onDisconnect = (event: USBConnectionEvent) => {
        if (event.device === this.usbDevice) {
          if (timeout > 0) clearTimeout(timeoutID)
          this.disconnected = true
          usb.removeEventListener('disconnect', onDisconnect)
          event.stopPropagation()
          resolve(this)
        }
      }
      usb.addEventListener('disconnect', onDisconnect)
    })
  }

  download(data: BufferSource, blockNum: number): Promise<number> {
    return this.requestOut(DfuRequest.DNLOAD, data, blockNum)
  }

  upload(length: number, blockNum: number): Promise<DataView> {
    return this.requestIn(DfuRequest.UPLOAD, length, blockNum)
  }

  clearStatus(): Promise<number> {
    return this.requestOut(DfuRequest.CLRSTATUS)
  }

  async getStatus(): Promise<DfuStatus> {
    let data: DataView
    try {
      data = await this.requestIn(DfuRequest.GETSTATUS, 6)
    } catch (error) {
      throw new DfuError(`DFU GETSTATUS failed: ${String(error)}`)
    }
    return { status: data.getUint8(0), pollTimeout: data.getUint32(1, true) & 0xffffff, state: data.getUint8(4) }
  }

  async getState(): Promise<number> {
    let data: DataView
    try {
      data = await this.requestIn(DfuRequest.GETSTATE, 1)
    } catch (error) {
      throw new DfuError(`DFU GETSTATE failed: ${String(error)}`)
    }
    return data.getUint8(0)
  }

  abort(): Promise<number> {
    return this.requestOut(DfuRequest.ABORT)
  }

  async abortToIdle(): Promise<void> {
    await this.abort()
    let state = await this.getState()
    if (state === DfuState.dfuERROR) {
      await this.clearStatus()
      state = await this.getState()
    }
    if (state !== DfuState.dfuIDLE) {
      // Reproduced upstream bug: it prints `state.state` of a number, which is always undefined.
      throw new DfuError('Failed to return to idle state after abort: state undefined')
    }
  }

  /** Reads up to `maxSize` bytes in `xferSize` blocks, numbering blocks from `firstBlock` (do_upload). */
  async doUpload(xferSize: number, maxSize = Infinity, firstBlock = 0): Promise<Blob> {
    let transaction = firstBlock
    const blocks: Uint8Array<ArrayBuffer>[] = []
    let bytesRead = 0

    this.logInfo('Copying data from DFU device to browser')
    // Initialize progress to 0
    this.logProgress(0)

    let result: DataView
    let bytesToRead: number
    do {
      bytesToRead = Math.min(xferSize, maxSize - bytesRead)
      result = await this.upload(bytesToRead, transaction++)
      this.logDebug(`Read ${result.byteLength} bytes`)
      if (result.byteLength > 0) {
        blocks.push(new Uint8Array(result.buffer, result.byteOffset, result.byteLength).slice())
        bytesRead += result.byteLength
      }
      if (Number.isFinite(maxSize)) {
        this.logProgress(bytesRead, maxSize)
      } else {
        this.logProgress(bytesRead)
      }
    } while (bytesRead < maxSize && result.byteLength === bytesToRead)

    if (bytesRead === maxSize) await this.abortToIdle()

    this.logInfo(`Read ${bytesRead} bytes`)

    return new Blob(blocks, { type: 'application/octet-stream' })
  }

  /** Polls GETSTATUS, sleeping bwPollTimeout between polls, until `statePredicate` or dfuERROR (poll_until). */
  async pollUntil(statePredicate: (state: number) => boolean): Promise<DfuStatus> {
    let dfuStatus = await this.getStatus()
    while (!statePredicate(dfuStatus.state) && dfuStatus.state !== DfuState.dfuERROR) {
      this.logDebug(`Sleeping for ${dfuStatus.pollTimeout}ms`)
      await sleep(dfuStatus.pollTimeout)
      dfuStatus = await this.getStatus()
    }
    return dfuStatus
  }

  pollUntilIdle(idleState: number): Promise<DfuStatus> {
    return this.pollUntil((state) => state === idleState)
  }

  /**
   * Writes `data` in `xferSize` blocks, then sends the empty block that starts manifestation
   * (do_download). Upstream also takes a manifestationTolerant flag that it never uses.
   */
  async doDownload(xferSize: number, data: FirmwareData): Promise<void> {
    let bytesSent = 0
    const expectedSize = data.byteLength
    let transaction = 0

    this.logInfo('Copying data from browser to DFU device')

    // Initialize progress to 0
    this.logProgress(bytesSent, expectedSize)

    while (bytesSent < expectedSize) {
      const bytesLeft = expectedSize - bytesSent
      const chunkSize = Math.min(bytesLeft, xferSize)

      let bytesWritten = 0
      let dfuStatus: DfuStatus
      try {
        bytesWritten = await this.download(data.slice(bytesSent, bytesSent + chunkSize), transaction++)
        this.logDebug(`Sent ${bytesWritten} bytes`)
        dfuStatus = await this.pollUntilIdle(DfuState.dfuDNLOAD_IDLE)
      } catch (error) {
        throw new DfuError(`Error during DFU download: ${String(error)}`)
      }

      if (dfuStatus.status !== STATUS_OK) {
        throw new DfuError(`DFU DOWNLOAD failed state=${dfuStatus.state}, status=${dfuStatus.status}`)
      }

      this.logDebug(`Wrote ${bytesWritten} bytes`)
      bytesSent += bytesWritten

      this.logProgress(bytesSent, expectedSize)
    }

    this.logDebug('Sending empty block')
    try {
      await this.download(new ArrayBuffer(0), transaction++)
    } catch (error) {
      throw new DfuError(`Error during final DFU download: ${String(error)}`)
    }

    this.logInfo(`Wrote ${bytesSent} bytes`)
  }
}

/**
 * The interface's active alternate setting. @types/w3c-web-usb types it as non-null, but Chromium
 * declares it nullable (`USBAlternateInterface? alternate`) and upstream checks for null.
 */
function currentAlternate(intf: USBInterface): USBAlternateInterface | null {
  return intf.alternate
}

/** The data of a successful IN transfer (WebUSB always supplies it when the status is ok). */
function dataOf(result: USBInTransferResult): DataView {
  return result.data ?? new DataView(new ArrayBuffer(0))
}
