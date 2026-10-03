/*
 * ST DfuSe extensions to DFU. TypeScript port of upstream/DFULoader/dfuse.js, which is
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
 */
import { DfuDevice, DfuError, DfuState, STATUS_OK, type DfuInterfaceSettings, type DfuStatus, type FirmwareData } from './dfu.js'

/** DfuSe special commands, sent as the first byte of a block-0 DNLOAD. */
export const DfuseCommand = {
  GET_COMMANDS: 0x00,
  SET_ADDRESS: 0x21,
  ERASE_SECTOR: 0x41
} as const
export type DfuseCommandCode = (typeof DfuseCommand)[keyof typeof DfuseCommand]

const COMMAND_NAMES: Record<DfuseCommandCode, keyof typeof DfuseCommand> = {
  0x00: 'GET_COMMANDS',
  0x21: 'SET_ADDRESS',
  0x41: 'ERASE_SECTOR'
}

/** A run of equal sectors in the DfuSe memory map. `end` is exclusive. */
export interface MemorySegment {
  readonly start: number
  readonly sectorSize: number
  readonly end: number
  readonly readable: boolean
  readonly erasable: boolean
  readonly writable: boolean
}

export interface MemoryInfo {
  readonly name: string
  readonly segments: readonly MemorySegment[]
}

function sectorMultiplier(unit: string): number {
  switch (unit) {
    case ' ':
    case 'B':
      return 1
    case 'K':
      return 1024
    case 'M':
      return 1048576
    default:
      return NaN
  }
}

/** Parses a DfuSe memory layout string such as `@Internal Flash  /0x08000000/04*016Kg,01*064Kg`. */
export function parseMemoryDescriptor(desc: string): MemoryInfo {
  const nameEndIndex = desc.indexOf('/')
  if (!desc.startsWith('@') || nameEndIndex === -1) {
    throw new DfuError(`Not a DfuSe memory descriptor: "${desc}"`)
  }

  const name = desc.substring(1, nameEndIndex).trim()
  const segmentString = desc.substring(nameEndIndex)

  const segments: MemorySegment[] = []

  const contiguousSegmentRegex = /\/\s*(0x[0-9a-fA-F]{1,8})\s*\/(\s*[0-9]+\s*\*\s*[0-9]+\s?[ BKM]\s*[abcdefg]\s*,?\s*)+/g
  for (
    let contiguous = contiguousSegmentRegex.exec(segmentString);
    contiguous !== null;
    contiguous = contiguousSegmentRegex.exec(segmentString)
  ) {
    const segmentRegex = /([0-9]+)\s*\*\s*([0-9]+)\s?([ BKM])\s*([abcdefg])\s*,?\s*/g
    let startAddress = parseInt(contiguous[1] ?? '', 16)
    for (let match = segmentRegex.exec(contiguous[0]); match !== null; match = segmentRegex.exec(contiguous[0])) {
      const sectorCount = parseInt(match[1] ?? '', 10)
      const sectorSize = parseInt(match[2] ?? '') * sectorMultiplier(match[3] ?? '')
      const properties = (match[4] ?? '').charCodeAt(0) - 'a'.charCodeAt(0) + 1
      segments.push({
        start: startAddress,
        sectorSize,
        end: startAddress + sectorSize * sectorCount,
        readable: (properties & 0x1) !== 0,
        erasable: (properties & 0x2) !== 0,
        writable: (properties & 0x4) !== 0
      })
      startAddress += sectorSize * sectorCount
    }
  }

  return { name, segments }
}

/** A DfuSe (DFU 1.1a) interface, with the memory map from its interface name (upstream `dfuse.Device`). */
export class DfuseDevice extends DfuDevice {
  readonly memoryInfo: MemoryInfo | null
  /** Where downloads and uploads start; null means "the first segment" (upstream's NaN). */
  startAddress: number | null = null

  constructor(device: USBDevice, settings: DfuInterfaceSettings) {
    super(device, settings)
    this.memoryInfo = settings.name ? parseMemoryDescriptor(settings.name) : null
  }

