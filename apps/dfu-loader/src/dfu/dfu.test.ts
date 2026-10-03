// Oracle tests: upstream webdfu (dfu.js, dfuse.js) and the port drive identical scripted USB
// devices; the control transfers, log messages and results must match.
import { describe, expect, it } from 'vitest'
import { DfuDevice, findDeviceDfuInterfaces, parseConfigurationDescriptor, type DfuLogEvent } from './dfu.js'
import { DfuseDevice, parseMemoryDescriptor } from './dfuse.js'
import { FakeUsb, FakeUsbDevice, type FakeOptions, type UsbCall } from '../test-utils/fake-usb.js'
import { loadUpstreamDfu, type UpstreamDevice } from '../test-utils/upstream.js'

const F4 = '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg'

/** Real STM32 DfuSe memory layout strings. */
const LAYOUTS = [
  F4, // STM32F405/F427
  '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,03*128Kg', // STM32F401
  '@Internal Flash  /0x08000000/04*032Kg,01*128Kg,03*256Kg', // STM32F7x5/F7x6
  '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg,04*016Kg,01*064Kg,07*128Kg', // STM32F42x dual bank
  '@Internal Flash   /0x08000000/16*128Kg', // STM32H743 (one bank)
  '@Internal Flash   /0x08000000/8*128Kg', // STM32H750
  '@Internal Flash   /0x08000000/256*02Kg', // STM32G4
  '@Internal Flash  /0x08000000/064*0002Kg', // STM32F303
  '@Internal Flash  /0x08000000/04*016Ka,01*064Kg,07*128Kg', // read-only first sectors
  '@Option Bytes  /0x1FFFC000/01*016 e', // STM32F4 option bytes
  '@OTP Memory /0x1FFF7800/01*512 e,01*016 e', // STM32F4 OTP
  '@Device Feature/0xFFFF0000/01*004 e',
  '@Internal Flash /0x08000000/02*016Kg/0x08010000/01*064Kg', // two contiguous runs with a gap
  '@SRAM /0x20000000/64*001Kg'
]

interface Run {
  calls: UsbCall[]
  logs: DfuLogEvent[]
  result: unknown
  error: string | null
  fake: FakeUsbDevice
}

async function runUpstream(
  options: FakeOptions,
  kind: 'dfu' | 'dfuse',
  action: (d: UpstreamDevice, fake: FakeUsbDevice) => Promise<unknown>
): Promise<Run> {
  const fake = new FakeUsbDevice(options)
  const usb = new FakeUsb([fake])
  const up = loadUpstreamDfu(usb)
  const settings = up.dfu.findDeviceDfuInterfaces(fake.usb)[0]
  const device = new up[kind].Device(fake.usb, settings)
  const logs: DfuLogEvent[] = []
  device.logDebug = (message) => logs.push({ kind: 'debug', message })
  device.logInfo = (message) => logs.push({ kind: 'info', message })
  device.logWarning = (message) => logs.push({ kind: 'warning', message })
  device.logError = (message) => logs.push({ kind: 'error', message })
  device.logProgress = (done, total) => logs.push({ kind: 'progress', done, total })
  let result: unknown = null
  let error: string | null = null
  try {
    result = await action(device, fake)
  } catch (e) {
    error = String(e)
  }
  return { calls: fake.calls, logs, result, error, fake }
}

async function runPort<D extends DfuDevice>(
  options: FakeOptions,
  make: (usb: USBDevice, settings: ReturnType<typeof findDeviceDfuInterfaces>[number]) => D,
  action: (d: D, fake: FakeUsbDevice) => Promise<unknown>
): Promise<Run> {
  const fake = new FakeUsbDevice(options)
  const settings = findDeviceDfuInterfaces(fake.usb)[0]!
  const device = make(fake.usb, settings)
  const logs: DfuLogEvent[] = []
  device.onLog = (event) => logs.push(event)
  let result: unknown = null
  let error: string | null = null
  try {
    result = await action(device, fake)
  } catch (e) {
    error = String(e)
  }
  return { calls: fake.calls, logs, result, error, fake }
}

