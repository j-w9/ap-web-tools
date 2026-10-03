// Test-only: loads upstream/DFULoader (dfu.js, dfuse.js and dfu-util.js) into vm contexts so the
// TypeScript port can be compared against it on the same scripted USB devices.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(here, '../../../../upstream/DFULoader')
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8')

/** The parts of upstream's `dfu.Device` / `dfuse.Device` the tests drive. */
export interface UpstreamDevice {
  logDebug: (msg: string) => void
  logInfo: (msg: string) => void
  logWarning: (msg: string) => void
  logError: (msg: string) => void
  logProgress: (done: number, total?: number) => void
  startAddress: number
  readonly memoryInfo: unknown
  open(): Promise<void>
  close(): Promise<void>
  getStatus(): Promise<{ status: number; pollTimeout: number; state: number }>
  getState(): Promise<number>
  abortToIdle(): Promise<void>
  readConfigurationDescriptor(index: number): Promise<DataView>
  readStringDescriptor(index: number, langID?: number): Promise<unknown>
  readInterfaceNames(): Promise<Record<string, Record<string, Record<string, unknown>>>>
  detach(): Promise<number>
  do_download(xferSize: number, data: ArrayBuffer | Uint8Array, manifestationTolerant: boolean): Promise<void>
  do_upload(xferSize: number, maxSize?: number, firstBlock?: number): Promise<Blob>
  erase(startAddr: number, length: number): Promise<void>
  getSegment(addr: number): unknown
  getFirstWritableSegment(): unknown
  getMaxReadSize(addr: number): number
  waitDisconnected(timeout: number): Promise<unknown>
}

/** Upstream's `dfu` and `dfuse` namespaces. */
export interface UpstreamDfu {
  dfu: {
    Device: new (device: USBDevice, settings: unknown) => UpstreamDevice
    findDeviceDfuInterfaces(device: USBDevice): { name: string | null }[]
    parseConfigurationDescriptor(data: DataView): unknown
    parseDeviceDescriptor(data: DataView): unknown
  }
  dfuse: {
    Device: new (device: USBDevice, settings: unknown) => UpstreamDevice
    parseMemoryDescriptor(desc: string): unknown
  }
}

const quietConsole = { log: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined }

function baseGlobals(usb: unknown) {
  return {
    console: quietConsole,
    setTimeout,
    clearTimeout,
    Blob,
    TextDecoder,
    URLSearchParams,
    navigator: { usb }
  }
}

/** Fresh upstream dfu.js + dfuse.js. `usb` becomes `navigator.usb` (for waitDisconnected). */
export function loadUpstreamDfu(usb?: unknown): UpstreamDfu {
  const context = createContext(baseGlobals(usb))
  return runInContext(`${read('dfu.js')}\n${read('dfuse.js')}\n;({ dfu, dfuse })`, context, {
    filename: 'upstream-dfu.js'
  }) as UpstreamDfu
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
    return true
  }
  reportValidity(): boolean {
    return true
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
  /** The page's global `device`. */
  device(): unknown
  click(id: 'connect'): void
  /** Presses Flash Bootloader; resolves when upstream's async click handler returns. */
  flash(): Promise<unknown>
  /** Changes the DfuSe start address field and fires its change event. */
  changeStartAddress(value: string): void
  /** Chooses a firmware file (read asynchronously, as FileReader does). */
  chooseFile(name: string, data: ArrayBuffer): void
  /** The download log as upstream renders it: paragraphs by class, and progress bars. */
  log(): ({ kind: string; text: string } | { kind: 'progress'; value: number; max: number | null })[]
}

/** Upstream index.html + dfu-util.js on a fake DOM, after DOMContentLoaded. */
export function loadUpstreamPage(usb: unknown, search = ''): UpstreamPage {
  const el = Object.fromEntries(
    IDS.map((id) => [id, new FakeElement(id === 'connect' || id === 'download' ? 'button' : 'div')])
  ) as Record<ElementId, FakeElement>
  // index.html's initial attributes
  el.firmwareFile.disabled = true
  el.download.disabled = true
  el.dfuseFields.hidden = true
  el.connect.textContent = 'Connect'

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
  const context = createContext({
    ...baseGlobals(usb),
    document,
    window: { location: { search } },
    FileReader,
    // autoConnect writes to an undeclared `vidField` after connecting; the ReferenceError it throws
    // is an unhandled rejection with no visible effect. Defining it keeps that noise out of the run.
    vidField: new FakeElement('input')
  })
  runInContext(`${read('dfu.js')}\n${read('dfuse.js')}\n${read('dfu-util.js')}`, context, { filename: 'upstream-dfu-util.js' })
  if (!onReady) throw new Error('dfu-util.js did not register DOMContentLoaded')
  onReady()

  return {
    el,
    device: () => runInContext('device', context),
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
      el.downloadLog.children.map((c) =>
        c.tagName === 'progress'
          ? { kind: 'progress' as const, value: Number(c.value), max: c.max === undefined ? null : Number(c.max) }
          : { kind: c.className, text: String(c.textContent) }
      )
  }
}

/** The pure helpers of dfu-util.js, cut out of its closure and evaluated next to dfu.js. */
export interface UpstreamUtil {
  hex4(n: number): string
  hexAddr8(n: number): string
  niceSize(n: number): string
  formatDFUSummary(device: unknown): string
  formatDFUInterfaceAlternate(settings: unknown): string
  fixInterfaceNames(device: USBDevice, interfaces: unknown[]): Promise<void>
  getDFUDescriptorProperties(device: unknown): Promise<Record<string, unknown> | undefined>
  parseIntelHex(buffer: ArrayBuffer): Uint8Array
  dfu: UpstreamDfu['dfu']
  dfuse: UpstreamDfu['dfuse']
}

function cut(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  if (start < 0 || end < 0) throw new Error(`Could not find ${from} in dfu-util.js`)
  return source.slice(start, end)
}

export function loadUpstreamUtil(usb?: unknown): UpstreamUtil {
  const util = read('dfu-util.js')
  const helpers = cut(util, 'function hex4', 'function populateInterfaceList')
  const descriptor = cut(util, 'function getDFUDescriptorProperties', '// Current log div element')
  const hex = cut(util, 'function parseIntelHex', 'firmwareFileField.addEventListener')
  const context = createContext(baseGlobals(usb))
  return runInContext(
    `${read('dfu.js')}\n${read('dfuse.js')}\n${helpers}\n${descriptor}\n${hex}\n` +
      ';({ hex4, hexAddr8, niceSize, formatDFUSummary, formatDFUInterfaceAlternate, fixInterfaceNames, getDFUDescriptorProperties, parseIntelHex, dfu, dfuse })',
    context,
    { filename: 'upstream-dfu-util-helpers.js' }
  ) as UpstreamUtil
}
