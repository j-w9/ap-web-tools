// Test-only: a scripted WebUSB device that simulates a DFU / DfuSe bootloader closely enough to
// drive upstream webdfu and the port through identical control-transfer sequences, and records
// every call so the two sequences can be compared.

export type UsbCall =
  | {
      readonly op: 'in'
      readonly requestType: string
      readonly recipient: string
      readonly request: number
      readonly value: number
      readonly index: number
      readonly length: number
    }
  | {
      readonly op: 'out'
      readonly requestType: string
      readonly recipient: string
      readonly request: number
      readonly value: number
      readonly index: number
      readonly data: number[] | null
    }
  | { readonly op: 'open' | 'close' }
  | { readonly op: 'selectConfiguration'; readonly value: number }
  | { readonly op: 'claimInterface'; readonly interfaceNumber: number }
  | { readonly op: 'selectAlternateInterface'; readonly interfaceNumber: number; readonly alternateSetting: number }

export interface FakeAlternate {
  readonly alternateSetting: number
  /** Interface name the browser reports; null when it could not read it. */
  readonly interfaceName: string | null
  /** Interface name in the string descriptors (defaults to interfaceName). */
  readonly descriptorName?: string
  readonly interfaceProtocol?: number
  readonly interfaceClass?: number
}

export interface FakeOptions {
  readonly alternates: readonly FakeAlternate[]
  readonly vendorId?: number
  readonly productId?: number
  readonly productName?: string
  readonly manufacturerName?: string
  readonly serialNumber?: string
  readonly interfaceNumber?: number
  readonly configurationValue?: number
  /** Functional descriptor attributes (bitCanDnload 1, bitCanUpload 2, bitManifestationTolerant 4, bitWillDetach 8). */
  readonly bmAttributes?: number
  readonly transferSize?: number
  readonly detachTimeout?: number
  readonly dfuVersion?: number
  /** Omit the functional descriptor entirely. */
  readonly noFunctionalDescriptor?: boolean
  /** bwPollTimeout reported while busy. */
  readonly pollTimeout?: number
  readonly initialState?: number
  /** The nth GETSTATUS (1-based) reports this error status and dfuERROR. */
  readonly failGetStatus?: { readonly at: number; readonly status: number }
  /** State after DFU_ABORT (default dfuIDLE). */
  readonly abortState?: number
  /** State after DFU_CLRSTATUS (default dfuIDLE). */
  readonly clearState?: number
  /** Transfers for which the device stalls. */
  readonly stall?: (call: UsbCall, index: number) => boolean
  /** Transfers that fail with an exception (as a DOMException would). */
  readonly throwOn?: (call: UsbCall, index: number) => boolean
  /** Device ends DfuSe/plain manifestation in this state when polled (default dfuMANIFEST). */
  readonly manifestState?: number
  /** Bytes readable by UPLOAD in plain DFU mode. */
  readonly uploadImageSize?: number
  /** End of readable memory for DfuSe uploads. */
  readonly memoryEnd?: number
}

const STATE = {
  dfuIDLE: 2,
  dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6,
  dfuMANIFEST: 7,
  dfuUPLOAD_IDLE: 9,
  dfuERROR: 10
}

function bytesOf(data: unknown): number[] | null {
  if (data === undefined || data === null) return null
  if (ArrayBuffer.isView(data)) return Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  return Array.from(new Uint8Array(data as ArrayBuffer))
}

function view(bytes: readonly number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer)
}

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff]
}

export class FakeUsbDevice {
  readonly calls: UsbCall[] = []
  readonly vendorId: number
  readonly productId: number
  readonly productName: string
  readonly manufacturerName: string
  readonly serialNumber: string
  readonly configurations: {
    configurationValue: number
    interfaces: {
      interfaceNumber: number
      alternates: Record<string, unknown>[]
      alternate: Record<string, unknown>
      claimed: boolean
    }[]
  }[]
  configuration: FakeUsbDevice['configurations'][number] | null = null
  opened = false

  /** Simulated device memory (DfuSe address or plain-DFU offset -> byte). */
  readonly memory = new Map<number, number>()
  readonly erased: number[] = []
  private state: number
  private status = 0
  private pointer = 0
  private busy: 'command' | 'download' | 'manifest' | null = null
  private getStatusCount = 0

