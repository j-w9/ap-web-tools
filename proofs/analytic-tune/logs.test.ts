import { describe, expect, it } from 'vitest'
import { fill, loadPage, thrown, timesUs, type FakeLog, type Page } from './_harness'

const PARM = (params: Record<string, number>) => ({ Name: Object.keys(params), Value: Object.values(params) })

/** System ID data: one run of `n` samples at 100 Hz from `startS`. */
function sidd(n: number, startS = 0): Record<string, number[]> {
  return { TimeUS: timesUs(n, 100, startS), Targ: fill(n, 1), Gx: fill(n, 1), Gy: fill(n, 1), Gz: fill(n, 1) }
}

/** A plane log with one fixed-wing system ID run on `axis`. */
function planeLog(axis: number, params: Record<string, number> = {}): FakeLog {
  return {
    PARM: PARM(params),
    MSG: { Message: ['ArduPlane V4.6.0 (f3836cf3)'] },
    SIDS: { TimeUS: [0], Ax: [axis], TR: [1] },
    SIDD: sidd(100)
  }
}

function loadLog(page: Page, log: FakeLog): unknown {
  page.set('__log', log)
  return page.run('load_log(__log)')
}

describe('Analytic Tune: state carried between logs', () => {
  // Row: "Airspeed scaling outlives its log".
  it('scales a copter prediction by the airspeed of an earlier fixed-wing window', async () => {
    const copter: FakeLog = { PARM: PARM({}), MSG: { Message: ['ArduCopter V4.6.0 (f3836cf3)'] } }
    const predict = (page: Page) =>
      page.run('calculate_predicted_TF([new Array(32).fill(1), new Array(32).fill(0)], 400, 64)[0]') as [number[], number[]]

    const fresh = await loadPage()
    loadLog(fresh, copter)
    expect(fresh.run('[vehicle_type, aspeed, eas2tas]')).toEqual(['ArduCopter', 1, 1])

    const after = await loadPage()
    // What calculate_freq_resp runs for a fixed-wing log: SIDP airspeed 20 m/s, EAS2TAS 1.25.
    const n = 100
    after.set('__fw', {
      SIDP: {
        TimeUS: timesUs(n, 100),
        ...Object.fromEntries(['Aile', 'rdes', 'DRll', 'Rll'].map((f) => [f, fill(n, 1)])),
        aspd: fill(n, 20),
        eastas: fill(n, 1.25)
      },
      SIDD: sidd(n)
    })
    after.run('log = new DataflashParser(); log.processData(__fw); load_fw_time_history_data(0, 1, "Roll")')
    loadLog(after, copter)
    expect(after.run('[vehicle_type, aspeed, eas2tas]')).toEqual(['ArduCopter', 20, 1.25])

    // Same copter log and parameters, different prediction.
    const a = predict(fresh)
    const b = predict(after)
    expect(b[0][0]!).not.toBeCloseTo(a[0][0]!, 3)
    // The page applies P, I, D x aspeed^2 and FF, D_FF x aspeed / eas2tas to the copter gains.
    expect(after.run('get_form("ATC_RAT_RLL_P") * aspeed * aspeed')).toBeCloseTo(
      (fresh.run('get_form("ATC_RAT_RLL_P")') as number) * 400,
      9
    )
  })

  // Row: "Vehicle outlives its log".
  it('analyses a log without a firmware banner as the previous log vehicle', async () => {
    const noBanner: FakeLog = { PARM: PARM({}) }
    const fresh = await loadPage()
    loadLog(fresh, noBanner)
    expect(fresh.run('vehicle_type')).toBe('ArduCopter')

    const after = await loadPage()
    loadLog(after, planeLog(20))
    expect(after.run('vehicle_type')).toBe('ArduPlane_FW')
    loadLog(after, noBanner)
    expect(after.run('vehicle_type')).toBe('ArduPlane_FW')
  })
})

describe('Analytic Tune: logs that stop the load', () => {
  // Row: "SIDS record without data stops the load".
  it('throws when there are more SIDS records than SIDD runs; parameters not copied', async () => {
    const page = await loadPage()
    const log: FakeLog = {
      PARM: PARM({ INS_HNTCH_FREQ: 80, ATC_RAT_RLL_P: 0.2 }),
      MSG: { Message: ['ArduCopter V4.6.0 (f3836cf3)'] },
      SIDS: { TimeUS: [0, 5_000_000], Ax: [1, 2], TR: [1, 1] },
      SIDD: sidd(100)
    }
    expect(await thrown(() => loadLog(page, log))).toBe("TypeError: Cannot read properties of undefined (reading 'toFixed')")
    expect(page.value('ATC_RAT_RLL_P')).toBe('0.288')
    expect(page.value('INS_HNTCH_FREQ')).toBe('150')
  })

  // Row: "Plane log without SIDS stops the load".
  it('throws for a plane log without SIDS; only harmonic notch params copied', async () => {
    const page = await loadPage()
    const log: FakeLog = {
      PARM: PARM({ INS_HNTCH_FREQ: 80, RLL_RATE_P: 0.5, Q_A_RAT_RLL_P: 0.3 }),
      MSG: { Message: ['ArduPlane V4.6.0 (f3836cf3)'] }
    }
    expect(await thrown(() => loadLog(page, log))).toBe("TypeError: Cannot read properties of undefined (reading '0')")
    expect(page.value('INS_HNTCH_FREQ')).toBe('80')
    expect(page.value('RLL_RATE_P')).toBe('0.288')
    expect(page.value('Q_A_RAT_RLL_P')).toBe('0.288')
  })
})

