// Oracle tests for the dfu-util.js helpers, cut out of upstream's page closure.
import { describe, expect, it } from 'vitest'
import { DfuDevice, findDeviceDfuInterfaces } from './dfu.js'
import {
  fixInterfaceNames,
  formatDFUInterfaceAlternate,
  formatDFUSummary,
  getDFUDescriptorProperties,
  hex4,
  hexAddr8,
  niceSize,
  parseIntelHex
} from './util.js'
import { FakeUsbDevice, type FakeOptions } from '../test-utils/fake-usb.js'
import { intelHex } from '../test-utils/hex.js'
import { loadUpstreamUtil } from '../test-utils/upstream.js'

const F4 = '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg'
const up = loadUpstreamUtil()

describe('text formats', () => {
  it('formats numbers as upstream', () => {
    for (const n of [0, 1, 0xf, 0x483, 0xdf11, 0xffff, 0x10000, 0x011a]) expect(hex4(n)).toBe(up.hex4(n))
    for (const n of [0, 0x8000000, 0x80fffff, 0x1fffc000, 0xffff0000]) expect(hexAddr8(n)).toBe(up.hexAddr8(n))
    for (const n of [0, 1, 1023, 1024, 1536, 0x100000, 0x180000, 1024 ** 3, 3 * 1024 ** 3, 2097152 + 1]) {
      expect(niceSize(n)).toBe(up.niceSize(n))
    }
  })

  it('formats the summary and interface lines as upstream', () => {
    const cases: FakeOptions[] = [
      { alternates: [{ alternateSetting: 0, interfaceName: F4 }] },
      { alternates: [{ alternateSetting: 1, interfaceName: null, interfaceProtocol: 1 }], vendorId: 0x1209, productId: 0x5741 },
      {
        alternates: [{ alternateSetting: 2, interfaceName: '', interfaceProtocol: 2 }],
        configurationValue: 2,
        interfaceNumber: 3
      }
    ]
    for (const options of cases) {
      const fake = new FakeUsbDevice(options)
      const upSettings = up.dfu.findDeviceDfuInterfaces(fake.usb)[0]
      const portSettings = findDeviceDfuInterfaces(fake.usb)[0]!
      expect(formatDFUSummary(new DfuDevice(fake.usb, portSettings))).toBe(
        up.formatDFUSummary(new up.dfu.Device(fake.usb, upSettings))
      )
      expect(formatDFUInterfaceAlternate(portSettings)).toBe(up.formatDFUInterfaceAlternate(upSettings))
    }
  })
})

describe('DFU functional descriptor properties', () => {
  const cases: FakeOptions[] = [
    { alternates: [{ alternateSetting: 0, interfaceName: F4 }], bmAttributes: 0x0b, transferSize: 2048, dfuVersion: 0x011a },
    { alternates: [{ alternateSetting: 0, interfaceName: F4 }], bmAttributes: 0x04, detachTimeout: 1000, dfuVersion: 0x0110 },
    { alternates: [{ alternateSetting: 0, interfaceName: F4 }], noFunctionalDescriptor: true },
    { alternates: [{ alternateSetting: 0, interfaceName: F4 }], stall: () => true }
  ]
  for (const [i, options] of cases.entries()) {
    it(`reads case ${i} as upstream`, async () => {
      const upFake = new FakeUsbDevice(options)
      const portFake = new FakeUsbDevice(options)
      const upProps = await up.getDFUDescriptorProperties(
        new up.dfu.Device(upFake.usb, up.dfu.findDeviceDfuInterfaces(upFake.usb)[0])
      )
      const portProps = await getDFUDescriptorProperties(new DfuDevice(portFake.usb, findDeviceDfuInterfaces(portFake.usb)[0]!))
      expect(portFake.calls).toEqual(upFake.calls)
      // Upstream returns {} (no descriptor) or undefined (read failed); both mean "no properties".
      if (upProps === undefined || Object.keys(upProps).length === 0) expect(portProps).toBeNull()
      else expect({ ...portProps }).toEqual({ ...upProps })
    })
  }
})

describe('fixInterfaceNames', () => {
  it('reads missing names from the string descriptors as upstream', async () => {
    const options: FakeOptions = {
      alternates: [
        { alternateSetting: 0, interfaceName: null, descriptorName: F4 },
        { alternateSetting: 1, interfaceName: '@Option Bytes  /0x1FFFC000/01*016 e' },
        { alternateSetting: 2, interfaceName: null, descriptorName: '@OTP Memory /0x1FFF7800/01*512 e,01*016 e' }
      ]
    }
    const upFake = new FakeUsbDevice(options)
    const portFake = new FakeUsbDevice(options)
    const upInterfaces = up.dfu.findDeviceDfuInterfaces(upFake.usb)
    await up.fixInterfaceNames(upFake.usb, upInterfaces)
    const fixed = await fixInterfaceNames(portFake.usb, findDeviceDfuInterfaces(portFake.usb))
    expect(portFake.calls).toEqual(upFake.calls)
    expect(fixed.map((s) => s.name)).toEqual(upInterfaces.map((s) => s.name))
    expect(fixed[0]!.name).toBe(F4)
  })

  it('does nothing when every name was read', async () => {
    const fake = new FakeUsbDevice({ alternates: [{ alternateSetting: 0, interfaceName: F4 }] })
    await fixInterfaceNames(fake.usb, findDeviceDfuInterfaces(fake.usb))
    expect(fake.calls).toEqual([])
  })
})

describe('parseIntelHex', () => {
  const bytes = (n: number, seed: number) => Array.from({ length: n }, (_, i) => (i * 13 + seed) & 0xff)
  const cases: [string, string][] = [
    ['bootloader at 0x08000000', intelHex(0x08000000, bytes(15000, 1))],
    ['CRLF line endings', intelHex(0x08000000, bytes(700, 2), '\r\n')],
    ['data not at offset 0', intelHex(0x08004010, bytes(100, 3))],
    ['crossing a 64 KiB boundary (upstream overlays the segments)', intelHex(0x0800f000, bytes(0x2000, 4))],
    ['beyond 512 KiB of 16-bit addresses', intelHex(0x0807fff0, bytes(64, 5))],
    ['with junk lines', `garbage\n${intelHex(0x08000000, bytes(40, 6))}\n\n  \n`],
    ['empty', '']
  ]
  for (const [name, text] of cases) {
    it(`converts ${name} as upstream`, () => {
      const buffer = new TextEncoder().encode(text).buffer
      expect(Array.from(parseIntelHex(buffer))).toEqual(Array.from(up.parseIntelHex(buffer)))
    })
  }
})