const dfuse = (usb: USBDevice, settings: ReturnType<typeof findDeviceDfuInterfaces>[number]) => new DfuseDevice(usb, settings)
const plain = (usb: USBDevice, settings: ReturnType<typeof findDeviceDfuInterfaces>[number]) => new DfuDevice(usb, settings)

function expectSame(port: Run, up: Run) {
  expect(up.calls.length + up.logs.length + (up.error === null ? 0 : 1)).toBeGreaterThan(0)
  expect(port.calls).toEqual(up.calls)
  expect(port.logs).toEqual(up.logs)
  expect(port.error).toEqual(up.error)
}

function firmware(size: number, seed = 7): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed) & 0xff)
}

async function blobBytes(blob: unknown): Promise<number[]> {
  return Array.from(new Uint8Array(await (blob as Blob).arrayBuffer()))
}

const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (key, value: unknown) => (key === 'kind' ? undefined : value)))

const dfuseOptions = (layout: string, extra: Partial<FakeOptions> = {}): FakeOptions => ({
  alternates: [{ alternateSetting: 0, interfaceName: layout }],
  ...extra
})

describe('descriptor parsing', () => {
  it('parses memory layouts exactly as upstream', () => {
    const up = loadUpstreamDfu()
    for (const layout of LAYOUTS)
      expect(json(parseMemoryDescriptor(layout))).toEqual(json(up.dfuse.parseMemoryDescriptor(layout)))
  })

  it('rejects non-DfuSe descriptors with upstream message', () => {
    const up = loadUpstreamDfu()
    for (const desc of ['Internal Flash', '@Internal Flash', 'STM32 BOOTLOADER']) {
      let upError = ''
      try {
        up.dfuse.parseMemoryDescriptor(desc)
      } catch (e) {
        upError = String(e)
      }
      expect(() => parseMemoryDescriptor(desc)).toThrow(upError)
      expect(upError).toBe(`Not a DfuSe memory descriptor: "${desc}"`)
    }
  })

  it('parses configuration descriptors as upstream', () => {
    const up = loadUpstreamDfu()
    const fakes = [
      new FakeUsbDevice({
        alternates: [
          { alternateSetting: 0, interfaceName: F4 },
          { alternateSetting: 1, interfaceName: '@Option Bytes  /0x1FFFC000/01*016 e' },
          { alternateSetting: 2, interfaceName: 'cdc', interfaceClass: 0x02 }
        ],
        bmAttributes: 0x07,
        transferSize: 2048,
        dfuVersion: 0x011a
      }),
      new FakeUsbDevice({ alternates: [{ alternateSetting: 0, interfaceName: 'x' }], noFunctionalDescriptor: true })
    ]
    for (const fake of fakes) {
      const bytes = fake.configDescriptor()
      // Append an endpoint descriptor after the interfaces
      bytes.push(7, 5, 0x81, 3, 8, 0, 10)
      bytes[2] = bytes.length & 0xff
      const data = new DataView(new Uint8Array(bytes).buffer)
      const portDesc = parseConfigurationDescriptor(data)
      const upDesc = up.dfu.parseConfigurationDescriptor(data)
      expect(json(portDesc)).toEqual(json(upDesc))
      expect(portDesc.descriptors.map((d) => d.bDescriptorType)).toEqual(
        (upDesc as { descriptors: { bDescriptorType: number }[] }).descriptors.map((d) => d.bDescriptorType)
      )
    }
  })

  it('finds the same DFU interfaces', () => {
    const up = loadUpstreamDfu()
    const fake = new FakeUsbDevice({
      alternates: [
        { alternateSetting: 0, interfaceName: F4 },
        { alternateSetting: 1, interfaceName: 'runtime', interfaceProtocol: 1 },
        { alternateSetting: 2, interfaceName: 'other', interfaceProtocol: 3 },
        { alternateSetting: 3, interfaceName: 'cdc', interfaceClass: 2 }
      ]
    })
    expect(findDeviceDfuInterfaces(fake.usb).map((s) => s.name)).toEqual(
      up.dfu.findDeviceDfuInterfaces(fake.usb).map((s) => s.name)
    )
  })
})

