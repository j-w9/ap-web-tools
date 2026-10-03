// Oracle tests for the page flow: upstream dfu-util.js on a fake DOM and the port's LoaderSession
// drive identical scripted USB devices; transfers, status texts, fields and the log must match.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoaderSession, landingPageSerial, validateDfuseFields, type Snapshot } from './session.js'
import { FakeUsb, FakeUsbDevice, settle, type FakeOptions, type UsbCall } from '../test-utils/fake-usb.js'
import { intelHex } from '../test-utils/hex.js'
import { loadUpstreamPage, type UpstreamPage } from '../test-utils/upstream.js'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'debug').mockImplementation(() => undefined)
})

const F4 = '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg'

interface Pair {
  page: UpstreamPage
  session: LoaderSession
  upFake: FakeUsbDevice
  portFake: FakeUsbDevice
  upUsb: FakeUsb
  portUsb: FakeUsb
  state(): Snapshot
}

function setup(options: FakeOptions | null, search = '', devices = 1): Pair {
  const fakes = (n: number) => (options ? Array.from({ length: n }, () => new FakeUsbDevice(options)) : [])
  const upDevices = fakes(devices)
  const portDevices = fakes(devices)
  const upUsb = new FakeUsb(upDevices)
  const portUsb = new FakeUsb(portDevices)
  const page = loadUpstreamPage(upUsb, search)
  const session = new LoaderSession(portUsb.usb, search)
  session.start()
  const none = new FakeUsbDevice({ alternates: [] })
  return {
    page,
    session,
    upFake: upDevices[0] ?? none,
    portFake: portDevices[0] ?? none,
    upUsb,
    portUsb,
    state: () => session.getSnapshot()
  }
}

/** Everything upstream's page shows, read from the fake DOM, and the port's equivalent. */
function view(p: Pair) {
  const { el } = p.page
  const s = p.state()
  return {
    upstream: {
      status: String(el.status.textContent),
      connect: String(el.connect.textContent),
      usbInfo: String(el.usbInfo.textContent),
      dfuInfo: String(el.dfuInfo.textContent),
      flashDisabled: el.download.disabled,
      fileDisabled: el.firmwareFile.disabled,
      dfuseHidden: el.dfuseFields.hidden,
      startAddress: String(el.dfuseStartAddress.value),
      startDisabled: el.dfuseStartAddress.disabled,
      startValidity: el.dfuseStartAddress.customValidity,
      uploadSize: String(el.dfuseUploadSize.value),
      uploadDisabled: el.dfuseUploadSize.disabled,
      uploadMax: el.dfuseUploadSize.max === undefined ? null : Number(el.dfuseUploadSize.max)
    },
    port: {
      status: s.status?.text ?? '',
      connect: s.connectLabel,
      usbInfo: s.connected?.usbInfo ?? '',
      // Upstream shows the summary and memory summary in one block.
      dfuInfo: s.connected ? `${s.connected.summary}\n${s.connected.memorySummary}` : '',
      flashDisabled: !s.flashEnabled,
      fileDisabled: !s.fileEnabled,
      dfuseHidden: s.dfuse.hidden,
      startAddress: s.dfuse.startAddress.value,
      startDisabled: s.dfuse.startAddress.disabled,
      startValidity: s.dfuse.startAddress.customValidity,
      uploadSize: s.dfuse.uploadSize.value,
      uploadDisabled: s.dfuse.uploadSize.disabled,
      uploadMax: s.dfuse.uploadSize.max
    }
  }
}

function expectSameView(p: Pair) {
  const { upstream, port } = view(p)
  expect(port).toEqual(upstream)
}

async function connect(p: Pair) {
  p.page.click('connect')
  await p.session.connectClick()
  await settle(p.upFake, p.portFake)
}

async function chooseFile(p: Pair, name: string, data: ArrayBuffer) {
  p.page.chooseFile(name, data)
  await p.session.chooseFile({ name, arrayBuffer: () => Promise.resolve(data) })
  await settle(p.upFake, p.portFake)
}

async function flash(p: Pair) {
  await Promise.all([p.page.flash(), p.session.flash()])
  await settle(p.upFake, p.portFake)
}

function expectSameRun(p: Pair) {
  expect(p.portFake.calls).toEqual(p.upFake.calls)
  expect(p.state().log).toEqual(p.page.log())
  expectSameView(p)
}

