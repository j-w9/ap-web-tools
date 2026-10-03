// Reproductions of the DFU Loader rows in docs/upstream-bugs.md, run against upstream/DFULoader.
// Verdicts and evidence: docs/bug-proofs/dfu-loader.md.
import { runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  F4_MAP,
  FakeDevice,
  FakeUsb,
  intelHex,
  loadUpstreamDfu,
  loadUpstreamPage,
  loadUpstreamParseIntelHex,
  readUpstream,
  settle,
  type FakeOptions,
  type PageOptions
} from './_harness.js'

const toBuffer = (text: string): ArrayBuffer => new TextEncoder().encode(text).slice().buffer
const firmware = (size: number): ArrayBuffer => Uint8Array.from({ length: size }, (_, i) => (i * 7 + 1) & 0xff).buffer

function page(options: FakeOptions, pageOptions: PageOptions = {}) {
  const device = new FakeDevice(options)
  const usb = new FakeUsb([device])
  return { device, usb, p: loadUpstreamPage(usb, pageOptions) }
}

/** Runs `run` with the process's unhandled-rejection listeners swapped for a recorder. */
async function recordUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
  const saved = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  const reasons: unknown[] = []
  const record = (reason: unknown) => reasons.push(reason)
  process.on('unhandledRejection', record)
  try {
    await run()
    await settle()
  } finally {
    process.off('unhandledRejection', record)
    for (const listener of saved) process.on('unhandledRejection', listener)
  }
  return reasons
}

const PROPERTIES =
  'WillDetach=true, ManifestationTolerant=false, CanUpload=true, CanDnload=true, TransferSize=1024, DetachTimeOut=255, Version=011a'

