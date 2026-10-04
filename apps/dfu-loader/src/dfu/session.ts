// The DFU Loader page flow from upstream/DFULoader/dfu-util.js (its DOMContentLoaded handler),
// as a framework-free state machine. The React UI renders `Snapshot` and calls the event methods.
import { DfuDevice, DfuState, findAllDfuInterfaces, findDeviceDfuInterfaces, type DfuLogEvent, type FirmwareData } from './dfu.js'
import { DfuseDevice, type MemoryInfo } from './dfuse.js'
import {
  fixInterfaceNames,
  formatDFUInterfaceAlternate,
  formatDFUSummary,
  formatMemorySummary,
  formatProperties,
  formatUsbInfo,
  getDFUDescriptorProperties,
  parseIntelHex
} from './util.js'

/** One line of the flash log (upstream's `<p class=...>` and `<progress>` elements). */
export type LogEntry =
  | { readonly kind: 'info' | 'warning' | 'error'; readonly text: string }
  | { readonly kind: 'progress'; readonly value: number; readonly max: number | null }

/** The status line at the top of the page (upstream `#status`). */
export interface Status {
  readonly kind: 'info' | 'error'
  readonly text: string
}

/** What the page shows about the connected interface (upstream `#usbInfo` and `#dfuInfo`). */
export interface ConnectedInfo {
  /** "Name: ...\nMFG: ...\nSerial: ...\n" */
  readonly usbInfo: string
  /** dfu-util style summary line. */
  readonly summary: string
  /** The functional descriptor properties; upstream computes this line, then overwrites it. */
  readonly properties: string | null
  readonly memory: MemoryInfo | null
  /** "Selected memory region: ..." and one line per segment; empty without a DfuSe memory map. */
  readonly memorySummary: string
}

export interface DfuseFields {
  readonly hidden: boolean
  readonly startAddress: { readonly value: string; readonly disabled: boolean; readonly customValidity: string }
  readonly uploadSize: {
    readonly value: string
    /** The browser could not read the typed text as a number. */
    readonly badInput: boolean
    readonly disabled: boolean
    readonly max: number | null
  }
}

export interface Firmware {
  readonly name: string
  readonly data: FirmwareData
  readonly convertedFromHex: boolean
}

export interface FieldProblem {
  readonly field: 'startAddress' | 'uploadSize'
  readonly message: string
}

export interface Snapshot {
  readonly webUsb: boolean
  readonly status: Status | null
  readonly connectLabel: 'Connect' | 'Disconnect'
  readonly connected: ConnectedInfo | null
  /**
   * What upstream leaves in `#dfuInfo` when connecting stops after the functional descriptor was
   * read (a non-DfuSe name, or CanDnload=false): "\n" and the properties line, once per failed
   * attempt. Cleared by a disconnect or a successful connect.
   */
  readonly strandedDfuInfo: string
  /** DFU interfaces of the chosen device; upstream always uses the first. */
  readonly interfaces: readonly string[]
  readonly flashEnabled: boolean
  readonly fileEnabled: boolean
  readonly dfuse: DfuseFields
  readonly firmware: Firmware | null
  readonly log: readonly LogEntry[]
  /** A flash is running (upstream allows several at once; see `flash`). */
  readonly flashing: boolean
  /** Why the last Flash press was refused (upstream's form validation message). */
  readonly invalid: FieldProblem | null
}

/** The page's device: none, connected, or found by auto-connect but failed to connect. */
type Link =
  | { readonly kind: 'none' }
  | { readonly kind: 'connected'; readonly device: DfuDevice }
  | { readonly kind: 'unconnected'; readonly device: DfuDevice }

/** STMicroelectronics DFU, the vendor the Connect chooser filters on. */
export const STM_VID = 0x0483
const MANIFEST_DISCONNECT_TIMEOUT_MS = 5000
const ADDRESS_PATTERN = /^(?:0x[A-Fa-f0-9]+)$/

function errorStatus(error: unknown): Status {
  return { kind: 'error', text: String(error) }
}

