// Proofs for the Hardware Report rows of docs/upstream-bugs.md. Every case runs the original
// upstream/HardwareReport/HardwareReport.js in node:vm (see _harness.ts) and asserts its exact output.
// Verdicts and firmware citations: docs/bug-proofs/hardware-report.md.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createUpstreamHardwareReport, fixturePath, SyntheticLog } from './_harness.js'

const OK = '✅'
const NO = '❌'

const lines = (p: Readonly<Record<string, number>>): string =>
  Object.entries(p)
    .map(([k, v]) => `${k},${v}`)
    .join('\n') + '\n'

const WDOG_FORMAT = ['QbIHHHHHHHIBIIn', 'TimeUS,Tsk,IE,IEC,IEL,MvMsg,MvCmd,SmLn,FL,FT,FA,FP,ICSR,LR,TN'] as const

function wdogLog(faultType: number, icsr: number): Uint8Array {
  return new SyntheticLog()
    .define('WDOG', ...WDOG_FORMAT)
    .params({ ARMING_CHECK: 1 })
    .write('WDOG', [1, -2, 0, 0, 0, 0, 0, 0, 1234, faultType, 0x08001234, 182, icsr, 0x0800abcd, 'main'])
    .bytes()
}

describe('Hardware Report 1: accel calibration checks offsets against 1.0', () => {
  it('reads the accel scale array from the offset names and marks default (uncalibrated) parameters calibrated', async () => {
    const up = await createUpstreamHardwareReport()
    // ArduPilot defaults: INS_ACCOFFS_* = 0, INS_ACCSCAL_* = 1 (never calibrated).
    up.loadParamFile(
      lines({
        INS_GYR_ID: 3408138,
        INS_ACC_ID: 3408138,
        INS_ACCOFFS_X: 0,
        INS_ACCOFFS_Y: 0,
        INS_ACCOFFS_Z: 0,
        INS_ACCSCAL_X: 1,
        INS_ACCSCAL_Y: 1,
        INS_ACCSCAL_Z: 1
      })
    )
    expect(up.get('get_ins_param_names(0).accel.scale')).toEqual(['INS_ACCSCAL_X', 'INS_ACCSCAL_Y', 'INS_ACCSCAL_Z'])
    expect((up.get('ins[0]') as { acc_cal: number }).acc_cal).toBe(1)
    expect(up.dom.getElementById('INS').textContent).toContain(`Accel calibration: ${OK}`)
  })

  it('ignores a scale calibration when the offsets are exactly 1', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile(
      lines({
        INS_GYR_ID: 1,
        INS_ACC_ID: 1,
        INS_ACCOFFS_X: 1,
        INS_ACCOFFS_Y: 1,
        INS_ACCOFFS_Z: 1,
        INS_ACCSCAL_X: 1.05,
        INS_ACCSCAL_Y: 0.98,
        INS_ACCSCAL_Z: 1.01
      })
    )
    // Offsets of 1 are "configured" against 0, so this is still ticked; the scale values are never read.
    expect((up.get('ins[0]') as { acc_cal: number }).acc_cal).toBe(1)
  })
})

describe('Hardware Report 2: gyro temperature-cal names reuse ACC1..3; max temperature named TMAN', () => {
  it('builds ACC names for the gyro coefficients and TMAN for the maximum temperature', async () => {
    const up = await createUpstreamHardwareReport()
    expect(up.get('get_ins_param_names(0).tcal')).toEqual({
      enabled: 'INS_TCAL1_ENABLE',
      t_min: 'INS_TCAL1_TMIN',
      t_max: 'INS_TCAL1_TMAN',
      accel: [
        ['INS_TCAL1_ACC1_X', 'INS_TCAL1_ACC1_Y', 'INS_TCAL1_ACC1_Z'],
        ['INS_TCAL1_ACC2_X', 'INS_TCAL1_ACC2_Y', 'INS_TCAL1_ACC2_Z'],
        ['INS_TCAL1_ACC3_X', 'INS_TCAL1_ACC3_Y', 'INS_TCAL1_ACC3_Z']
      ],
      gyro: [
        ['INS_TCAL1_ACC1_X', 'INS_TCAL1_ACC1_Y', 'INS_TCAL1_ACC1_Z'],
        ['INS_TCAL1_ACC2_X', 'INS_TCAL1_ACC2_Y', 'INS_TCAL1_ACC2_Z'],
        ['INS_TCAL1_ACC3_X', 'INS_TCAL1_ACC3_Y', 'INS_TCAL1_ACC3_Z']
      ]
    })
  })

  const coefficients = (prefix: string, value: number): Record<string, number> =>
    Object.fromEntries(['1', '2', '3'].flatMap((n) => ['X', 'Y', 'Z'].map((c) => [`INS_TCAL1_${prefix}${n}_${c}`, value])))

  it('reports gyro temperature calibration absent when only the gyro coefficients are set', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile(
      lines({ INS_GYR_ID: 1, INS_ACC_ID: 1, INS_TCAL1_ENABLE: 1, ...coefficients('ACC', 0), ...coefficients('GYR', 0.3) })
    )
    const text = up.dom.getElementById('INS').textContent
    expect(text).toContain(`Accel temperature calibration: ${NO}`)
    expect(text).toContain(`Gyro temperature calibration: ${NO}`)
  })

  it('reports gyro temperature calibration present when only the accel coefficients are set', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile(
      lines({ INS_GYR_ID: 1, INS_ACC_ID: 1, INS_TCAL1_ENABLE: 1, ...coefficients('ACC', 0.2), ...coefficients('GYR', 0) })
    )
    const text = up.dom.getElementById('INS').textContent
    expect(text).toContain(`Accel temperature calibration: ${OK}`)
    expect(text).toContain(`Gyro temperature calibration: ${OK}`)
  })
})