  async dfuseCommand(command: DfuseCommandCode, param = 0x00, len: 1 | 4 = 1): Promise<void> {
    const payload = new ArrayBuffer(len + 1)
    const view = new DataView(payload)
    view.setUint8(0, command)
    if (len === 1) {
      view.setUint8(1, param)
    } else {
      view.setUint32(1, param, true)
    }

    try {
      await this.download(payload, 0)
    } catch (error) {
      throw new DfuError(`Error during special DfuSe command ${COMMAND_NAMES[command]}:${String(error)}`)
    }

    const status = await this.pollUntil((state) => state !== DfuState.dfuDNBUSY)
    if (status.status !== STATUS_OK) {
      // Upstream names an undefined variable here and throws "ReferenceError: commandName is not defined".
      throw new DfuError(`Special DfuSe command ${COMMAND_NAMES[command]} failed`)
    }
  }

  private requireMemoryInfo(): MemoryInfo {
    if (!this.memoryInfo) throw new DfuError('No memory map information available')
    return this.memoryInfo
  }

  getSegment(addr: number): MemorySegment | null {
    for (const segment of this.requireMemoryInfo().segments) {
      if (segment.start <= addr && addr < segment.end) return segment
    }
    return null
  }

  getSectorStart(addr: number, segment: MemorySegment | null = this.getSegment(addr)): number {
    if (!segment) throw new DfuError(`Address ${addr.toString(16)} outside of memory map`)
    const sectorIndex = Math.floor((addr - segment.start) / segment.sectorSize)
    return segment.start + sectorIndex * segment.sectorSize
  }

  getSectorEnd(addr: number, segment: MemorySegment | null = this.getSegment(addr)): number {
    if (!segment) throw new DfuError(`Address ${addr.toString(16)} outside of memory map`)
    const sectorIndex = Math.floor((addr - segment.start) / segment.sectorSize)
    return segment.start + (sectorIndex + 1) * segment.sectorSize
  }

  getFirstWritableSegment(): MemorySegment | null {
    for (const segment of this.requireMemoryInfo().segments) {
      if (segment.writable) return segment
    }
    return null
  }

  /** Bytes readable from `startAddr` through contiguous readable segments. */
  getMaxReadSize(startAddr: number): number {
    let numBytes = 0
    for (const segment of this.requireMemoryInfo().segments) {
      if (segment.start <= startAddr && startAddr < segment.end) {
        // Found the first segment the read starts in
        if (segment.readable) {
          numBytes += segment.end - startAddr
        } else {
          return 0
        }
      } else if (segment.start === startAddr + numBytes) {
        // Include a contiguous segment
        if (segment.readable) {
          numBytes += segment.end - segment.start
        } else {
          break
        }
      }
    }
    return numBytes
  }

  /** Erases every erasable sector touching [startAddr, startAddr + length). */
  async erase(startAddr: number, length: number): Promise<void> {
    let segment = this.getSegment(startAddr)
    let addr = this.getSectorStart(startAddr, segment)
    const endAddr = this.getSectorEnd(startAddr + length - 1)

    let bytesErased = 0
    const bytesToErase = endAddr - addr
    if (bytesToErase > 0) this.logProgress(bytesErased, bytesToErase)

    while (addr < endAddr) {
      if (segment === null || segment.end <= addr) segment = this.getSegment(addr)
      // Upstream crashes with a TypeError when the range crosses a gap in the memory map.
      if (segment === null) throw new DfuError(`Address ${addr.toString(16)} outside of memory map`)
      if (!segment.erasable) {
        // Skip over the non-erasable section
        bytesErased = Math.min(bytesErased + segment.end - addr, bytesToErase)
        addr = segment.end
        this.logProgress(bytesErased, bytesToErase)
        continue
      }
      const sectorIndex = Math.floor((addr - segment.start) / segment.sectorSize)
      const sectorAddr = segment.start + sectorIndex * segment.sectorSize
      this.logDebug(`Erasing ${segment.sectorSize}B at 0x${sectorAddr.toString(16)}`)
      await this.dfuseCommand(DfuseCommand.ERASE_SECTOR, sectorAddr, 4)
      addr = sectorAddr + segment.sectorSize
      bytesErased += segment.sectorSize
      this.logProgress(bytesErased, bytesToErase)
    }
  }