describe('device requests', () => {
  it('opens, reads descriptors and strings and detaches identically', async () => {
    const options: FakeOptions = {
      alternates: [
        { alternateSetting: 0, interfaceName: F4 },
        { alternateSetting: 1, interfaceName: '@Option Bytes  /0x1FFFC000/01*016 e' }
      ]
    }
    const up = await runUpstream(options, 'dfu', async (d) => {
      await d.open()
      const config = await d.readConfigurationDescriptor(0)
      const langs = await d.readStringDescriptor(4)
      const name = await d.readStringDescriptor(4, 0x0409)
      const names = await d.readInterfaceNames()
      await d.detach()
      await d.close()
      return json({ bytes: Array.from(new Uint8Array(config.buffer)), langs, name, names })
    })
    const port = await runPort(options, plain, async (d) => {
      await d.open()
      const config = await d.readConfigurationDescriptor(0)
      const langs = await d.readStringDescriptor(4)
      const name = await d.readStringDescriptor(4, 0x0409)
      const map = await d.readInterfaceNames()
      const names = Object.fromEntries(
        [...map].map(([c, intfs]) => [c, Object.fromEntries([...intfs].map(([i, alts]) => [i, Object.fromEntries(alts)]))])
      )
      await d.detach()
      await d.close()
      return json({ bytes: Array.from(new Uint8Array(config.buffer)), langs, name, names })
    })
    expectSame(port, up)
    expect(port.result).toEqual(up.result)
  })

  it('reports a stalled descriptor read the same way', async () => {
    const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: F4 }], stall: (c) => c.op === 'in' }
    const up = await runUpstream(options, 'dfu', (d) => d.readStringDescriptor(4, 0x0409))
    const port = await runPort(options, plain, (d) => d.readStringDescriptor(4, 0x0409))
    expectSame(port, up)
    expect(port.error).toBe('Failed to read string descriptor 4: stall')
  })

  it('getStatus and getState wrap failures as upstream', async () => {
    for (const fail of [{ stall: (c: UsbCall) => c.op === 'in' }, { throwOn: (c: UsbCall) => c.op === 'in' }]) {
      const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: F4 }], ...fail }
      for (const which of ['status', 'state'] as const) {
        const up = await runUpstream(options, 'dfu', (d) => (which === 'status' ? d.getStatus() : d.getState()))
        const port = await runPort(options, plain, (d) => (which === 'status' ? d.getStatus() : d.getState()))
        expectSame(port, up)
        expect(port.error).not.toBeNull()
      }
    }
  })

  it('aborts to idle, clearing an error state', async () => {
    const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: F4 }], abortState: 10 }
    const up = await runUpstream(options, 'dfu', (d) => d.abortToIdle())
    const port = await runPort(options, plain, (d) => d.abortToIdle())
    expectSame(port, up)
    expect(port.error).toBeNull()
  })

  it('fails abort-to-idle when the device stays in error (message differs only in the state value)', async () => {
    const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: F4 }], abortState: 10, clearState: 10 }
    const up = await runUpstream(options, 'dfu', (d) => d.abortToIdle())
    const port = await runPort(options, plain, (d) => d.abortToIdle())
    expect(port.calls).toEqual(up.calls)
    expect(up.error).toBe('Failed to return to idle state after abort: state undefined')
    expect(port.error).toBe('Failed to return to idle state after abort: state 10')
  })

  it('waits for the disconnect event', async () => {
    const fake = new FakeUsbDevice({ alternates: [{ alternateSetting: 0, interfaceName: F4 }] })
    const usb = new FakeUsb([fake])
    const up = loadUpstreamDfu(usb)
    const upDevice = new up.dfu.Device(fake.usb, up.dfu.findDeviceDfuInterfaces(fake.usb)[0])
    const portDevice = new DfuDevice(fake.usb, findDeviceDfuInterfaces(fake.usb)[0]!)
    const both = Promise.all([upDevice.waitDisconnected(5000), portDevice.waitDisconnected(5000, usb.usb)])
    usb.disconnect(fake)
    const [a, b] = await both
    expect(a).toBe(upDevice)
    expect(b).toBe(portDevice)
    expect(portDevice.disconnected).toBe(true)
  })
})