describe('DFU Loader upstream bugs', () => {
  it('R51: parseIntelHex places data records at their 16-bit address and never applies type 4 records', () => {
    const parseIntelHex = loadUpstreamParseIntelHex()
    // 8 KiB at 0x0800F000..0x08011000: 4 KiB below the 64 KiB boundary, 4 KiB above it.
    const data = Array.from({ length: 0x2000 }, (_, i) => (i % 251) + 1)
    const out = parseIntelHex(toBuffer(intelHex(0x0800f000, data)))
    expect(out.length).toBe(0x10000)
    // The second 4 KiB (absolute 0x08010000..) lands at offset 0, the first 4 KiB at 0xF000.
    expect(Array.from(out.subarray(0, 0x1000))).toEqual(data.slice(0x1000))
    expect(Array.from(out.subarray(0xf000))).toEqual(data.slice(0, 0x1000))
    expect(out.subarray(0x1000, 0xf000).every((b) => b === 0)).toBe(true)
    // A file in a single 64 KiB segment comes out at the segment-relative offset, as upstream intends.
    expect(Array.from(parseIntelHex(toBuffer(intelHex(0x08000010, [1, 2, 3]))))).toEqual([...Array<number>(16).fill(0), 1, 2, 3])
  })

  it('R51: offsets never pass 0xFFFF + 255, so nothing is ever written near the 512 KiB end of the buffer', () => {
    // 128 KiB of data: the two 64 KiB segments are overlaid on the same 64 KiB.
    const parseIntelHex = loadUpstreamParseIntelHex()
    const out = parseIntelHex(toBuffer(intelHex(0x08000000, Array<number>(0x20000).fill(0xaa))))
    expect(out.length).toBe(0x10000)
  })

  it('R52: a start address change lowers the upload size max but not its value', async () => {
    const { p } = page({ name: F4_MAP })
    p.click('connect')
    await settle()
    expect(p.el.dfuseUploadSize.value).toBe(1048576)
    expect(p.el.dfuseUploadSize.max).toBe(1048576)
    p.changeStartAddress('0x08020000')
    expect(p.el.dfuseStartAddress.customValidity).toBe('')
    expect(p.el.dfuseUploadSize.value).toBe(1048576)
    expect(p.el.dfuseUploadSize.max).toBe(917504)
  })

  it('R53: "Converted Hex to bin" is dropped when no flash is running', async () => {
    const { p } = page({ name: F4_MAP })
    p.click('connect')
    await settle()
    p.chooseFile('bootloader.hex', toBuffer(intelHex(0x08000000, [1, 2, 3, 4])))
    await settle()
    expect(p.el.downloadLog.children).toEqual([])
    // The file was converted: flashing writes the 4 converted bytes, not the HEX text.
    const run = page({ name: F4_MAP })
    run.p.click('connect')
    await settle()
    run.p.chooseFile('bootloader.hex', toBuffer(intelHex(0x08000000, [1, 2, 3, 4])))
    await settle()
    await run.p.flash()
    await settle()
    expect(run.device.calls.filter((c) => c.value === 2).map((c) => c.data)).toEqual([[1, 2, 3, 4]])
    expect(run.p.log()).not.toContain('info: Converted Hex to bin')
  })

  it('R54: on a successful connect the properties line is appended, then overwritten', async () => {
    const { p } = page({ name: F4_MAP })
    p.click('connect')
    await settle()
    expect(p.el.dfuInfo.textContent).toBe(
      'DFU: [0483:df11] cfg=1, intf=0, alt=0, name="STM32  BOOTLOADER" serial="336C34653033"\n' +
        'Selected memory region: Internal Flash (1MiB)\n' +
        '0x08000000-0x0800ffff (readable, erasable, writable)\n' +
        '0x08010000-0x0801ffff (readable, erasable, writable)\n' +
        '0x08020000-0x080fffff (readable, erasable, writable)'
    )
    expect(String(p.el.dfuInfo.textContent)).not.toContain('WillDetach')
  })

  it('R143: after a failed connect the properties line stays, once more per attempt', async () => {
    const { p } = page({ name: 'Bootloader' })
    p.click('connect')
    await settle()
    expect(p.el.status.textContent).toBe('Not a DfuSe memory descriptor: "Bootloader"')
    expect(p.el.dfuInfo.textContent).toBe(`\n${PROPERTIES}`)
    p.click('connect')
    await settle()
    expect(p.el.dfuInfo.textContent).toBe(`\n${PROPERTIES}\n${PROPERTIES}`)
  })

  it('R55: a DFU interface without CanDnload throws ReferenceError: dnloadButton is not defined', async () => {
    const { p } = page({ name: F4_MAP, bmAttributes: 0x0a })
    p.click('connect')
    await settle()
    expect(String(p.el.status.textContent)).toBe('ReferenceError: dnloadButton is not defined')
    expect(p.el.connect.textContent).toBe('Connect')
    expect(p.el.download.disabled).toBe(true)
  })

  it('R55: a failed DfuSe command throws ReferenceError: commandName is not defined', async () => {
    const device = new FakeDevice({ name: F4_MAP, status: 0x0b, state: 10 })
    const { dfuse } = loadUpstreamDfu()
    const d = new dfuse.Device(device, device.settings())
    d.logProgress = () => undefined
    let error: unknown
    await d.erase(0x08000000, 16).catch((e: unknown) => (error = e))
    expect(String(error)).toBe('ReferenceError: commandName is not defined')
    expect(device.erases()).toEqual([0x08000000])
  })

  it('R144: the start address custom validity survives a reconnect and blocks Flash Bootloader', async () => {
    const { p, device } = page({ name: F4_MAP })
    p.click('connect')
    await settle()
    p.changeStartAddress('0x1000')
    expect(p.el.dfuseStartAddress.customValidity).toBe('Address outside of memory map')
    p.click('connect') // disconnect
    await settle()
    expect(p.el.connect.textContent).toBe('Connect')
    p.click('connect') // reconnect
    await settle()
    expect(p.el.dfuseStartAddress.value).toBe('0x8000000')
    expect(p.el.dfuseStartAddress.customValidity).toBe('Address outside of memory map')
    p.chooseFile('bootloader.bin', firmware(64))
    await settle()
    const before = device.calls.length
    expect(await p.flash()).toBe(false)
    await settle()
    expect(device.calls.length).toBe(before)
    // The page's own check judges the same value valid.
    p.changeStartAddress('0x8000000')
    expect(p.el.dfuseStartAddress.customValidity).toBe('')
  })

  it('R145: Flash Bootloader is a button without a type inside #configForm, next to the DfuSe text fields', () => {
    const html = readUpstream('index.html')
    const form = html.slice(
      html.indexOf('<form id="configForm">'),
      html.indexOf('</form>', html.indexOf('<form id="configForm">'))
    )
    expect(form.match(/<button[^>]*>/g)).toEqual(['<button id="download" disabled="true">'])
    expect(form).toContain('<input type="text" name="dfuseStartAddress"')
    expect(form).toContain('<input type="number" name="dfuseUploadSize"')
  })

  it('R146: a second press during a flash clears the log and starts a second download', async () => {
    const { p, device } = page({ name: F4_MAP })
    p.click('connect')
    await settle()
    p.chooseFile('bootloader.bin', firmware(2048))
    await settle()
    await Promise.all([p.flash(), p.flash()])
    await settle()
    expect(device.erases()).toEqual([0x08000000, 0x08000000])
    expect(device.dataBlocks()).toBe(4)
    expect(p.log().filter((l) => l === 'info: Done!')).toHaveLength(1)
  })

  it('R147: abortToIdle reports "state undefined"', async () => {
    const device = new FakeDevice({ name: F4_MAP, abortState: 5 })
    const { dfu } = loadUpstreamDfu()
    const d = new dfu.Device(device, device.settings())
    await expect(d.abortToIdle()).rejects.toBe('Failed to return to idle state after abort: state undefined')
  })

  it('R148: waitDisconnected rejects with no reason on timeout and leaves its listener attached', async () => {
    const device = new FakeDevice({ name: F4_MAP })
    const usb = new FakeUsb([device])
    const { dfu } = loadUpstreamDfu(usb)
    const d = new dfu.Device(device, device.settings())
    let reason: unknown = 'not rejected'
    await d.waitDisconnected(10).catch((e: unknown) => (reason = e))
    expect(reason).toBeUndefined()
    expect(usb.disconnectListeners).toBe(1)
  })

  it('R149 open: a redundant SET_INTERFACE failure is recognised only when the rejection is a string', async () => {
    const { dfu } = loadUpstreamDfu()
    const error = (selectAltError: unknown) => {
      const device = new FakeDevice({ name: F4_MAP, selectAltError, alternates: 2 })
      const d = new dfu.Device(device, device.settings())
      const warnings: string[] = []
      d.logWarning = (m) => warnings.push(m)
      return d.open().then(
        () => warnings,
        (e: unknown) => String(e)
      )
    }
    expect(await error('NetworkError: Unable to set device interface.')).toEqual([
      'Redundant SET_INTERFACE request to select altSetting 0 failed'
    ])
    expect(await error(new Error('Unable to set device interface.'))).toBe('TypeError: error.endsWith is not a function')
  })

  it('R149 parseSubDescriptors: a zero-length descriptor never terminates', () => {
    const { context } = loadUpstreamDfu()
    expect(() =>
      runInContext('dfu.parseSubDescriptors(new DataView(new Uint8Array([0, 5, 0, 0]).buffer))', context, { timeout: 200 })
    ).toThrow('Script execution timed out after 200ms')
  })

  it('R149 erase: a range across a gap in the memory map throws a TypeError', async () => {
    const device = new FakeDevice({ name: '@Flash /0x08000000/01*016Kg/0x08008000/01*016Kg' })
    const { dfuse } = loadUpstreamDfu()
    const d = new dfuse.Device(device, device.settings())
    d.logProgress = () => undefined
    let error: unknown
    await d.erase(0x08000000, 0x9000).catch((e: unknown) => (error = e))
    expect(String(error)).toBe("TypeError: Cannot read properties of null (reading 'erasable')")
    expect(device.erases()).toEqual([0x08000000])
  })

  it('R149 fixInterfaceNames: an interface missing from the configuration descriptor throws a TypeError', async () => {
    // The browser reports interface 0 with no name; the configuration descriptor only has interface 1.
    const configDescriptor = [
      9, 2, 27, 0, 1, 1, 0, 0xc0, 0x32, 9, 4, 1, 0, 0, 0xfe, 1, 2, 4, 9, 0x21, 0x0b, 255, 0, 0, 4, 0x1a, 1
    ]
    const { p } = page({ name: null, configDescriptor })
    p.click('connect')
    await settle()
    expect(String(p.el.status.textContent)).toBe("TypeError: Cannot read properties of undefined (reading '0')")
  })

  it('R149 autoConnect: the undeclared vidField throws after a successful connect (unhandled)', async () => {
    let view: ReturnType<typeof page> | undefined
    const reasons = await recordUnhandledRejections(async () => {
      view = page({ name: F4_MAP }, { search: '?serial=336C34653033' })
      await settle()
    })
    expect(reasons.map(String)).toEqual(['ReferenceError: vidField is not defined'])
    expect(view?.p.el.connect.textContent).toBe('Disconnect')
    expect(view?.p.el.status.textContent).toBe('')
  })

  it('R149 autoConnect: a failed connect is an unhandled rejection and leaves "Connecting..."', async () => {
    let view: ReturnType<typeof page> | undefined
    const reasons = await recordUnhandledRejections(async () => {
      view = page({ name: 'Bootloader' }, { search: '?serial=336C34653033' })
      await settle()
    })
    expect(reasons).toEqual(['Not a DfuSe memory descriptor: "Bootloader"'])
    expect(view?.p.el.status.textContent).toBe('Connecting...')
    expect(view?.p.el.connect.textContent).toBe('Connect')
  })
})
