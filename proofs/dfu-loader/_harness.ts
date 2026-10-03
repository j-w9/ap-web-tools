// Proof harness for DFU Loader, adapted from apps/dfu-loader's oracle loader (test-utils/upstream.ts,
// fake-usb.ts, hex.ts): runs upstream/DFULoader (dfu.js, dfuse.js, dfu-util.js) in node:vm contexts,
// on a minimal fake DOM and a scripted fake DfuSe bootloader.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(here, '../../upstream/DFULoader')
export const readUpstream = (name: string): string => readFileSync(resolve(dir, name), 'utf8')

const quietConsole = { log: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined }

function baseGlobals(usb: unknown) {
  return { console: quietConsole, setTimeout, clearTimeout, Blob, TextDecoder, URLSearchParams, navigator: { usb } }
}

// ---------------------------------------------------------------------------------------------
// Upstream device objects

export interface UpstreamDevice {
  startAddress: number
  disconnected?: boolean
  logProgress: (done: number, total?: number) => void
  logWarning: (msg: string) => void
  open(): Promise<void>
  abortToIdle(): Promise<void>
  erase(startAddr: number, length: number): Promise<void>
  waitDisconnected(timeout: number): Promise<unknown>
}

export interface UpstreamDfu {
  context: Context
  dfu: {
    Device: new (device: unknown, settings: unknown) => UpstreamDevice
    findDeviceDfuInterfaces(device: unknown): unknown[]
  }
  dfuse: { Device: new (device: unknown, settings: unknown) => UpstreamDevice }
}

/** Fresh upstream dfu.js + dfuse.js; `usb` becomes `navigator.usb`. */
export function loadUpstreamDfu(usb?: unknown): UpstreamDfu {
  const context = createContext(baseGlobals(usb))
  const ns = runInContext(`${readUpstream('dfu.js')}\n${readUpstream('dfuse.js')}\n;({ dfu, dfuse })`, context, {
    filename: 'upstream-dfu.js'
  }) as Omit<UpstreamDfu, 'context'>
  return { ...ns, context }
}

/** `parseIntelHex`, cut out of dfu-util.js's page closure. */
export function loadUpstreamParseIntelHex(): (buffer: ArrayBuffer) => Uint8Array {
  const util = readUpstream('dfu-util.js')
  const start = util.indexOf('function parseIntelHex')
  const end = util.indexOf('firmwareFileField.addEventListener', start)
  if (start < 0 || end < 0) throw new Error('parseIntelHex not found in dfu-util.js')
  return runInContext(`${util.slice(start, end)}\n;parseIntelHex`, createContext(baseGlobals(undefined))) as (
    buffer: ArrayBuffer
  ) => Uint8Array
}

// ---------------------------------------------------------------------------------------------
// A scripted DfuSe bootloader (WebUSB device shape)

interface Setup {
  requestType: string
  recipient: string
  request: number
  value: number
  index: number
}

export interface UsbCall {
  op: 'in' | 'out'
  request: number
  value: number
  data?: number[]
}

export interface FakeOptions {
  /** Interface name the browser reports (a DfuSe memory descriptor for STM32 bootloaders). */
  name: string | null
  /** Functional descriptor bmAttributes (CanDnload 1, CanUpload 2, ManifestationTolerant 4, WillDetach 8). */
  bmAttributes?: number
  dfuVersion?: number
  serialNumber?: string
  /** Raw configuration descriptor to return instead of the generated one. */
  configDescriptor?: number[]
  /** bStatus every GETSTATUS reports (default 0 = OK). */
  status?: number
  /** State reported by GETSTATUS / GETSTATE (default dfuDNLOAD_IDLE = 5, dfuIDLE after abort). */
  state?: number
  /** State after DFU_ABORT (default dfuIDLE = 2). */
  abortState?: number
  /** selectAlternateInterface rejects with this value. */
  selectAltError?: unknown
  /** Number of alternate settings on the interface (default 1); all share the same name. */
  alternates?: number
}

const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]

export class FakeDevice {
  readonly calls: UsbCall[] = []
  readonly vendorId = 0x0483
  readonly productId = 0xdf11
  readonly productName = 'STM32  BOOTLOADER'
  readonly manufacturerName = 'STMicroelectronics'
  readonly serialNumber: string
  readonly alternate: Record<string, unknown>
  readonly configurations: { configurationValue: number; interfaces: Record<string, unknown>[] }[]
  configuration: FakeDevice['configurations'][number] | null = null
  private state: number

  constructor(private readonly options: FakeOptions) {
    this.serialNumber = options.serialNumber ?? '336C34653033'
    this.state = options.state ?? 2
    this.alternate = {
      alternateSetting: 0,
      interfaceClass: 0xfe,
      interfaceSubclass: 0x01,
      interfaceProtocol: 0x02,
      interfaceName: options.name,
      endpoints: []
    }
    this.configurations = [
      {
        configurationValue: 1,
        interfaces: [
          {
            interfaceNumber: 0,
            alternates: Array.from({ length: options.alternates ?? 1 }, (_, i) => ({ ...this.alternate, alternateSetting: i })),
            alternate: this.alternate,
            claimed: false
          }
        ]
      }
    ]
  }