describe('Analytic Tune: fixed-wing yaw', () => {
  // Row: "Fixed-wing yaw throws". SID axis 22 is labelled "FW Input Yaw Angle" by the page.
  it('throws on Calculate after a plane log whose run is on axis 22', async () => {
    const page = await loadPage()
    loadLog(page, planeLog(22))
    expect(page.run('[vehicle_type, page_axis]')).toEqual(['ArduPlane_FW', 'Yaw'])
    expect(page.hasElement('FWYawPIDS')).toBe(false)
    expect(await thrown(() => page.run('calculate_freq_resp()'))).toBe(
      "TypeError: Cannot read properties of null (reading 'style')"
    )
    // The page has no fixed-wing yaw rate gain inputs at all.
    expect(['YAW_RATE_P', 'YAW_RATE_I', 'YAW_RATE_D', 'YAW_RATE_FF'].map((id) => page.hasElement(id))).toEqual([
      false,
      false,
      false,
      false
    ])
  })

  // Row: "Fixed-wing yaw save throws".
  it('throws on Save Parameters for fixed-wing yaw: the empty pilot prefix matches the bitmask check boxes', async () => {
    const page = await loadPage()
    loadLog(page, planeLog(22))
    expect(page.run('get_vehicle_plt_prefix()')).toBe('')
    expect(page.value('bit_0_INS_HNTCH_HMNCS')).toBe('on')
    expect(await thrown(() => page.run('save_parameters()'))).toBe('Error: Could not convert on to float string')
    expect(page.saved()).toBeUndefined()
    // Fixed-wing roll saves.
    const roll = await loadPage()
    loadLog(roll, planeLog(20))
    roll.run('save_parameters()')
    expect(roll.saved()?.name).toBe('filter.param')
  })

  it('saves when the pilot-prefix branch is skipped for an empty prefix (the fix)', async () => {
    const fixed = await loadPage((src) =>
      src.replace(
        'if (name.startsWith(get_vehicle_plt_prefix()) && page_axis == "Yaw") {',
        'if (get_vehicle_plt_prefix() != "" && name.startsWith(get_vehicle_plt_prefix()) && page_axis == "Yaw") {'
      )
    )
    loadLog(fixed, planeLog(22))
    fixed.run('save_parameters()')
    expect(fixed.saved()).toEqual({
      name: 'filter.param',
      text: [
        'INS_GYRO_FILTER,20',
        'INS_HNTCH_FREQ,150',
        'INS_HNTCH_BW,75',
        'INS_HNTCH_ATT,40',
        'INS_HNTCH_REF,0.29',
        'INS_HNTCH_FM_RAT,0',
        'INS_HNTCH_HMNCS,3',
        'INS_HNTCH_OPTS,0',
        'INS_HNTC2_FREQ,0',
        'INS_HNTC2_BW,0',
        'INS_HNTC2_ATT,0',
        'INS_HNTC2_REF,0',
        'INS_HNTC2_FM_RAT,0',
        'INS_HNTC2_HMNCS,0',
        'INS_HNTC2_OPTS,0',
        'SCHED_LOOP_RATE,400',
        'YAW_RATE_NTF,0',
        'YAW_RATE_NEF,0',
        'INS_HNTCH_ENABLE,1',
        'INS_HNTCH_MODE,1',
        'INS_HNTC2_ENABLE,0',
        'INS_HNTC2_MODE,0',
        ''
      ].join('\n')
    })
  })
})

describe('Analytic Tune: notch filter index', () => {
  // Row: "Notch selection outside 1-8 throws".
  async function copterPage(): Promise<Page> {
    const page = await loadPage()
    loadLog(page, { PARM: PARM({}), MSG: { Message: ['ArduCopter V4.6.0 (f3836cf3)'] } })
    page.run('page_axis = "Roll"')
    return page
  }
  const predict = 'calculate_predicted_TF([new Array(32).fill(1), new Array(32).fill(0)], 400, 64)'

  it('throws for ATC_RAT_RLL_NTF = 9 (and 1.5), in update_PID_filters and calculate_predicted_TF', async () => {
    for (const ntf of ['9', '1.5']) {
      const page = await copterPage()
      page.setValue('ATC_RAT_RLL_NTF', ntf)
      expect(await thrown(() => page.run('update_PID_filters()'))).toBe(
        "TypeError: Cannot read properties of null (reading 'style')"
      )
      expect(await thrown(() => page.run(predict))).toBe("TypeError: Cannot read properties of null (reading 'value')")
    }
  })

  it('NTF = 0 (no notch) predicts without throwing: the firmware result for index 9', async () => {
    const page = await copterPage()
    page.setValue('ATC_RAT_RLL_NTF', '0')
    page.run('update_PID_filters()')
    expect((page.run(`${predict}[0][0]`) as number[]).length).toBe(32)
  })
})