/** The checks upstream's form makes before flashing (pattern, custom validity, min/max/step). */
export function validateDfuseFields(fields: DfuseFields): FieldProblem | null {
  const start = fields.startAddress
  if (!start.disabled) {
    if (start.customValidity !== '') return { field: 'startAddress', message: start.customValidity }
    if (start.value !== '' && !ADDRESS_PATTERN.test(start.value)) {
      return { field: 'startAddress', message: 'Enter the start address in hexadecimal, starting with 0x.' }
    }
  }
  const size = fields.uploadSize
  if (!size.disabled && size.badInput) return { field: 'uploadSize', message: 'Enter a number.' }
  if (!size.disabled && size.value !== '') {
    const n = Number(size.value)
    if (!Number.isFinite(n)) return { field: 'uploadSize', message: 'Enter a number.' }
    if (n < 1) return { field: 'uploadSize', message: 'The upload size must be at least 1.' }
    if (size.max !== null && n > size.max) return { field: 'uploadSize', message: `The upload size must be at most ${size.max}.` }
    if (!Number.isInteger(n)) return { field: 'uploadSize', message: 'The upload size must be a whole number.' }
  }
  return null
}

/** Reads `?serial=` the way upstream does, including its Chromium issue 339054 workaround. */
export function landingPageSerial(search: string): string | null {
  const searchParams = new URLSearchParams(search)
  let serial = searchParams.get('serial')
  if (serial === null) return null
  // Workaround for Chromium issue 339054
  if (search.endsWith('/') && serial.endsWith('/')) serial = serial.substring(0, serial.length - 1)
  return serial
}

export class LoaderSession {
  private snapshot: Snapshot
  private readonly listeners = new Set<() => void>()
  private link: Link = { kind: 'none' }
  private transferSize = 1024
  private manifestationTolerant = true
  /** Whether a flash is running; upstream only writes log lines while its log context is set. */
  private logging = false
  private readonly serial: string
  private readonly fromLandingPage: boolean
  private autoConnectStarted = false
  private fileToken = 0
  private flashesRunning = 0
  /**
   * The start address text as of its last change event (or programmatic set), which browsers
   * compare with the current text to decide whether blur or Enter fires `change`.
   */
  private startAddressAtLastChange = ''

  constructor(
    private readonly usb: USB | undefined,
    search: string
  ) {
    const serial = landingPageSerial(search)
    this.serial = serial ?? ''
    this.fromLandingPage = serial !== null
    this.snapshot = {
      webUsb: usb !== undefined,
      status: usb === undefined ? { kind: 'error', text: 'WebUSB not available.' } : null,
      connectLabel: 'Connect',
      connected: null,
      strandedDfuInfo: '',
      interfaces: [],
      flashEnabled: false,
      fileEnabled: false,
      dfuse: {
        hidden: true,
        startAddress: { value: '', disabled: false, customValidity: '' },
        uploadSize: { value: '', badInput: false, disabled: false, max: null }
      },
      firmware: null,
      log: [],
      flashing: false,
      invalid: null
    }
  }

  // --- store -------------------------------------------------------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getSnapshot = (): Snapshot => this.snapshot