function firmware(size: number): ArrayBuffer {
  return Uint8Array.from({ length: size }, (_, i) => (i * 7 + 1) & 0xff).buffer
}

const dfuse = (extra: Partial<FakeOptions> = {}): FakeOptions => ({
  alternates: [{ alternateSetting: 0, interfaceName: F4 }],
  ...extra
})

describe('page start', () => {
  it('starts with the same controls', () => {
    const p = setup(dfuse())
    expectSameView(p)
  })

  it('reports a missing WebUSB', () => {
    const session = new LoaderSession(undefined, '')
    expect(session.getSnapshot().status?.text).toBe('WebUSB not available.')
    expect(session.getSnapshot().webUsb).toBe(false)
  })

  it('reads the landing page serial with the Chromium workaround', () => {
    expect(landingPageSerial('')).toBeNull()
    expect(landingPageSerial('?serial=ABC')).toBe('ABC')
    expect(landingPageSerial('?serial=ABC/')).toBe('ABC')
    expect(landingPageSerial('?serial=ABC/&x=1')).toBe('ABC/')
  })
})

describe('connect', () => {
  it('connects a DfuSe bootloader and fills the start address and upload size', async () => {
    const p = setup(dfuse({ bmAttributes: 0x0b }))
    await connect(p)
    expectSameRun(p)
    expect(p.upUsb.requested).toEqual([{ filters: [{ vendorId: 0x0483 }] }])
    expect(p.portUsb.requested).toEqual(p.upUsb.requested)
    expect(p.state().connected?.properties).toBe(
      'WillDetach=true, ManifestationTolerant=false, CanUpload=true, CanDnload=true, TransferSize=1024, DetachTimeOut=255, Version=011a'
    )
  })

  it('connects with layouts whose first writable segment is not the first', async () => {
    const p = setup(
      dfuse({ alternates: [{ alternateSetting: 0, interfaceName: '@Internal Flash  /0x08000000/04*016Ka,01*064Kg,07*128Kg' }] })
    )
    await connect(p)
    expectSameRun(p)
    expect(p.state().dfuse.startAddress.value).toBe('0x8010000')
  })

  it('connects a plain DFU device and hides the DfuSe fields', async () => {
    const p = setup(dfuse({ dfuVersion: 0x0110, bmAttributes: 0x01 }))
    await connect(p)
    expectSameRun(p)
    expect(p.state().dfuse.hidden).toBe(true)
  })

  it('connects a runtime interface without enabling flashing', async () => {
    const p = setup(dfuse({ alternates: [{ alternateSetting: 0, interfaceName: 'Runtime', interfaceProtocol: 1 }] }))
    await connect(p)
    expectSameRun(p)
    expect(p.state().flashEnabled).toBe(false)
  })

  it('disables the upload size when the device cannot upload', async () => {
    const p = setup(dfuse({ dfuVersion: 0x0110, bmAttributes: 0x01, noFunctionalDescriptor: false }))
    await connect(p)
    expectSameRun(p)
  })

  it('reads interface names the browser missed', async () => {
    const p = setup({
      alternates: [
        { alternateSetting: 0, interfaceName: null, descriptorName: F4 },
        { alternateSetting: 1, interfaceName: null, descriptorName: '@Option Bytes  /0x1FFFC000/01*016 e' }
      ]
    })
    await connect(p)
    expectSameRun(p)
    expect(p.state().interfaces).toEqual([
      `DFU: cfg=1, intf=0, alt=0, name="${F4}"`,
      'DFU: cfg=1, intf=0, alt=1, name="@Option Bytes  /0x1FFFC000/01*016 e"'
    ])
  })

  it('reports a device without DFU interfaces', async () => {
    const p = setup({ alternates: [{ alternateSetting: 0, interfaceName: 'cdc', interfaceClass: 2 }] })
    await connect(p)
    expectSameRun(p)
    expect(p.state().status?.text).toBe('The selected device does not have any USB DFU interfaces.')
  })

  it('reports a cancelled chooser', async () => {
    const p = setup(null)
    await connect(p)
    expectSameView(p)
    expect(p.state().status?.text).toBe('Error: NotFoundError: No device selected.')
  })

  it('reports a failed open', async () => {
    const p = setup(dfuse({ throwOn: (c) => c.op === 'open' }))
    await connect(p)
    expectSameRun(p)
  })

  it('reports a DfuSe interface whose name is not a memory map', async () => {
    const p = setup(dfuse({ alternates: [{ alternateSetting: 0, interfaceName: 'STM32 BOOTLOADER' }] }))
    await connect(p)
    expect(p.portFake.calls).toEqual(p.upFake.calls)
    const { upstream, port } = view(p)
    // Upstream stops part way through connecting and leaves the properties line in its DFU info.
    expect(port).toEqual({ ...upstream, dfuInfo: '' })
    expect(port.status).toBe('Not a DfuSe memory descriptor: "STM32 BOOTLOADER"')
  })

  it('refuses a DFU interface that cannot download (upstream crashes with a ReferenceError)', async () => {
    const p = setup(dfuse({ bmAttributes: 0x02 }))
    await connect(p)
    expect(p.portFake.calls).toEqual(p.upFake.calls)
    expect(String(p.page.el.status.textContent)).toBe('ReferenceError: dnloadButton is not defined')
    expect(p.state().status?.text).toBe(
      'The DFU interface reports that it cannot download (CanDnload=false), so it cannot be flashed.'
    )
    expect(p.state().connectLabel).toBe(p.page.el.connect.textContent)
    expect(p.state().flashEnabled).toBe(!p.page.el.download.disabled)
  })

  it('disconnects with the Connect button', async () => {
    const p = setup(dfuse())
    await connect(p)
    await connect(p)
    expectSameRun(p)
    expect(p.state().connectLabel).toBe('Connect')
  })

  it('notices an unplugged device', async () => {
    const p = setup(dfuse())
    await connect(p)
    p.upUsb.disconnect(p.upFake)
    p.portUsb.disconnect(p.portFake)
    await settle(p.upFake, p.portFake)
    expectSameRun(p)
    expect(p.state().status?.text).toBe('Device disconnected')
  })
})

