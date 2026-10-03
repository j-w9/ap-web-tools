import { describe, expect, it } from 'vitest'
import { dmaFromSnapshot, parseSysLine, parseSysText, readSysFiles, threadsFromSnapshot } from './sys-files.js'

describe('@SYS parsing', () => {
  it('splits labels and fields, including DMA markers', () => {
    const l = parseSysLine('SERIAL2 UART2 TX =       0 RX*=  120504 TXBD=     0')
    expect(l.label).toEqual(['SERIAL2', 'UART2'])
    expect([...l.fields]).toEqual([
      ['TX', '0'],
      ['RX', '120504'],
      ['TXBD', '0']
    ])
    expect([...l.marked]).toEqual(['RX'])
  })

  it('separates repeated snapshots even when glued to a previous line', () => {
    const text =
      'ThreadsV2\nISR PRI=255 sp=0x1 STACK=10/20\nmain PRI=1 sp=0x2 STACK=1/2ThreadsV2\nISR PRI=255 sp=0x1 STACK=11/20\n'
    const snaps = parseSysText(text)
    expect(snaps.map((s) => [s.header, s.lines.length])).toEqual([
      ['ThreadsV2', 2],
      ['ThreadsV2', 1]
    ])
    expect(threadsFromSnapshot(snaps[1] as never)).toEqual([
      { name: 'ISR', priority: 255, stackPointer: '0x1', stackFree: 11, stackSize: 20 }
    ])
  })

  it('handles text without a header and DMA lines', () => {
    expect(parseSysText('')).toEqual([])
    const [snap] = parseSysText('DMAV1\nDMA=1:3 TX=  1234 ACQ=   1200 CONT=   34 (2%)\n')
    expect(dmaFromSnapshot(snap as never)).toEqual([
      { stream: '1:3', values: { TX: 1234, ACQ: 1200, CONT: 34 }, raw: 'DMA=1:3 TX=  1234 ACQ=   1200 CONT=   34 (2%)' }
    ])
  })

  it('decodes only the files present, from the last snapshot', () => {
    const enc = (s: string) => new TextEncoder().encode(s)
    const r = readSysFiles([
      {
        name: '@SYS/timers.txt',
        data: enc('TIMERV1\nTIM1 CLK= 200Mhz MODE=  PWM FREQ= 1 TGT= 2\nTIMERV1\nTIM2 CLK= 100Mhz MODE= DSHOT FREQ= 3 TGT= 4\n'),
        isCrashDump: false
      }
    ])
    expect(r.timers).toEqual([{ timer: 'TIM2', clockMhz: 100, mode: 'DSHOT', frequency: 3, target: 4 }])
    expect(r.uarts).toBeUndefined()
  })
})