  /** The DFU interface settings upstream's `dfu.Device` takes. */
  settings(): unknown {
    const conf = this.configurations[0]!
    return { configuration: conf, interface: conf.interfaces[0], alternate: this.alternate, name: this.options.name }
  }

  private configDescriptor(): number[] {
    if (this.options.configDescriptor) return this.options.configDescriptor
    const body = [
      ...[9, 4, 0, 0, 0, 0xfe, 1, 2, 4],
      ...[9, 0x21, this.options.bmAttributes ?? 0x0b, ...u16(255), ...u16(1024), ...u16(this.options.dfuVersion ?? 0x011a)]
    ]
    return [9, 2, ...u16(9 + body.length), 1, 1, 0, 0xc0, 0x32, ...body]
  }

  open(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    this.configuration = null
    return Promise.resolve()
  }
  selectConfiguration(value: number): Promise<void> {
    this.configuration = this.configurations.find((c) => c.configurationValue === value) ?? null
    return Promise.resolve()
  }
  claimInterface(): Promise<void> {
    return Promise.resolve()
  }
  selectAlternateInterface(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the proof compares string and Error rejections
    if ('selectAltError' in this.options) return Promise.reject(this.options.selectAltError)
    return Promise.resolve()
  }

  controlTransferIn(setup: Setup, length: number): Promise<{ status: string; data: DataView }> {
    this.calls.push({ op: 'in', request: setup.request, value: setup.value })
    let reply: number[] = []
    if (setup.requestType === 'standard') {
      if (setup.value >> 8 === 2) reply = this.configDescriptor()
    } else if (setup.request === 0x03) {
      reply = [this.options.status ?? 0, 0, 0, 0, this.state, 0]
    } else if (setup.request === 0x05) {
      reply = [this.state]
    }
    return Promise.resolve({ status: 'ok', data: new DataView(new Uint8Array(reply.slice(0, length)).buffer) })
  }

  controlTransferOut(setup: Setup, data?: ArrayBuffer | ArrayBufferView): Promise<{ status: string; bytesWritten: number }> {
    const bytes =
      data === undefined
        ? []
        : ArrayBuffer.isView(data)
          ? Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
          : Array.from(new Uint8Array(data))
    this.calls.push({ op: 'out', request: setup.request, value: setup.value, data: bytes })
    // DNLOAD: a data block settles in dfuDNLOAD_IDLE; the zero-length block ends in dfuMANIFEST.
    if (setup.request === 0x01) this.state = bytes.length === 0 ? 7 : (this.options.state ?? 5)
    if (setup.request === 0x06) this.state = this.options.abortState ?? 2 // ABORT
    if (setup.request === 0x04) this.state = 2 // CLRSTATUS
    return Promise.resolve({ status: 'ok', bytesWritten: bytes.length })
  }

  /** DfuSe ERASE_SECTOR commands sent (DNLOAD block 0, command byte 0x41). */
  erases(): number[] {
    return this.calls
      .filter((c) => c.op === 'out' && c.request === 0x01 && c.value === 0 && c.data?.[0] === 0x41)
      .map((c) => {
        const d = c.data ?? []
        return (d[1]! | (d[2]! << 8) | (d[3]! << 16) | (d[4]! << 24)) >>> 0
      })
  }

  /** Firmware DNLOAD blocks sent (block number 2). */
  dataBlocks(): number {
    return this.calls.filter((c) => c.op === 'out' && c.request === 0x01 && c.value === 2).length
  }
}

/** A fake `navigator.usb` that hands out one device and counts `disconnect` listeners. */
export class FakeUsb extends EventTarget {
  disconnectListeners = 0
  constructor(private readonly devices: FakeDevice[]) {
    super()
  }
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type === 'disconnect') this.disconnectListeners++
    super.addEventListener(type, listener)
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (type === 'disconnect') this.disconnectListeners--
    super.removeEventListener(type, listener)
  }
  getDevices(): Promise<FakeDevice[]> {
    return Promise.resolve(this.devices)
  }
  requestDevice(): Promise<FakeDevice> {
    const [first] = this.devices
    return first ? Promise.resolve(first) : Promise.reject(new Error('NotFoundError: No device selected.'))
  }
}

/** Lets every pending promise and zero-delay timer run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5))
}

// ---------------------------------------------------------------------------------------------
// A minimal DOM for dfu-util.js

export class FakeElement {
  /** Upstream assigns errors and other non-strings here too. */
  textContent: unknown = ''
  value: unknown = ''
  disabled = false
  hidden = false
  max: unknown = undefined
  className = ''
  files: unknown[] = []
  customValidity = ''
  children: FakeElement[] = []
  readonly listeners = new Map<string, (event?: unknown) => unknown>()
  /** For #configForm: the form's validity (set by the page loader). */
  validity: () => boolean = () => true
  constructor(readonly tagName: string) {}
  set innerHTML(_html: string) {
    this.children = []
  }
  get lastChild(): FakeElement | undefined {
    return this.children[this.children.length - 1]
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child)
    return child
  }
  addEventListener(type: string, listener: (event?: unknown) => unknown): void {
    this.listeners.set(type, listener)
  }
  setCustomValidity(message: string): void {
    this.customValidity = message
  }
  checkValidity(): boolean {
    return this.validity()
  }
  reportValidity(): boolean {
    return this.validity()
  }
}