describe('DfuSe erase', () => {
  const cases: [string, number, number][] = [
    [F4, 0x08000000, 1],
    [F4, 0x08000000, 0x4000],
    [F4, 0x08003000, 0x2000],
    [F4, 0x08000000, 0x30000],
    [F4, 0x0800c000, 0x14001],
    [F4, 0x08000000, 0], // end address before the map: error
    [F4, 0x07ff0000, 16], // start outside the map: error
    ['@Internal Flash  /0x08000000/04*016Ka,01*064Kg,07*128Kg', 0x08000000, 0x20000],
    ['@Internal Flash /0x08000000/02*016Kg/0x08010000/01*064Kg', 0x08000000, 0x18000], // crosses a gap: error
    ['@Internal Flash   /0x08000000/256*02Kg', 0x08000400, 0x1900]
  ]
  for (const [layout, start, length] of cases) {
    it(`erases ${length} bytes at 0x${start.toString(16)} on ${layout.slice(0, 30)}...`, async () => {
      const options = dfuseOptions(layout, { pollTimeout: 1 })
      const up = await runUpstream(options, 'dfuse', (d) => d.erase(start, length))
      const port = await runPort(options, dfuse, (d) => d.erase(start, length))
      expect(port.calls).toEqual(up.calls)
      expect(port.logs).toEqual(up.logs)
      expect(port.fake.erased).toEqual(up.fake.erased)
      // Upstream crashes with a TypeError on a gap; the port reports the address instead.
      if (up.error?.startsWith('TypeError')) expect(port.error).toBe('Address 8008000 outside of memory map')
      else expect(port.error).toEqual(up.error)
    })
  }
})