  constructor(private readonly options: FakeOptions) {
    this.vendorId = options.vendorId ?? 0x0483
    this.productId = options.productId ?? 0xdf11
    this.productName = options.productName ?? 'STM32  BOOTLOADER'
    this.manufacturerName = options.manufacturerName ?? 'STMicroelectronics'
    this.serialNumber = options.serialNumber ?? '336C34653033'
    this.state = options.initialState ?? STATE.dfuIDLE
    const alternates = options.alternates.map((a) => ({
      alternateSetting: a.alternateSetting,
      interfaceClass: a.interfaceClass ?? 0xfe,
      interfaceSubclass: 0x01,
      interfaceProtocol: a.interfaceProtocol ?? 0x02,
      interfaceName: a.interfaceName,
      endpoints: []
    }))
    this.configurations = [
      {
        configurationValue: options.configurationValue ?? 1,
        interfaces: [{ interfaceNumber: options.interfaceNumber ?? 0, alternates, alternate: alternates[0]!, claimed: false }]
      }
    ]
  }

  /** This fake typed as the WebUSB device it stands in for. */
  get usb(): USBDevice {
    return this as unknown as USBDevice
  }

  private transferSize(): number {
    return this.options.transferSize ?? 1024
  }

  configDescriptor(): number[] {
    const body: number[] = []
    const intfNumber = this.options.interfaceNumber ?? 0
    this.options.alternates.forEach((a, i) => {
      body.push(9, 4, intfNumber, a.alternateSetting, 0, a.interfaceClass ?? 0xfe, 1, a.interfaceProtocol ?? 2, i + 4)
      if (!this.options.noFunctionalDescriptor) {
        body.push(
          9,
          0x21,
          this.options.bmAttributes ?? 0x0b,
          ...u16(this.options.detachTimeout ?? 255),
          ...u16(this.transferSize()),
          ...u16(this.options.dfuVersion ?? 0x011a)
        )
      }
    })
    const total = 9 + body.length
    return [9, 2, ...u16(total), 1, this.options.configurationValue ?? 1, 0, 0xc0, 0x32, ...body]
  }

  private stringDescriptor(index: number, langID: number): number[] {
    if (langID === 0) return [4, 3, 0x09, 0x04]
    const alt = this.options.alternates[index - 4]
    const name = alt?.descriptorName ?? alt?.interfaceName ?? ''
    const words: number[] = []
    for (const ch of name) words.push(...u16(ch.charCodeAt(0)))
    return [2 + words.length, 3, ...words]
  }

  private record(call: UsbCall): number {
    this.calls.push(call)
    const index = this.calls.length - 1
    if (this.options.throwOn?.(call, index)) throw new Error('NetworkError: A transfer error has occurred.')
    return index
  }

  open(): Promise<void> {
    this.record({ op: 'open' })
    this.opened = true
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.record({ op: 'close' })
    this.opened = false
    this.configuration = null
    for (const intf of this.configurations[0]!.interfaces) intf.claimed = false
    return Promise.resolve()
  }
  selectConfiguration(value: number): Promise<void> {
    this.record({ op: 'selectConfiguration', value })
    this.configuration = this.configurations.find((c) => c.configurationValue === value) ?? null
    return Promise.resolve()
  }
  claimInterface(interfaceNumber: number): Promise<void> {
    this.record({ op: 'claimInterface', interfaceNumber })
    const intf = this.configuration?.interfaces.find((i) => i.interfaceNumber === interfaceNumber)
    if (intf) intf.claimed = true
    return Promise.resolve()
  }
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void> {
    this.record({ op: 'selectAlternateInterface', interfaceNumber, alternateSetting })
    const intf = this.configuration?.interfaces.find((i) => i.interfaceNumber === interfaceNumber)
    const alt = intf?.alternates.find((a) => a['alternateSetting'] === alternateSetting)
    if (intf && alt) intf.alternate = alt
    return Promise.resolve()
  }

  controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<{ status: string; data?: DataView }> {
    try {
      const call: UsbCall = { op: 'in', ...pick(setup), length }
      const index = this.record(call)
      if (this.options.stall?.(call, index)) return Promise.resolve({ status: 'stall' })
      return Promise.resolve({ status: 'ok', data: view(this.replyIn(setup, length)) })
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  controlTransferOut(
    setup: USBControlTransferParameters,
    data?: BufferSource
  ): Promise<{ status: string; bytesWritten: number }> {
    try {
      const bytes = bytesOf(data)
      const call: UsbCall = { op: 'out', ...pick(setup), data: bytes }
      const index = this.record(call)
      if (this.options.stall?.(call, index)) return Promise.resolve({ status: 'stall', bytesWritten: 0 })
      this.handleOut(setup, bytes ?? [])
      return Promise.resolve({ status: 'ok', bytesWritten: bytes?.length ?? 0 })
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private replyIn(setup: USBControlTransferParameters, length: number): number[] {
    if (setup.requestType === 'standard') {
      const type = setup.value >> 8
      const all = type === 2 ? this.configDescriptor() : type === 3 ? this.stringDescriptor(setup.value & 0xff, setup.index) : []
      return all.slice(0, length)
    }
    switch (setup.request) {
      case 0x03: {
        // GETSTATUS
        this.getStatusCount++
        const fail = this.options.failGetStatus
        if (fail && fail.at === this.getStatusCount) {
          this.state = STATE.dfuERROR
          this.status = fail.status
          this.busy = null
        } else if (this.busy !== null) {
          const pollTimeout = this.options.pollTimeout ?? 0
          if (this.state !== STATE.dfuDNBUSY && this.busy !== 'manifest') {
            this.state = STATE.dfuDNBUSY
            return [this.status, ...u16(pollTimeout), 0, this.state, 0]
          }
          if (this.busy === 'manifest') {
            this.state = this.options.manifestState ?? STATE.dfuMANIFEST
          } else {
            this.state = STATE.dfuDNLOAD_IDLE
          }
          this.busy = null
        }
        const pt = this.options.pollTimeout ?? 0
        return [this.status, ...u16(pt), 0, this.state, 0].slice(0, length)
      }
      case 0x05:
        return [this.state].slice(0, length)
      case 0x02: {
        // UPLOAD
        const dfuse = (this.options.dfuVersion ?? 0x011a) === 0x011a
        const start = dfuse ? this.pointer + (setup.value - 2) * length : setup.value * length
        const end = dfuse ? (this.options.memoryEnd ?? 0x08100000) : (this.options.uploadImageSize ?? 3000)
        const n = Math.max(0, Math.min(length, end - start))
        this.state = STATE.dfuUPLOAD_IDLE
        return Array.from({ length: n }, (_, i) => this.memory.get(start + i) ?? (start + i) & 0xff)
      }
      default:
        return []
    }
  }

  private handleOut(setup: USBControlTransferParameters, data: number[]): void {
    if (setup.requestType !== 'class') return
    switch (setup.request) {
      case 0x01: {
        // DNLOAD
        const dfuse = (this.options.dfuVersion ?? 0x011a) === 0x011a
        if (data.length === 0) {
          this.busy = 'manifest'
          this.state = STATE.dfuMANIFEST_SYNC
          return
        }
        if (dfuse && setup.value === 0) {
          const arg = data.length === 5 ? (data[1]! | (data[2]! << 8) | (data[3]! << 16) | (data[4]! << 24)) >>> 0 : null
          if (data[0] === 0x21 && arg !== null) this.pointer = arg
          if (data[0] === 0x41 && arg !== null) this.erased.push(arg)
          this.busy = 'command'
        } else {
          const base = dfuse ? this.pointer + (setup.value - 2) * this.transferSize() : setup.value * this.transferSize()
          data.forEach((b, i) => this.memory.set(base + i, b))
          this.busy = 'download'
        }
        this.state = 3 // dfuDNLOAD_SYNC
        return
      }
      case 0x04:
        this.state = this.options.clearState ?? STATE.dfuIDLE
        this.status = 0
        return
      case 0x06:
        this.state = this.options.abortState ?? STATE.dfuIDLE
        return
      default:
        return
    }
  }
}

function pick(setup: USBControlTransferParameters) {
  return {
    requestType: setup.requestType,
    recipient: setup.recipient,
    request: setup.request,
    value: setup.value,
    index: setup.index
  }
}

/** A fake `navigator.usb`: an EventTarget that hands out the given devices. */
export class FakeUsb extends EventTarget {
  requested: unknown[] = []
  constructor(
    private readonly devices: readonly FakeUsbDevice[],
    private readonly chooserError?: Error
  ) {
    super()
  }
  get usb(): USB {
    return this as unknown as USB
  }
  getDevices(): Promise<USBDevice[]> {
    return Promise.resolve(this.devices.map((d) => d.usb))
  }
  requestDevice(options: unknown): Promise<USBDevice> {
    this.requested.push(JSON.parse(JSON.stringify(options)))
    const [first] = this.devices
    if (this.chooserError !== undefined || first === undefined) {
      return Promise.reject(this.chooserError ?? new Error('NotFoundError: No device selected.'))
    }
    return Promise.resolve(first.usb)
  }
  disconnect(device: FakeUsbDevice): void {
    this.dispatchEvent(Object.assign(new Event('disconnect'), { device: device.usb }))
  }
}

/** Waits until no USB call has been made for a while (all async work has settled). */
export async function settle(...devices: readonly FakeUsbDevice[]): Promise<void> {
  let last = -1
  for (;;) {
    const count = devices.reduce((n, d) => n + d.calls.length, 0)
    if (count === last) return
    last = count
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}