  /** Start address for a transfer: the chosen one, or the first segment's (logged). */
  private transferStart(memoryInfo: MemoryInfo, logOutside: (message: string) => void): number {
    if (this.startAddress === null) {
      const first = memoryInfo.segments[0]
      if (first === undefined) throw new DfuError('No memory map available')
      this.logWarning(`Using inferred start address 0x${first.start.toString(16)}`)
      return first.start
    }
    if (this.getSegment(this.startAddress) === null) {
      logOutside(`Start address 0x${this.startAddress.toString(16)} outside of memory map bounds`)
    }
    return this.startAddress
  }

  /** Erases, then writes `data` from the start address with SET_ADDRESS per block, then manifests. */
  override async doDownload(xferSize: number, data: FirmwareData): Promise<void> {
    if (!this.memoryInfo) throw new DfuError('No memory map available')

    this.logInfo('Erasing DFU device memory')

    let bytesSent = 0
    const expectedSize = data.byteLength

    const startAddress = this.transferStart(this.memoryInfo, (m) => this.logError(m))
    await this.erase(startAddress, expectedSize)

    this.logInfo('Copying data from browser to DFU device')

    let address = startAddress
    while (bytesSent < expectedSize) {
      const bytesLeft = expectedSize - bytesSent
      const chunkSize = Math.min(bytesLeft, xferSize)

      let bytesWritten = 0
      let dfuStatus: DfuStatus
      try {
        await this.dfuseCommand(DfuseCommand.SET_ADDRESS, address, 4)
        this.logDebug(`Set address to 0x${address.toString(16)}`)
        bytesWritten = await this.download(data.slice(bytesSent, bytesSent + chunkSize), 2)
        this.logDebug(`Sent ${bytesWritten} bytes`)
        dfuStatus = await this.pollUntilIdle(DfuState.dfuDNLOAD_IDLE)
        address += chunkSize
      } catch (error) {
        throw new DfuError(`Error during DfuSe download: ${String(error)}`)
      }

      if (dfuStatus.status !== STATUS_OK) {
        throw new DfuError(`DFU DOWNLOAD failed state=${dfuStatus.state}, status=${dfuStatus.status}`)
      }

      this.logDebug(`Wrote ${bytesWritten} bytes`)
      bytesSent += bytesWritten

      this.logProgress(bytesSent, expectedSize)
    }
    this.logInfo(`Wrote ${bytesSent} bytes`)

    try {
      await this.dfuseCommand(DfuseCommand.SET_ADDRESS, startAddress, 4)
      await this.download(new ArrayBuffer(0), 0)
    } catch (error) {
      throw new DfuError(`Error during DfuSe manifestation: ${String(error)}`)
    }

    try {
      await this.pollUntil((state) => state === DfuState.dfuMANIFEST)
    } catch {
      // The device may reset during manifestation; upstream ignores any error here.
    }
  }

  /** Reads `maxSize` bytes from the start address (DfuSe block numbers start at 2). */
  override async doUpload(xferSize: number, maxSize: number): Promise<Blob> {
    if (!this.memoryInfo) throw new DfuError('No memory map available')
    const startAddress = this.transferStart(this.memoryInfo, (m) => this.logWarning(m))

    this.logInfo(`Reading up to 0x${maxSize.toString(16)} bytes starting at 0x${startAddress.toString(16)}`)
    const state = await this.getState()
    if (state !== DfuState.dfuIDLE) await this.abortToIdle()
    await this.dfuseCommand(DfuseCommand.SET_ADDRESS, startAddress, 4)
    await this.abortToIdle()

    // DfuSe encodes the read address based on the transfer size,
    // the block number - 2, and the SET_ADDRESS pointer.
    return super.doUpload(xferSize, maxSize, 2)
  }
}