describe('downloads', () => {
  it('writes a .bin at a DfuSe start address', async () => {
    const data = firmware(2500)
    const options = dfuseOptions(F4, { pollTimeout: 3 })
    const up = await runUpstream(options, 'dfuse', (d) => {
      d.startAddress = 0x08004000
      return d.do_download(1024, data.buffer, false)
    })
    const port = await runPort(options, dfuse, (d) => {
      d.startAddress = 0x08004000
      return d.doDownload(1024, data.buffer)
    })
    expectSame(port, up)
    expect(port.error).toBeNull()
    expect(port.fake.memory).toEqual(up.fake.memory)
  })

  it('infers the start address when none is set', async () => {
    const data = firmware(300)
    const options = dfuseOptions(F4)
    const up = await runUpstream(options, 'dfuse', (d) => d.do_download(256, data, true))
    const port = await runPort(options, dfuse, (d) => d.doDownload(256, data))
    expectSame(port, up)
    expect(port.logs).toContainEqual({ kind: 'warning', message: 'Using inferred start address 0x8000000' })
  })

  it('reports a start address outside the map, then fails to erase', async () => {
    const options = dfuseOptions(F4)
    const up = await runUpstream(options, 'dfuse', (d) => {
      d.startAddress = 0x20000000
      return d.do_download(1024, firmware(10), true)
    })
    const port = await runPort(options, dfuse, (d) => {
      d.startAddress = 0x20000000
      return d.doDownload(1024, firmware(10))
    })
    expectSame(port, up)
  })

  it('writes the bytes of a converted .hex image', async () => {
    const options = dfuseOptions(F4, { transferSize: 2048 })
    const data = firmware(5000, 3)
    const up = await runUpstream(options, 'dfuse', (d) => {
      d.startAddress = 0x08000000
      return d.do_download(2048, data, true)
    })
    const port = await runPort(options, dfuse, (d) => {
      d.startAddress = 0x08000000
      return d.doDownload(2048, data)
    })
    expectSame(port, up)
  })

  it('writes with plain DFU', async () => {
    const options: FakeOptions = {
      alternates: [{ alternateSetting: 0, interfaceName: 'Flash' }],
      dfuVersion: 0x0110,
      pollTimeout: 2
    }
    const data = firmware(3000)
    const up = await runUpstream(options, 'dfu', (d) => d.do_download(1024, data.buffer, false))
    const port = await runPort(options, plain, (d) => d.doDownload(1024, data.buffer))
    expectSame(port, up)
    expect(port.error).toBeNull()
  })

  it('stops on an error status during a plain DFU download', async () => {
    const options: FakeOptions = {
      alternates: [{ alternateSetting: 0, interfaceName: 'Flash' }],
      dfuVersion: 0x0110,
      failGetStatus: { at: 3, status: 0x06 }
    }
    const up = await runUpstream(options, 'dfu', (d) => d.do_download(1024, firmware(3000), false))
    const port = await runPort(options, plain, (d) => d.doDownload(1024, firmware(3000)))
    expectSame(port, up)
    expect(port.error).toBe('DFU DOWNLOAD failed state=10, status=6')
  })

  it('stops on a stalled or failed transfer', async () => {
    const stalls: Partial<FakeOptions>[] = [
      { stall: (c) => c.op === 'out' && c.request === 1 && c.value === 1 },
      { throwOn: (c) => c.op === 'out' && c.request === 1 && c.value === 2 },
      { stall: (c) => c.op === 'out' && c.request === 1 && c.data?.length === 0 }
    ]
    for (const stall of stalls) {
      const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: 'Flash' }], dfuVersion: 0x0110, ...stall }
      const up = await runUpstream(options, 'dfu', (d) => d.do_download(1024, firmware(3000), false))
      const port = await runPort(options, plain, (d) => d.doDownload(1024, firmware(3000)))
      expectSame(port, up)
      expect(port.error).not.toBeNull()
    }
  })

  it('stops on an error status while erasing (upstream crashes with a ReferenceError)', async () => {
    const options = dfuseOptions(F4, { failGetStatus: { at: 4, status: 0x0a } })
    const up = await runUpstream(options, 'dfuse', (d) => d.do_download(1024, firmware(40000), true))
    const port = await runPort(options, dfuse, (d) => d.doDownload(1024, firmware(40000)))
    expect(port.calls).toEqual(up.calls)
    expect(port.logs).toEqual(up.logs)
    expect(up.error).toBe('ReferenceError: commandName is not defined')
    expect(port.error).toBe('Special DfuSe command ERASE_SECTOR failed')
  })

  it('stops on an error status while setting the address', async () => {
    // Erasing one 16K sector takes two GETSTATUS polls; the third is the first SET_ADDRESS.
    const options = dfuseOptions(F4, { failGetStatus: { at: 3, status: 0x03 } })
    const up = await runUpstream(options, 'dfuse', (d) => d.do_download(1024, firmware(100), true))
    const port = await runPort(options, dfuse, (d) => d.doDownload(1024, firmware(100)))
    expect(port.calls).toEqual(up.calls)
    expect(port.logs).toEqual(up.logs)
    expect(up.error).toBe('Error during DfuSe download: ReferenceError: commandName is not defined')
    expect(port.error).toBe('Error during DfuSe download: Special DfuSe command SET_ADDRESS failed')
  })

  it('stops on an error status after a DfuSe block write', async () => {
    const options = dfuseOptions(F4, { failGetStatus: { at: 6, status: 0x06 } })
    const up = await runUpstream(options, 'dfuse', (d) => d.do_download(1024, firmware(2000), true))
    const port = await runPort(options, dfuse, (d) => d.doDownload(1024, firmware(2000)))
    expectSame(port, up)
    expect(port.error).toBe('DFU DOWNLOAD failed state=10, status=6')
  })

  it('ignores errors once manifestation starts', async () => {
    for (const extra of [
      { manifestState: 10 },
      { throwOn: (c: UsbCall, i: number) => i > 20 && c.op === 'in' },
      { stall: (c: UsbCall, i: number) => i > 20 && c.op === 'in' }
    ]) {
      const options = dfuseOptions(F4, extra)
      const up = await runUpstream(options, 'dfuse', (d) => d.do_download(1024, firmware(2000), true))
      const port = await runPort(options, dfuse, (d) => d.doDownload(1024, firmware(2000)))
      expectSame(port, up)
    }
  })

  it('fails without a memory map', async () => {
    const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: null }] }
    const up = await runUpstream(options, 'dfuse', (d) => d.do_download(1024, firmware(10), true))
    const port = await runPort(options, dfuse, (d) => d.doDownload(1024, firmware(10)))
    expectSame(port, up)
    expect(port.error).toBe('No memory map available')
  })
})

