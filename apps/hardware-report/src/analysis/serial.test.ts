import { describe, expect, it } from 'vitest'
import { mapBaudrate, protocolName, readSerialPorts, uartTitle } from './serial.js'

const p = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o))

describe('mapBaudrate', () => {
  it('maps short codes, kbaud and literal rates like AP_SerialManager', () => {
    expect([1, 57, 111, 115, 921, 1500, 2000].map(mapBaudrate)).toEqual([1200, 57600, 111100, 115200, 921600, 1500000, 2000000])
    expect(mapBaudrate(0)).toBe(57600)
    expect(mapBaudrate(-1)).toBe(57600)
    expect(mapBaudrate(200)).toBe(200000)
    expect(mapBaudrate(420000)).toBe(420000)
    expect(mapBaudrate(115.9)).toBe(115200)
    expect(mapBaudrate(undefined)).toBeUndefined()
  })
})

describe('uartTitle', () => {
  it('titles serial ports', () => {
    expect(uartTitle(2, p({ SERIAL2_PROTOCOL: 2, SERIAL2_BAUD: 57 }))).toEqual({
      title: 'Serial 2: MAVLink2, 57600 baud',
      baud: 57600
    })
    expect(uartTitle(3, p({ SERIAL3_PROTOCOL: 99 }))).toEqual({ title: 'Serial 3: protocol 99', baud: undefined })
    expect(uartTitle(4, p({ SERIAL4_PROTOCOL: 50, SERIAL4_BAUD: 57 }))).toEqual({ title: 'Serial 4: IOMCU', baud: 1500000 })
  })

  it('titles networking ports', () => {
    const params = p({
      NET_P1_PROTOCOL: 2,
      NET_P1_TYPE: 4,
      NET_P1_IP0: 192,
      NET_P1_IP1: 168,
      NET_P1_IP2: 1,
      NET_P1_IP3: 2,
      NET_P1_PORT: 5760
    })
    expect(uartTitle(21, params)).toEqual({ title: 'Networking Port 1: MAVLink2 TCP server 192.168.1.2:5760', baud: undefined })
  })

  it('titles DroneCAN serial tunnels', () => {
    const params = p({
      CAN_D1_UC_S1_PRO: 5,
      CAN_D1_UC_S1_NOD: 12,
      CAN_D1_UC_S1_IDX: 0,
      CAN_D1_UC_S1_BD: 115,
      CAN_D2_UC_S2_PRO: 2
    })
    expect(uartTitle(41, params)).toEqual({ title: 'DroneCAN Driver 1 Port 1: NodeID: 12 Port: 0 GPS 115200 baud', baud: 115200 })
    expect(uartTitle(52, params)).toEqual({ title: 'DroneCAN Driver 2 Port 2: MAVLink2', baud: undefined })
  })

  it('titles the IOMCU and unknown ports', () => {
    expect(uartTitle(100, p({}))).toEqual({ title: 'IOMCU, 1500000 baud', baud: 1500000 })
    expect(uartTitle(7, p({}))).toEqual({ title: 'UART 7', baud: undefined })
  })
})

describe('readSerialPorts', () => {
  it('lists SERIALn ports in numeric order', () => {
    const ports = readSerialPorts(
      p({ SERIAL10_PROTOCOL: 28, SERIAL2_PROTOCOL: -1, SERIAL2_BAUD: 57, SERIAL2_OPTIONS: 4, SERIAL1_PROTOCOL: 50 })
    )
    expect(ports).toEqual([
      { index: 1, protocol: 50, protocolName: 'IOMCU', baud: 1500000, options: undefined },
      { index: 2, protocol: -1, protocolName: 'None', baud: 57600, options: 4 },
      { index: 10, protocol: 28, protocolName: 'Scripting', baud: undefined, options: undefined }
    ])
    expect(protocolName(0)).toBe('None')
  })
})