describe('Hardware Report 3: accel and gyro health swapped', () => {
  it('prints the GH flag as "Accel health" and the AH flag as "Gyro health"', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(
      new SyntheticLog()
        .define('IMU', 'QBBB', 'TimeUS,I,AH,GH', 'I')
        .params({ INS_GYR_ID: 3408138, INS_ACC_ID: 3408138 })
        .write('IMU', [1, 0, 1, 0])
        .write('IMU', [2, 0, 1, 0])
        .bytes()
    )
    const ins = up.get('ins[0]') as { acc_all_healthy: boolean; gyro_all_healthy: boolean }
    expect(ins.acc_all_healthy).toBe(true)
    expect(ins.gyro_all_healthy).toBe(false)
    const text = up.dom.getElementById('INS').textContent
    expect(text).toContain(`Accel health: ${NO}`)
    expect(text).toContain(`Gyro health: ${OK}`)
  })
})

describe('Hardware Report 4: duplicate case 4 in fault names', () => {
  it.each([
    [3, 'Fault Type: 3 (HardFault)'],
    [4, 'Fault Type: 4 (MemManage)'],
    [5, 'Fault Type: 5Fault Address'],
    [6, 'Fault Type: 6Fault Address']
  ])('fault type %i renders "%s"', async (faultType, text) => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(wdogLog(faultType, 0))
    expect(up.dom.getElementById('WDOG').textContent).toContain(text)
  })
})

describe('Hardware Report 5: signed shift in decode_ICSR', () => {
  it('decodes ICSR bit 31 as NMIPENDSET 0x-1', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(wdogLog(3, 0x80000000))
    const text = up.dom.getElementById('WDOG').textContent
    expect(text).toContain('Fault ICS Register: 0x80000000')
    expect(text).toContain('NMIPENDSET: 0x-1  (NMI pending)')
  })

  it('decodes bit 28 (no sign bit involved) as 0x1', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(wdogLog(3, 0x10000000))
    expect(up.dom.getElementById('WDOG').textContent).toContain('PENDSVSET: 0x1  (PendSV pending)')
  })
})

describe('Hardware Report 6: internal error names stop at bit 29', () => {
  const monLog = (mask: number): Uint8Array =>
    new SyntheticLog()
      .define('MON', 'QIHH', 'TimeUS,IErr,IErrCnt,IErrLn')
      .params({ ARMING_CHECK: 1 })
      .write('MON', [1, mask, 1, 0])
      .bytes()

  it('names bit 29 "invalid arguments"', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(monLog(1 << 29))
    expect(up.dom.getElementById('InternalError').textContent).toBe('0x20000000: invalid arguments')
  })

  it('names bit 30 "undefined"', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(monLog(0x40000000))
    expect(up.dom.getElementById('InternalError').textContent).toBe('0x40000000: undefined')
  })
})

describe('Hardware Report 7: .param reader keeps junk lines', () => {
  it('stores a "# comment" line as a NaN parameter and Save All Parameters throws', async () => {
    const up = await createUpstreamHardwareReport()
    // The comment line is copied from ArduPilot's Tools/autotest/default_params/copter.parm:51.
    up.loadParamFile('# we need small INS_ACC offsets so INS is recognised as being calibrated\nINS_GYR_ID,1\nINS_ACC_ID,1\n')
    const params = up.get('params') as Record<string, number>
    expect(Object.keys(params)).toEqual(['#', 'INS_GYR_ID', 'INS_ACC_ID'])
    expect(params['#']).toBeNaN()
    // The download section with the "Save All Parameters" button is shown...
    expect(up.dom.getElementById('ParametersContent').hidden).toBe(false)
    // ...and pressing it throws instead of saving.
    expect(() => up.call('save_all_parameters')).toThrow('Could not convert NaN to float string')
    expect(up.saved).toEqual([])
  })

  it('saves the same file without the comment line', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile('INS_GYR_ID,1\nINS_ACC_ID,1\n')
    up.call('save_all_parameters')
    expect(up.saved.map((f) => f.parts)).toEqual([['INS_ACC_ID,1\nINS_GYR_ID,1\n']])
  })
})