const IDS = [
  'connect',
  'download',
  'status',
  'usbInfo',
  'dfuInfo',
  'interfaceDialog',
  'interfaceForm',
  'selectInterface',
  'configForm',
  'dfuseStartAddress',
  'dfuseUploadSize',
  'firmwareFile',
  'downloadLog',
  'dfuseFields'
] as const

export type ElementId = (typeof IDS)[number]

export interface UpstreamPage {
  readonly el: Record<ElementId, FakeElement>
  click(id: 'connect'): void
  /** Presses Flash Bootloader; resolves when upstream's async click handler returns. */
  flash(): Promise<unknown>
  changeStartAddress(value: string): void
  chooseFile(name: string, data: ArrayBuffer): void
  /** The download log: paragraph class and text, or "progress". */
  log(): string[]
}

export interface PageOptions {
  search?: string
  /**
   * Define the global `vidField` that autoConnect writes to (index.html has no such element and
   * dfu-util.js never declares it). Default false: the original as shipped.
   */
  defineVidField?: boolean
}

/**
 * Upstream index.html + dfu-util.js on a fake DOM, after DOMContentLoaded.
 *
 * `#configForm.checkValidity()` models only the custom-validity constraint: the form is invalid
 * while either DfuSe field has a non-empty custom validity message. No other HTML constraint
 * (pattern, min/max) is modelled.
 */
export function loadUpstreamPage(usb: unknown, options: PageOptions = {}): UpstreamPage {
  const el = Object.fromEntries(
    IDS.map((id) => [id, new FakeElement(id === 'connect' || id === 'download' ? 'button' : 'div')])
  ) as Record<ElementId, FakeElement>
  el.firmwareFile.disabled = true
  el.download.disabled = true
  el.dfuseFields.hidden = true
  el.connect.textContent = 'Connect'
  el.configForm.validity = () => el.dfuseStartAddress.customValidity === '' && el.dfuseUploadSize.customValidity === ''

  let onReady: (() => void) | undefined
  const document = {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'DOMContentLoaded') onReady = listener
    },
    querySelector: (selector: string) => (el as Partial<Record<string, FakeElement>>)[selector.slice(1)] ?? null,
    createElement: (tag: string) => new FakeElement(tag)
  }
  class FileReader {
    result: unknown = null
    onload: (() => void) | null = null
    readAsArrayBuffer(file: { data: ArrayBuffer }) {
      void Promise.resolve().then(() => {
        this.result = file.data
        this.onload?.()
      })
    }
  }
  const globals: Record<string, unknown> = {
    ...baseGlobals(usb),
    document,
    window: { location: { search: options.search ?? '' } },
    FileReader
  }
  if (options.defineVidField === true) globals['vidField'] = new FakeElement('input')
  const context = createContext(globals)
  runInContext(`${readUpstream('dfu.js')}\n${readUpstream('dfuse.js')}\n${readUpstream('dfu-util.js')}`, context, {
    filename: 'upstream-dfu-util.js'
  })
  if (!onReady) throw new Error('dfu-util.js did not register DOMContentLoaded')
  onReady()

  return {
    el,
    click: (id) => void el[id].listeners.get('click')?.(),
    flash: () =>
      Promise.resolve(
        el.download.listeners.get('click')?.({ preventDefault: () => undefined, stopPropagation: () => undefined })
      ),
    changeStartAddress: (value) => {
      el.dfuseStartAddress.value = value
      el.dfuseStartAddress.listeners.get('change')?.({ target: el.dfuseStartAddress })
    },
    chooseFile: (name, data) => {
      el.firmwareFile.files = [{ name, data }]
      el.firmwareFile.listeners.get('change')?.()
    },
    log: () =>
      el.downloadLog.children.map((c) => (c.tagName === 'progress' ? 'progress' : `${c.className}: ${String(c.textContent)}`))
  }
}

// ---------------------------------------------------------------------------------------------
// Intel HEX

function hexRecord(type: number, address: number, data: readonly number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data]
  const checksum = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff
  return ':' + [...bytes, checksum].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')
}

/** Intel HEX text for `data` at absolute address `base`: 16-byte records, type 4 records at each 64 KiB. */
export function intelHex(base: number, data: readonly number[]): string {
  const lines: string[] = []
  let upper = -1
  for (let offset = 0; offset < data.length; offset += 16) {
    const address = base + offset
    if (address >>> 16 !== upper) {
      upper = address >>> 16
      lines.push(hexRecord(4, 0, [(upper >> 8) & 0xff, upper & 0xff]))
    }
    lines.push(hexRecord(0, address & 0xffff, data.slice(offset, offset + 16)))
  }
  lines.push(hexRecord(1, 0, []))
  return lines.join('\n') + '\n'
}

export const F4_MAP = '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg'