describe('auto-connect from the landing page', () => {
  it('connects the device with the given serial', async () => {
    const p = setup(dfuse(), '?serial=336C34653033')
    await settle(p.upFake, p.portFake)
    expectSameRun(p)
    expect(p.state().connectLabel).toBe('Disconnect')
  })

  it('reports no device for another serial', async () => {
    const p = setup(dfuse(), '?serial=XYZ')
    await settle(p.upFake, p.portFake)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expectSameRun(p)
    expect(p.state().status?.text).toBe('No device found.')
  })

  it('reports several matching interfaces', async () => {
    const p = setup(
      {
        alternates: [
          { alternateSetting: 0, interfaceName: F4 },
          { alternateSetting: 1, interfaceName: '@Option Bytes  /0x1FFFC000/01*016 e' }
        ]
      },
      '?serial=336C34653033'
    )
    await settle(p.upFake, p.portFake)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expectSameRun(p)
    expect(p.state().status?.text).toBe('Multiple DFU interfaces found.')
  })

  it('filters the chooser by serial', async () => {
    const p = setup(dfuse(), '?serial=XYZ')
    await connect(p)
    expect(p.portUsb.requested).toEqual([{ filters: [{ serialNumber: 'XYZ' }] }])
    expect(p.portUsb.requested).toEqual(p.upUsb.requested)
  })
})

describe('start address field', () => {
  it('validates and applies the start address as upstream', async () => {
    const p = setup(dfuse())
    await connect(p)
    for (const value of ['0x08020000', 'zz', '0x20000000', '8040000', '0x0800C000', '']) {
      p.page.changeStartAddress(value)
      p.session.editStartAddress(value)
      p.session.commitStartAddress()
      expectSameView(p)
    }
  })

  it('validates without a device', () => {
    const p = setup(dfuse())
    for (const value of ['zz', '0x1234']) {
      p.page.changeStartAddress(value)
      p.session.editStartAddress(value)
      p.session.commitStartAddress()
      expectSameView(p)
    }
  })

  it('applies the browser form checks before flashing', () => {
    const base = validateFields('0x8000000', '100', 1000)
    expect(base).toBeNull()
    expect(validateFields('8000000', '100', 1000)?.field).toBe('startAddress')
    expect(validateFields('0x8000000', '0', 1000)?.field).toBe('uploadSize')
    expect(validateFields('0x8000000', '1001', 1000)?.field).toBe('uploadSize')
    expect(validateFields('0x8000000', '1.5', 1000)?.field).toBe('uploadSize')
    expect(validateFields('0x8000000', '', 1000)).toBeNull()
    expect(validateFields('', '', null)).toBeNull()
    expect(validateFields('0x8000000', '1', 1000, 'Address outside of memory map')?.message).toBe('Address outside of memory map')
  })
})