  private patch(change: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...change }
    for (const listener of this.listeners) listener()
  }

  private patchDfuse(change: {
    hidden?: boolean
    startAddress?: Partial<DfuseFields['startAddress']>
    uploadSize?: Partial<DfuseFields['uploadSize']>
  }): void {
    const current = this.snapshot.dfuse
    this.patch({
      dfuse: {
        hidden: change.hidden ?? current.hidden,
        startAddress: { ...current.startAddress, ...change.startAddress },
        uploadSize: { ...current.uploadSize, ...change.uploadSize }
      }
    })
  }

  // --- log ---------------------------------------------------------------------------------

  private appendLog(kind: 'info' | 'warning' | 'error', text: string): void {
    if (this.logging) this.patch({ log: [...this.snapshot.log, { kind, text }] })
  }

  private logProgress(done: number, total: number | undefined): void {
    if (!this.logging) return
    const log = this.snapshot.log
    const last = log[log.length - 1]
    if (last?.kind === 'progress') {
      this.patch({ log: [...log.slice(0, -1), { kind: 'progress', value: done, max: total ?? last.max }] })
    } else {
      this.patch({ log: [...log, { kind: 'progress', value: done, max: total ?? null }] })
    }
  }

  private deviceLog(event: DfuLogEvent): void {
    switch (event.kind) {
      case 'debug':
        console.debug(event.message)
        return
      case 'progress':
        this.logProgress(event.done, event.total)
        return
      default:
        this.appendLog(event.kind, event.message)
    }
  }

  // --- lifecycle ---------------------------------------------------------------------------

  /** Listens for unplugged devices and, when opened from the landing page, connects automatically. */
  start(): () => void {
    const usb = this.usb
    if (usb === undefined) return () => undefined
    const onDisconnect = (event: USBConnectionEvent) => this.onUnexpectedDisconnect(event)
    usb.addEventListener('disconnect', onDisconnect)
    if (this.fromLandingPage && !this.autoConnectStarted) {
      this.autoConnectStarted = true
      void this.autoConnect(usb)
    }
    return () => usb.removeEventListener('disconnect', onDisconnect)
  }

  private onDisconnect(reason?: Status): void {
    this.patch({
      ...(reason ? { status: reason } : {}),
      connectLabel: 'Connect',
      connected: null,
      strandedDfuInfo: '',
      flashEnabled: false,
      fileEnabled: false
    })
  }

  private onUnexpectedDisconnect(event: USBConnectionEvent): void {
    if (this.link.kind !== 'none' && this.link.device.usbDevice === event.device) {
      this.link.device.disconnected = true
      this.onDisconnect({ kind: 'info', text: 'Device disconnected' })
      this.link = { kind: 'none' }
    }
  }

  private async connect(device: DfuDevice): Promise<DfuDevice> {
    try {
      await device.open()
    } catch (error) {
      this.onDisconnect(errorStatus(error))
      throw error
    }

    // Attempt to parse the DFU functional descriptor
    let desc
    try {
      desc = await getDFUDescriptorProperties(device)
    } catch (error) {
      this.onDisconnect(errorStatus(error))
      throw error
    }

    let connected = device
    let properties: string | null = null
    let memorySummary = ''
    let cannotDownload = false
    const protocol = device.settings.alternate.interfaceProtocol
    if (desc) {
      properties = formatProperties(desc)
      // Upstream appends this line to #dfuInfo and overwrites it only if connecting succeeds.
      this.patch({ strandedDfuInfo: `${this.snapshot.strandedDfuInfo}\n${properties}` })
      this.transferSize = desc.TransferSize
      if (desc.CanDnload) this.manifestationTolerant = desc.ManifestationTolerant

      if (protocol === 0x02) {
        if (!desc.CanUpload) this.patchDfuse({ uploadSize: { disabled: true } })
        // Upstream means to disable Flash Bootloader here but names an undefined button and throws a
        // ReferenceError (a proven upstream bug, docs/bug-proofs/dfu-loader.md row 55). The port
        // finishes connecting with Flash Bootloader disabled.
        if (!desc.CanDnload) cannotDownload = true
      }

      if (desc.DFUVersion === 0x011a && protocol === 0x02) {
        const dfuseDevice = new DfuseDevice(device.usbDevice, device.settings)
        if (dfuseDevice.memoryInfo) memorySummary = formatMemorySummary(dfuseDevice.memoryInfo)
        connected = dfuseDevice
      }
    }

    // Bind logging
    connected.onLog = (event) => this.deviceLog(event)

    const memory = connected instanceof DfuseDevice ? connected.memoryInfo : null
    this.patch({
      log: [],
      status: null,
      connectLabel: 'Disconnect',
      strandedDfuInfo: '',
      connected: {
        usbInfo: formatUsbInfo(connected.usbDevice),
        summary: formatDFUSummary(connected),
        properties,
        memory,
        memorySummary
      },
      // Runtime interfaces cannot be flashed
      flashEnabled: protocol !== 0x01 && !cannotDownload,
      fileEnabled: protocol !== 0x01
    })

    if (connected instanceof DfuseDevice && memory) {
      this.patchDfuse({ hidden: false, startAddress: { disabled: false }, uploadSize: { disabled: false } })
      const segment = connected.getFirstWritableSegment()
      if (segment) {
        connected.startAddress = segment.start
        const maxReadSize = connected.getMaxReadSize(segment.start)
        const value = '0x' + segment.start.toString(16)
        // A value set by script is the new baseline for the field's change event.
        this.startAddressAtLastChange = value
        // Upstream keeps the field's previous custom validity here, so an earlier "Address outside of
        // memory map" blocks Flash Bootloader for this valid address (a proven upstream bug,
        // docs/bug-proofs/dfu-loader.md row 144). The port clears it.
        this.patchDfuse({
          startAddress: { value, customValidity: '' },
          uploadSize: { value: String(maxReadSize), badInput: false, max: maxReadSize }
        })
      }
    } else {
      this.patchDfuse({ hidden: true, startAddress: { disabled: true }, uploadSize: { disabled: true } })
    }

    return connected
  }

  private async autoConnect(usb: USB): Promise<void> {
    let dfuDevices: DfuDevice[]
    try {
      dfuDevices = await findAllDfuInterfaces(usb)
    } catch (error) {
      this.patch({ status: errorStatus(error) })
      return
    }
    const matching = dfuDevices.filter((d) =>
      this.serial ? d.usbDevice.serialNumber === this.serial : d.usbDevice.vendorId === STM_VID
    )
    const [only] = matching
    if (only === undefined) {
      this.patch({ status: { kind: 'info', text: 'No device found.' } })
    } else if (matching.length === 1) {
      this.patch({ status: { kind: 'info', text: 'Connecting...' } })
      this.link = { kind: 'unconnected', device: only }
      try {
        this.link = { kind: 'connected', device: await this.connect(only) }
      } catch (error) {
        // Upstream leaves "Connecting..." showing unless opening failed; show the error.
        this.patch({ status: errorStatus(error) })
      }
    } else {
      this.patch({ status: { kind: 'info', text: 'Multiple DFU interfaces found.' } })
    }
  }

  // --- events ------------------------------------------------------------------------------

  /** The Connect / Disconnect button. */
  async connectClick(): Promise<void> {
    if (this.link.kind !== 'none') {
      const device = this.link.device
      this.link = { kind: 'none' }
      await device.close()
      this.onDisconnect()
      return
    }
    const usb = this.usb
    if (usb === undefined) return
    const filters: USBDeviceFilter[] = this.serial ? [{ serialNumber: this.serial }] : [{ vendorId: STM_VID }]
    try {
      const selectedDevice = await usb.requestDevice({ filters })
      const interfaces = findDeviceDfuInterfaces(selectedDevice)
      if (interfaces.length === 0) {
        console.log(selectedDevice)
        this.patch({
          interfaces: [],
          status: { kind: 'error', text: 'The selected device does not have any USB DFU interfaces.' }
        })
        return
      }
      const named = await fixInterfaceNames(selectedDevice, interfaces)
      const [first] = named
      if (first === undefined) return
      this.patch({ interfaces: named.map(formatDFUInterfaceAlternate) })
      this.link = { kind: 'connected', device: await this.connect(new DfuDevice(selectedDevice, first)) }
    } catch (error) {
      this.patch({ status: errorStatus(error) })
    }
  }

  /** Typing in the DfuSe start address field. */
  editStartAddress(value: string): void {
    this.patchDfuse({ startAddress: { value } })
    this.patch({ invalid: null })
  }

  /**
   * The start address field lost focus or Enter was pressed. As in a browser, upstream's `change`
   * handler runs only if the text changed since the last change event: it validates the text and
   * moves the start address.
   */
  commitStartAddress(): void {
    const value = this.snapshot.dfuse.startAddress.value
    if (value === this.startAddressAtLastChange) return
    this.startAddressAtLastChange = value
    const address = parseInt(value, 16)
    const device = this.link.kind === 'none' ? null : this.link.device
    if (isNaN(address)) {
      this.patchDfuse({ startAddress: { customValidity: 'Invalid hexadecimal start address' } })
    } else if (device instanceof DfuseDevice && device.memoryInfo) {
      if (device.getSegment(address) !== null) {
        device.startAddress = address
        this.patchDfuse({ startAddress: { customValidity: '' }, uploadSize: { max: device.getMaxReadSize(address) } })
      } else {
        this.patchDfuse({ startAddress: { customValidity: 'Address outside of memory map' } })
      }
    } else {
      this.patchDfuse({ startAddress: { customValidity: '' } })
    }
  }

  /**
   * Enter in a DfuSe field. Upstream's fields sit in a form whose first submit button is Flash
   * Bootloader, so the browser fires the field's change event, then submits the form implicitly,
   * which clicks Flash Bootloader unless it is disabled (reproduced upstream behaviour, see
   * docs/upstream-bugs.md).
   */
  async pressEnter(field: FieldProblem['field']): Promise<void> {
    if (field === 'startAddress') this.commitStartAddress()
    if (this.snapshot.flashEnabled) await this.flash()
  }

  /** Typing in the DfuSe upload size field. */
  editUploadSize(value: string, badInput = false): void {
    this.patchDfuse({ uploadSize: { value, badInput } })
    this.patch({ invalid: null })
  }

  /** A firmware file was chosen. Files ending in ".hex" are converted to a flat image. */
  async chooseFile(file: { readonly name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<void> {
    if (!this.snapshot.fileEnabled) return
    const token = ++this.fileToken
    this.patch({ firmware: null })
    let buffer: ArrayBuffer
    try {
      buffer = await file.arrayBuffer()
    } catch {
      return
    }
    if (token !== this.fileToken) return
    if (file.name.endsWith('.hex')) {
      this.patch({ firmware: { name: file.name, data: parseIntelHex(buffer), convertedFromHex: true } })
      // Upstream logs this through logInfo, which drops it unless a flash is running, so it is never
      // shown (a proven upstream bug, docs/bug-proofs/dfu-loader.md row 53). The port always adds it.
      this.patch({ log: [...this.snapshot.log, { kind: 'info', text: 'Converted Hex to bin' }] })
    } else {
      this.patch({ firmware: { name: file.name, data: buffer, convertedFromHex: false } })
    }
  }

  /**
   * The Flash Bootloader button. As upstream, it stays enabled while a flash runs, and pressing it
   * again starts a second download whose transfers interleave with the first (reproduced upstream
   * behaviour, see docs/upstream-bugs.md).
   */
  async flash(): Promise<void> {
    // Deliberate fix (docs/porting-policy.md): upstream lets a second press start a second download
    // whose transfers interleave with the first and corrupt the write. Ignore presses while flashing.
    if (this.flashesRunning > 0) return
    const invalid = validateDfuseFields(this.snapshot.dfuse)
    this.patch({ invalid })
    if (invalid) return

    const device = this.link.kind === 'none' ? null : this.link.device
    const firmware = this.snapshot.firmware
    if (!device || !firmware) return

    this.logging = true
    this.flashesRunning++
    this.patch({ log: [], flashing: true })
    try {
      const status = await device.getStatus()
      if (status.state === DfuState.dfuERROR) await device.clearStatus()
    } catch {
      device.logWarning('Failed to clear status')
    }
    try {
      await device.doDownload(this.transferSize, firmware.data)
      this.appendLog('info', 'Done!')
      this.logging = false
      const current = this.link.kind === 'none' ? null : this.link.device
      if (!this.manifestationTolerant && current && this.usb) {
        current.waitDisconnected(MANIFEST_DISCONNECT_TIMEOUT_MS, this.usb).then(
          () => {
            this.onDisconnect()
            this.link = { kind: 'none' }
          },
          () => {
            // It didn't reset and disconnect for some reason...
            console.log('Device unexpectedly tolerated manifestation.')
          }
        )
      }
    } catch (error) {
      this.appendLog('error', String(error))
      this.logging = false
    } finally {
      this.flashesRunning--
      this.patch({ flashing: this.flashesRunning > 0 })
    }
  }
}