describe('Hardware Report 8: NaN position offset hides the plot', () => {
  it('hides the whole offset plot when one offset reads NaN', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile(
      'INS_GYR_ID,1\nINS_ACC_ID,1\nINS_POS1_X,abc\nINS_POS1_Y,0.5\nINS_POS1_Z,0\n' +
        'INS_GYR2_ID,2\nINS_ACC2_ID,2\nINS_POS2_X,0.2\nINS_POS2_Y,0\nINS_POS2_Z,0\n'
    )
    expect(up.dom.getElementById('POS_OFFSETS').parentElement?.hidden).toBe(true)
  })

  it('shows the plot when the same offset is a number', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile('INS_GYR_ID,1\nINS_ACC_ID,1\nINS_POS1_X,0.1\nINS_POS1_Y,0.5\nINS_POS1_Z,0\n')
    expect(up.dom.getElementById('POS_OFFSETS').parentElement?.hidden).toBe(false)
  })
})

describe('Hardware Report 9: CAN bitrate parseInt(undefined)', () => {
  it('titles a CAN driver without CAN_Pn_BITRATE "NaNMbit/s"', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(
      new SyntheticLog()
        .define('CANS', 'QBII', 'TimeUS,I,T,R', 'I')
        .params({ CAN_P1_DRIVER: 1 })
        .write('CANS', [1_000_000, 0, 0, 0])
        .write('CANS', [2_000_000, 0, 100, 50])
        .bytes()
    )
    const titles = up.dom
      .getElementById('DataRates')
      .getElementsByTagName('h4')
      .map((h) => h.textContent)
    expect(titles.join('|')).toContain('DroneCAN 0: NaNMbit/s')
  })

  it('titles the same driver "1Mbit/s" when CAN_P1_BITRATE is logged', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(
      new SyntheticLog()
        .define('CANS', 'QBII', 'TimeUS,I,T,R', 'I')
        .params({ CAN_P1_DRIVER: 1, CAN_P1_BITRATE: 1000000 })
        .write('CANS', [1_000_000, 0, 0, 0])
        .write('CANS', [2_000_000, 0, 100, 50])
        .bytes()
    )
    const titles = up.dom
      .getElementById('DataRates')
      .getElementsByTagName('h4')
      .map((h) => h.textContent)
    expect(titles.join('|')).toContain('DroneCAN 0: 1Mbit/s')
  })
})

describe('Hardware Report 10: boot message naming an unconfigured GPS', () => {
  it('throws when a MSG names GPS 2 and GPS2 is disabled in the final parameters', async () => {
    const up = await createUpstreamHardwareReport()
    const bytes = new SyntheticLog()
      .params({ GPS1_TYPE: 1, GPS2_TYPE: 9 }, 1000)
      .write('MSG', [2000, 'GPS 2: specified as DroneCAN1-125'])
      .params({ GPS2_TYPE: 0 }, 3000)
      .bytes()
    // The error comes from the vm realm, so compare its name rather than the class.
    const error = await up.loadLog(bytes).then(
      () => undefined,
      (e: unknown) => e as Error
    )
    expect(error?.name).toBe('TypeError')
    expect(error?.message).toBe("Cannot set properties of undefined (setting 'device')")
    // The page stops part way: GPS 1 is configured but the GPS section is never shown, and the
    // parameter download section that load_params reveals after load_gps stays hidden.
    expect(up.dom.getElementById('GPS').hidden).toBe(true)
    expect(up.dom.getElementById('ParametersContent').hidden).toBe(true)
  })
})

describe('Hardware Report 10 control', () => {
  it('shows the device when the named GPS is configured', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(
      new SyntheticLog().params({ GPS1_TYPE: 1, GPS2_TYPE: 9 }).write('MSG', [2000, 'GPS 2: specified as DroneCAN1-125']).bytes()
    )
    expect(up.get('gps[1].device')).toBe('DroneCAN1-125')
  })
})

describe('Hardware Report 11: zero-record types in the stats pie', () => {
  it('lists types defined by FMT but never written, with value 0', async () => {
    const up = await createUpstreamHardwareReport()
    await up.loadLog(new Uint8Array(readFileSync(fixturePath('copter-sitl.bin'))))
    const pie = (up.get('log_stats.data') as { labels: string[]; values: number[] }[])[0]!
    const zero = pie.labels.filter((_, i) => pie.values[i] === 0)
    expect(zero.length).toBeGreaterThan(0)
    expect(pie.values.every((v) => v >= 0)).toBe(true)
  })
})