function validateFields(start: string, size: string, max: number | null, customValidity = '') {
  return validateDfuseFields({
    hidden: false,
    startAddress: { value: start, disabled: false, customValidity },
    uploadSize: { value: size, badInput: false, disabled: false, max }
  })
}

describe('flash', () => {
  it('flashes a .bin to a DfuSe device and waits for it to reset', async () => {
    const p = setup(dfuse({ bmAttributes: 0x0b, pollTimeout: 2 }))
    await connect(p)
    await chooseFile(p, 'Pixhawk1_bl.bin', firmware(2500))
    await flash(p)
    expectSameRun(p)
    expect(p.state().log.at(-1)).toEqual({ kind: 'info', text: 'Done!' })
    // Not manifestation tolerant: the board resets and disconnects.
    p.upUsb.disconnect(p.upFake)
    p.portUsb.disconnect(p.portFake)
    await settle(p.upFake, p.portFake)
    expectSameRun(p)
    expect(p.state().connectLabel).toBe('Connect')
  })

  it('flashes a converted .hex to a manifestation tolerant device', async () => {
    const p = setup(dfuse({ bmAttributes: 0x0f, transferSize: 2048 }))
    await connect(p)
    const bytes = Array.from({ length: 3000 }, (_, i) => (i * 5) & 0xff)
    await chooseFile(p, 'MatekH743_bl.hex', new TextEncoder().encode(intelHex(0x08000000, bytes)).buffer)
    expect(p.state().firmware?.convertedFromHex).toBe(true)
    await flash(p)
    expectSameRun(p)
  })

  it('refuses to flash after a start address change leaves the upload size above its new maximum', async () => {
    // Upstream lowers the upload size's max but not its value, so the browser's form check fails.
    const p = setup(dfuse())
    await connect(p)
    p.session.editStartAddress('0x08020000')
    p.session.commitStartAddress()
    await p.session.chooseFile({ name: 'bl.bin', arrayBuffer: () => Promise.resolve(firmware(1500)) })
    const before = p.portFake.calls.length
    await p.session.flash()
    expect(p.portFake.calls.length).toBe(before)
    expect(p.state().invalid).toEqual({ field: 'uploadSize', message: 'The upload size must be at most 917504.' })
  })

  it('flashes at a changed start address', async () => {
    const p = setup(dfuse())
    await connect(p)
    p.page.changeStartAddress('0x08020000')
    p.session.editStartAddress('0x08020000')
    p.session.commitStartAddress()
    p.page.el.dfuseUploadSize.value = '1024'
    p.session.editUploadSize('1024')
    await chooseFile(p, 'bl.bin', firmware(1500))
    await flash(p)
    expectSameRun(p)
  })

  it('flashes a plain DFU device', async () => {
    const p = setup(dfuse({ dfuVersion: 0x0110, bmAttributes: 0x05 }))
    await connect(p)
    await chooseFile(p, 'bl.bin', firmware(3000))
    await flash(p)
    expectSameRun(p)
  })

  it('clears an error state first', async () => {
    const p = setup(dfuse({ initialState: 10 }))
    await connect(p)
    await chooseFile(p, 'bl.bin', firmware(100))
    await flash(p)
    expectSameRun(p)
  })

  it('warns when the status cannot be read, then flashes', async () => {
    let armed = false
    const p = setup(dfuse({ stall: (c: UsbCall) => armed && c.op === 'in' && c.request === 3 && !(armed = false) }))
    await connect(p)
    await chooseFile(p, 'bl.bin', firmware(100))
    armed = true
    await p.page.flash()
    armed = true
    await p.session.flash()
    await settle(p.upFake, p.portFake)
    expectSameRun(p)
    expect(p.state().log[0]).toEqual({ kind: 'warning', text: 'Failed to clear status' })
  })

  it('logs a failed download', async () => {
    const p = setup(dfuse({ failGetStatus: { at: 6, status: 0x06 } }))
    await connect(p)
    await chooseFile(p, 'bl.bin', firmware(2000))
    await flash(p)
    expectSameRun(p)
    expect(p.state().log.at(-1)).toEqual({ kind: 'error', text: 'DFU DOWNLOAD failed state=10, status=6' })
  })

  it('does nothing without a file', async () => {
    const p = setup(dfuse())
    await connect(p)
    await flash(p)
    expectSameRun(p)
  })
})