describe('uploads', () => {
  it('reads with plain DFU until a short block', async () => {
    const options: FakeOptions = {
      alternates: [{ alternateSetting: 0, interfaceName: 'Flash' }],
      dfuVersion: 0x0110,
      uploadImageSize: 3000
    }
    const up = await runUpstream(options, 'dfu', async (d) => blobBytes(await d.do_upload(1024)))
    const port = await runPort(options, plain, async (d) => blobBytes(await d.doUpload(1024)))
    expectSame(port, up)
    expect(port.result).toEqual(up.result)
    expect((port.result as number[]).length).toBe(3000)
  })

  it('reads with plain DFU up to a size, then aborts to idle', async () => {
    const options: FakeOptions = { alternates: [{ alternateSetting: 0, interfaceName: 'Flash' }], dfuVersion: 0x0110 }
    const up = await runUpstream(options, 'dfu', async (d) => blobBytes(await d.do_upload(1024, 2048)))
    const port = await runPort(options, plain, async (d) => blobBytes(await d.doUpload(1024, 2048)))
    expectSame(port, up)
    expect(port.result).toEqual(up.result)
  })

  it('reads with DfuSe from the start address', async () => {
    for (const [start, size, initialState] of [
      [0x08000000, 5000, 2],
      [0x0800fc00, 0x800, 10],
      [0x080ffc00, 0x1000, 2]
    ] as const) {
      const options = dfuseOptions(F4, { initialState })
      const up = await runUpstream(options, 'dfuse', async (d) => {
        d.startAddress = start
        return blobBytes(await d.do_upload(1024, size))
      })
      const port = await runPort(options, dfuse, async (d) => {
        d.startAddress = start
        return blobBytes(await d.doUpload(1024, size))
      })
      expectSame(port, up)
      expect(port.result).toEqual(up.result)
    }
  })

  it('warns when the DfuSe upload start is inferred or outside the map', async () => {
    for (const start of [null, 0x30000000]) {
      const options = dfuseOptions(F4, { memoryEnd: 0x30000400 })
      const up = await runUpstream(options, 'dfuse', async (d) => {
        if (start !== null) d.startAddress = start
        return blobBytes(await d.do_upload(1024, 1024))
      })
      const port = await runPort(options, dfuse, async (d) => {
        d.startAddress = start
        return blobBytes(await d.doUpload(1024, 1024))
      })
      expectSame(port, up)
    }
  })
})
