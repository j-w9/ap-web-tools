// Page helpers from upstream/DFULoader/dfu-util.js: text formats, the DFU functional descriptor
// properties, interface-name repair and the Intel HEX conversion.
import { DfuDevice, DfuError, parseConfigurationDescriptor, type DfuInterfaceSettings } from './dfu.js'
import type { MemoryInfo } from './dfuse.js'

export function hex4(n: number): string {
  return n.toString(16).padStart(4, '0')
}

export function hexAddr8(n: number): string {
  return '0x' + n.toString(16).padStart(8, '0')
}

export function niceSize(n: number): string {
  const gigabyte = 1024 * 1024 * 1024
  const megabyte = 1024 * 1024
  const kilobyte = 1024
  if (n >= gigabyte) return `${n / gigabyte}GiB`
  if (n >= megabyte) return `${n / megabyte}MiB`
  if (n >= kilobyte) return `${n / kilobyte}KiB`
  return `${n}B`
}

export type DfuMode = 'Runtime' | 'DFU' | 'Unknown'

export function dfuMode(settings: DfuInterfaceSettings): DfuMode {
  switch (settings.alternate.interfaceProtocol) {
    case 0x01:
      return 'Runtime'
    case 0x02:
      return 'DFU'
    default:
      return 'Unknown'
  }
}

/** dfu-util style one-line summary of the connected interface. */
export function formatDFUSummary(device: DfuDevice): string {
  const usb = device.usbDevice
  const vid = hex4(usb.vendorId)
  const pid = hex4(usb.productId)
  const name = String(usb.productName)
  const mode = dfuMode(device.settings)
  const cfg = device.settings.configuration.configurationValue
  const intf = device.settings.interface.interfaceNumber
  const alt = device.settings.alternate.alternateSetting
  const serial = String(usb.serialNumber)
  return `${mode}: [${vid}:${pid}] cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}" serial="${serial}"`
}

/** One line per DFU interface alternate, as upstream's (unused) interface dialog labels them. */
export function formatDFUInterfaceAlternate(settings: DfuInterfaceSettings): string {
  const mode = dfuMode(settings)
  const cfg = settings.configuration.configurationValue
  const intf = settings.interface.interfaceNumber
  const alt = settings.alternate.alternateSetting
  const name = settings.name ? settings.name : 'UNKNOWN'
  return `${mode}: cfg=${cfg}, intf=${intf}, alt=${alt}, name="${name}"`
}

/** The browser's "Name / MFG / Serial" block shown after connecting. */
export function formatUsbInfo(usb: USBDevice): string {
  return `Name: ${String(usb.productName)}\nMFG: ${String(usb.manufacturerName)}\nSerial: ${String(usb.serialNumber)}\n`
}

/**
 * Fills in interface names the browser could not read by reading the string descriptors
 * directly. Returns the settings with names filled in (upstream mutates them in place).
 */
export async function fixInterfaceNames(
  device: USBDevice,
  interfaces: readonly DfuInterfaceSettings[]
): Promise<DfuInterfaceSettings[]> {
  const first = interfaces[0]
  // Check if any interface names were not read correctly
  if (first === undefined || !interfaces.some((intf) => intf.name === null)) return [...interfaces]

  // Manually retrieve the interface name string descriptors
  const tempDevice = new DfuDevice(device, first)
  await tempDevice.usbDevice.open()
  await tempDevice.usbDevice.selectConfiguration(1)
  const mapping = await tempDevice.readInterfaceNames()
  await tempDevice.close()

  return interfaces.map((intf) => {
    if (intf.name !== null) return intf
    const configIndex = intf.configuration.configurationValue
    const intfNumber = intf.interface.interfaceNumber
    const alternates = mapping.get(configIndex)?.get(intfNumber)
    // Upstream crashes with a TypeError here; report it instead.
    if (alternates === undefined) {
      throw new DfuError(`Interface ${intfNumber} of configuration ${configIndex} not found in the configuration descriptor`)
    }
    // A missing or unreadable string stays unnamed (upstream stores undefined or null).
    return { ...intf, name: alternates.get(intf.alternate.alternateSetting) ?? null }
  })
}

/** The DFU functional descriptor's properties, as upstream names them. */
export interface DfuProperties {
  readonly WillDetach: boolean
  readonly ManifestationTolerant: boolean
  readonly CanUpload: boolean
  readonly CanDnload: boolean
  readonly TransferSize: number
  readonly DetachTimeOut: number
  readonly DFUVersion: number
}

/**
 * Reads configuration descriptor 0 and returns the properties of its first DFU functional
 * descriptor, or null when the read fails, the configuration differs or there is none.
 */
export async function getDFUDescriptorProperties(device: DfuDevice): Promise<DfuProperties | null> {
  let data: DataView
  try {
    data = await device.readConfigurationDescriptor(0)
  } catch {
    return null
  }
  const configDesc = parseConfigurationDescriptor(data)
  if (configDesc.bConfigurationValue !== device.settings.configuration.configurationValue) return null
  const funcDesc = configDesc.descriptors.find((desc) => desc.bDescriptorType === 0x21 && desc.kind === 'functional')
  if (funcDesc?.kind !== 'functional') return null
  return {
    WillDetach: (funcDesc.bmAttributes & 0x08) !== 0,
    ManifestationTolerant: (funcDesc.bmAttributes & 0x04) !== 0,
    CanUpload: (funcDesc.bmAttributes & 0x02) !== 0,
    CanDnload: (funcDesc.bmAttributes & 0x01) !== 0,
    TransferSize: funcDesc.wTransferSize,
    DetachTimeOut: funcDesc.wDetachTimeOut,
    DFUVersion: funcDesc.bcdDFUVersion
  }
}

export function formatProperties(desc: DfuProperties): string {
  return (
    `WillDetach=${String(desc.WillDetach)}, ManifestationTolerant=${String(desc.ManifestationTolerant)}, ` +
    `CanUpload=${String(desc.CanUpload)}, CanDnload=${String(desc.CanDnload)}, TransferSize=${desc.TransferSize}, ` +
    `DetachTimeOut=${desc.DetachTimeOut}, Version=${hex4(desc.DFUVersion)}`
  )
}

export type SegmentAccess = 'readable' | 'erasable' | 'writable'

/** "readable, erasable, writable", or "inaccessible". */
export function formatSegmentProperties(segment: {
  readonly readable: boolean
  readonly erasable: boolean
  readonly writable: boolean
}): string {
  const properties: SegmentAccess[] = []
  if (segment.readable) properties.push('readable')
  if (segment.erasable) properties.push('erasable')
  if (segment.writable) properties.push('writable')
  return properties.length > 0 ? properties.join(', ') : 'inaccessible'
}

export function memoryTotalSize(memoryInfo: MemoryInfo): number {
  let totalSize = 0
  for (const segment of memoryInfo.segments) totalSize += segment.end - segment.start
  return totalSize
}

/** "Selected memory region: ..." followed by one line per segment. */
export function formatMemorySummary(memoryInfo: MemoryInfo): string {
  let memorySummary = `Selected memory region: ${memoryInfo.name} (${niceSize(memoryTotalSize(memoryInfo))})`
  for (const segment of memoryInfo.segments) {
    memorySummary += `\n${hexAddr8(segment.start)}-${hexAddr8(segment.end - 1)} (${formatSegmentProperties(segment)})`
  }
  return memorySummary
}

/**
 * Converts an Intel HEX file to a flat image as upstream does (a 512 KiB buffer, cut at the highest
 * byte written), except that extended linear address (type 4) records are applied: each data byte
 * lands at its absolute address minus the lowest extended linear base used by any data record.
 * Upstream reads the base and never uses it, overlaying the 64 KiB segments (a proven upstream bug,
 * see docs/bug-proofs/dfu-loader.md row 51). A file inside one 64 KiB segment converts exactly as
 * upstream converts it. The start address still comes from the DfuSe start address field.
 */
export function parseIntelHex(hexBuffer: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const hexText = new TextDecoder('utf-8').decode(hexBuffer)
  const records: { len: number; addr: number; type: number; bytes: string }[] = []
  for (const line of hexText.trim().split(/\r?\n/)) {
    if (!line.startsWith(':')) continue
    // `slice` here matches upstream's `substr(start, length)` for every length parseInt can return.
    const len = parseInt(line.slice(1, 3), 16)
    records.push({
      len,
      addr: parseInt(line.slice(3, 7), 16),
      type: parseInt(line.slice(7, 9), 16),
      bytes: line.slice(9, 9 + len * 2)
    })
  }

  // First pass: the lowest extended linear base in effect for any data record.
  let baseAddr = 0
  let origin = Infinity
  for (const r of records) {
    if (r.type === 0) origin = Math.min(origin, baseAddr)
    else if (r.type === 4) baseAddr = parseInt(r.bytes, 16) * 0x10000
  }
  if (origin === Infinity) origin = 0

  const data = new Uint8Array(1024 * 512) // Allocate up to 512KB
  let dataLength = 0
  baseAddr = 0
  for (const r of records) {
    if (r.type === 0) {
      // data record
      const offset = baseAddr + r.addr - origin
      for (let i = 0; i < r.len; i++) data[offset + i] = parseInt(r.bytes.slice(i * 2, i * 2 + 2), 16)
      dataLength = Math.max(dataLength, offset + r.len)
    } else if (r.type === 4) {
      // extended linear address
      baseAddr = parseInt(r.bytes, 16) * 0x10000
    }
  }
  return data.slice(0, dataLength)
}
