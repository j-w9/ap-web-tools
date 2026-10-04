// Reproductions of the SysID rows of docs/upstream-bugs.md against the original page.
// Python cannot run here: tests stop at what SysID.js hands to Pyodide and at the Python source
// text it runs; the verdicts in docs/bug-proofs/sysid.md quote pyAircraftIden for the rest.
import { describe, expect, it } from 'vitest'
import { LogBytes, loadPage, upstreamParserCtor, type El, type Page } from './_harness.js'

/** Upstream index.html uses these message/field names in its presets. */
function buildLog(): Uint8Array {
  const log = new LogBytes()
    .define(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
    .define(0x86, 'ATT', 'Qff', 'TimeUS,Roll,Pitch')
    .define(0x87, 'RATE', 'Qffff', 'TimeUS,ROut,POut,YOut,AOut')
    .define(0x88, 'SIDD', 'Qffff', 'TimeUS,Gz,Ax,Ay,Az')
    .define(0x89, 'IMU', 'QBf', 'TimeUS,I,GyrZ')
  log.write('FMTU', [0, 0x89, 's#-', 'F--'])
  // RATE and SIDD at 20 Hz for 2 s; ATT at 10 Hz over the same 2 s (Roll = sample number).
  for (let i = 0; i < 40; i++) {
    const t = i * 50_000
    log.write('RATE', [t, i, 0, i, 0.5])
    log.write('SIDD', [t, i, 0, 0, 0])
    if (i % 2 === 0) log.write('ATT', [t, i / 2, 0])
    log.write('IMU', [t, 0, i])
    log.write('IMU', [t, 1, -i])
  }
  log.write('ATT', [2_000_000, 20, 0])
  return log.bytes()
}

function pick(select: El, value: string): void {
  select.value = value
  select.onchange?.()
}

function containerSelect(page: Page, container: string, id: string): El {
  return page.byId(container).querySelector(`select[id= ${id}]`)!
}

async function freshPage(): Promise<Page> {
  const page = await loadPage()
  page.load(buildLog())
  return page
}

describe('SysID: first progress line is wiped', () => {
  it('writes "Initializing Pyodide..." and main() clears it in the same task', async () => {
    const page = await loadPage()
    const output = page.byId('output')
    expect(output.writes).toEqual(['Initializing Pyodide...\n', ''])
    expect(output.value).toBe('')
  })
})

describe('SysID: transfer function and state space forms share field ids', () => {
  async function manualStateSpace(selectTfFirst: boolean): Promise<Page> {
    const page = await freshPage()
    if (selectTfFirst) page.choose('tf')
    page.choose('ss')
    page.byId('num_Outputs').value = '1'
    page.byId('A_order').value = '1'
    page.byId('num_params').value = '1'
    page.byId('num_cons').value = '0'
    page.byId('createFieldsButton').dispatch('click')
    // The user picks the signals in the visible State Space form.
    pick(containerSelect(page, 'inputFieldsContainer', 'input_name_1'), 'RATE')
    containerSelect(page, 'inputFieldsContainer', 'input_field_1').value = 'YOut'
    pick(containerSelect(page, 'outputFieldsContainer', 'output_name_1'), 'SIDD')
    containerSelect(page, 'outputFieldsContainer', 'output_field_1').value = 'Gz'
    page.byId('starttime').value = '0'
    page.byId('endtime').value = '1'
    return page
  }

  it('state space Submit reads the visible form when Transfer function was never selected', async () => {
    const page = await manualStateSpace(false)
    expect(page.allById('input_name_1')).toHaveLength(1)
    const call = await page.submit('ss')
    expect(call.globals['input_data']).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('after Transfer function was selected, state space Submit reads the hidden form and throws', async () => {
    const page = await manualStateSpace(true)
    const ids = page.allById('input_name_1')
    expect(ids).toHaveLength(2)
    expect(ids[0]!.parent!.id).toBe('tf_inputFieldsContainer')
    expect(ids[0]!.value).toBe('None')
    expect(ids[1]!.value).toBe('RATE')
    await expect(page.submit('ss')).rejects.toThrow("Cannot read properties of undefined (reading 'length')")
  })

  it('after Transfer function was selected, the Multirotor Yaw preset fills the hidden form', async () => {
    const page = await freshPage()
    page.choose('tf')
    page.choose('ss')
    page.byId('populate_dropdown').value = 'MR_Yaw'
    page.byId('createFieldsButton').dispatch('click')
    const [tfInput, ssInput] = page.allById('input_name_1')
    expect(tfInput!.parent!.id).toBe('tf_inputFieldsContainer')
    expect([tfInput!.value, page.allById('input_field_1')[0]!.value]).toEqual(['RATE', 'YOut'])
    expect([ssInput!.value, page.allById('input_field_1')[1]!.value]).toEqual(['None', 'None'])
    const [tfOut, ssOut] = page.allById('output_field_1')
    expect([tfOut!.value, ssOut!.value]).toEqual(['Gz', 'None'])
  })
})

/**
 * pyAircraftIden 1.0 unknown order (StateSpaceParamModel.py:89-104, 128-140): with M the identity,
 * A = M^-1 F and B = M^-1 G; unknowns are taken cell by cell, row-major, from A then B (then H0, H1),
 * one per non-numeric cell. SysID.js passes `bounds_array` positionally (StateSpaceIden.py:104-105,
 * 263-265).
 */
function unknownOrder(...matrices: (number | string | null)[][][]): string[] {
  const out: string[] = []
  for (const m of matrices) for (const row of m) for (const cell of row) if (typeof cell === 'string') out.push(cell)
  return out
}

describe('SysID: multirotor preset bounds versus pyAircraftIden parameter order', () => {
  async function preset(name: string) {
    const page = await freshPage()
    page.choose('ss')
    page.byId('populate_dropdown').value = name
    page.byId('createFieldsButton').dispatch('click')
    page.byId('starttime').value = '0'
    page.byId('endtime').value = '1'
    const call = await page.submit('ss')
    const g = call.globals as {
      sym_var: string[]
      bounds_array: [number[], number[]]
      matrixA: (number | string | null)[][]
      matrixB: (number | string | null)[][]
      matrixH0: (number | string | null)[][]
      matrixH1: (number | string | null)[][]
    }
    const order = unknownOrder(g.matrixA, g.matrixB, g.matrixH0, g.matrixH1)
    const applied = Object.fromEntries(order.map((s, k) => [s, [g.bounds_array[0][k], g.bounds_array[1][k]]]))
    const intended = Object.fromEntries(g.sym_var.map((s, k) => [s, [g.bounds_array[0][k], g.bounds_array[1][k]]]))
    return { g, order, applied, intended }
  }

  it('MR_Yaw: field order Nr, Nped, Npedp, wlag, wlg; cell order Nr, Nped, wlag, Npedp, wlg', async () => {
    const { g, order, applied, intended } = await preset('MR_Yaw')
    expect(g.matrixA).toEqual([
      ['Nr', 'Nped'],
      [0, 'wlag']
    ])
    expect(g.matrixB).toEqual([['Npedp'], ['wlg']])
    expect(g.sym_var).toEqual(['Nr', 'Nped', 'Npedp', 'wlag', 'wlg'])
    expect(order).toEqual(['Nr', 'Nped', 'wlag', 'Npedp', 'wlg'])
    expect(intended['wlag']).toEqual([-50, 0])
    expect(intended['Npedp']).toEqual([-10, 10])
    expect(applied['wlag']).toEqual([-10, 10])
    expect(applied['Npedp']).toEqual([-50, 0])
  })

  it.each(['MR_Roll', 'MR_Pitch', 'MR_Vertical'])('%s: field order equals cell order', async (name) => {
    const { g, order } = await preset(name)
    expect(order).toEqual(g.sym_var)
  })
})

describe('SysID: gravity compensation indexes ATT by the output sample number', () => {
  it('20 Hz output, 10 Hz ATT: sample j uses ATT[j], past the ATT window and then NaN', async () => {
    const page = await freshPage()
    page.choose('tf')
    pick(page.byId('input_name_1'), 'RATE')
    page.byId('input_field_1').value = 'ROut'
    pick(page.byId('output_name_1'), 'SIDD')
    page.byId('output_field_1').value = 'Ay' // all zeros, so the result is the compensation term
    page.byId('compensation_checkbox_1').checked = true
    page.byId('axis_dropdown_1').value = 'Roll'
    page.byId('starttime').value = '0'
    page.byId('endtime').value = '2'
    for (const id of ['startfreq', 'endfreq', 'cutofffreq']) page.byId(id).value = '1'
    const call = await page.submit('tf')
    const out = call.globals['output_data'] as number[]
    const k = (Math.PI / 180) * 1 * 9.81
    // 39 output samples (0 .. 1.90 s); ATT window is samples 0..20 (0 .. 2.0 s), Roll = sample number.
    expect(out).toHaveLength(39)
    expect(out[10]).toBe(k * 10) // output at 0.50 s compensated with ATT at 1.00 s (Roll 10, not 5)
    expect(out[20]).toBe(k * 20) // output at 1.00 s with ATT at 2.00 s
    expect(out.slice(21).every(Number.isNaN)).toBe(true) // 1.05 .. 1.90 s: ATT covers them, result NaN
    expect(out.slice(0, 21).some(Number.isNaN)).toBe(false)
  })
})

describe('SysID: low-pass cutoff converted with 2 * 3.14', () => {
  it('passes the rad/s text to Python, which divides by 2*3.14 in both models', async () => {
    const page = await freshPage()
    page.choose('tf')
    pick(page.byId('input_name_1'), 'RATE')
    page.byId('input_field_1').value = 'ROut'
    pick(page.byId('output_name_1'), 'SIDD')
    page.byId('output_field_1').value = 'Gz'
    page.byId('cutofffreq').value = '10'
    const tf = await page.submit('tf')
    expect(tf.globals['f_cutoff']).toBe('10')
    const page2 = await freshPage()
    page2.choose('ss')
    page2.byId('populate_dropdown').value = 'MR_Yaw'
    page2.byId('createFieldsButton').dispatch('click')
    page2.byId('cutofffreq').value = '10'
    const ss = await page2.submit('ss')
    expect(ss.globals['f_cutoff']).toBe('10')
    for (const src of [tf.python[0]!, ss.python[0]!]) {
      expect(src).toContain('f_cutoff = float(f_cutoff)/(2*3.14)')
      expect(src).toContain('time_seq_source = np.array(time_data).flatten()/1000000')
      expect(src).toContain('normal_cutoff = cutoff / nyquist')
    }
    // Python float arithmetic on the same IEEE doubles: 10/(2*3.14) Hz instead of 10/(2*pi) Hz.
    const used = 10 / (2 * 3.14)
    const exact = 10 / (2 * Math.PI)
    expect(used / exact).toBeCloseTo(1.000507, 6)
  })
})

describe('SysID: a ticked multiplier with an empty value is ignored', () => {
  it('scales nothing and reports nothing', async () => {
    const page = await freshPage()
    page.choose('tf')
    pick(page.byId('input_name_1'), 'RATE')
    page.byId('input_field_1').value = 'ROut'
    pick(page.byId('output_name_1'), 'RATE')
    page.byId('output_field_1').value = 'YOut'
    page.byId('multiplier_checkbox_1').checked = true
    page.byId('multiplier_1').value = ''
    page.byId('starttime').value = '0'
    page.byId('endtime').value = '1'
    const call = await page.submit('tf')
    expect(call.globals['output_data']).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(page.alerts).toEqual([])
  })
})

describe('SysID: instanced messages offered in the pickers cannot be read', () => {
  it('lists IMU[0] and IMU[1], and Submit with IMU[0] throws', async () => {
    const page = await freshPage()
    page.choose('tf')
    const opts = page.options(page.byId('input_name_1'))
    expect(opts).toContain('IMU[0]')
    expect(opts).toContain('IMU[1]')
    expect(opts).not.toContain('IMU')
    pick(page.byId('input_name_1'), 'IMU[0]')
    expect(page.options(page.byId('input_field_1'))).toEqual(['None', 'TimeUS', 'I', 'GyrZ'])
    page.byId('input_field_1').value = 'GyrZ'
    pick(page.byId('output_name_1'), 'SIDD')
    page.byId('output_field_1').value = 'Gz'
    await expect(page.submit('tf')).rejects.toThrow("Cannot read properties of undefined (reading 'length')")
  })

  it("the parser's own get_instance reads the data that get('IMU[0]') does not", async () => {
    const Parser = await upstreamParserCtor()
    const parser = new Parser(false) as InstanceType<typeof Parser> & {
      get_instance(name: string, instance: number, field: string): ArrayLike<number> | undefined
    }
    const log = console.log
    console.log = () => undefined
    try {
      parser.processData(buildLog().slice().buffer, [])
    } finally {
      console.log = log
    }
    expect(parser.get('IMU[0]', 'GyrZ')).toBeUndefined()
    expect(Array.from(parser.get_instance('IMU', 0, 'GyrZ')!).slice(0, 3)).toEqual([0, 1, 2])
  })
})

describe('SysID: each State space selection adds another Generate fields handler', () => {
  it('after ss, tf, ss one click runs the generator twice', async () => {
    const page = await freshPage()
    page.choose('ss')
    page.choose('tf')
    page.choose('ss')
    expect(page.byId('createFieldsButton').listenerCount('click')).toBe(2)
    page.byId('createFieldsButton').dispatch('click') // Manual Entry with no outputs
    expect(page.alerts).toEqual([
      'Please enter valid numbers for inputs and outputs.',
      'Please enter valid numbers for inputs and outputs.'
    ])
  })

  it('a valid click leaves the State Space form as one run does', async () => {
    // Both pages have the transfer function form (see the shared ids row); only the handler count differs.
    const once = await freshPage()
    once.choose('tf')
    once.choose('ss')
    const twice = await freshPage()
    twice.choose('ss')
    twice.choose('tf')
    twice.choose('ss')
    for (const page of [once, twice]) {
      page.byId('populate_dropdown').value = 'MR_Roll'
      page.byId('createFieldsButton').dispatch('click')
    }
    const snapshot = (page: Page) =>
      [...page.byId('ss_form').walk()].map((e) => [e.tagName, e.id, e.name, e.value, e.checked, e.disabled])
    expect(once.byId('createFieldsButton').listenerCount('click')).toBe(1)
    expect(snapshot(twice)).toEqual(snapshot(once))
    // The second run's populate_log_message_select appends another option set to the hidden
    // transfer function selects (each click already appends one there); selections are unchanged.
    const tfOptions = (page: Page) => page.options(page.allById('input_name_1')[0]!).length
    expect(tfOptions(twice) - tfOptions(once)).toBe(tfOptions(once) / 2)
    expect(twice.allById('input_name_1')[0]!.value).toBe(once.allById('input_name_1')[0]!.value)
  })
})

describe('SysID: populate_log_message_select appends another option set to existing selects', () => {
  it('selecting Transfer function after generating doubles the State Space message lists', async () => {
    const page = await freshPage()
    page.choose('ss')
    page.byId('populate_dropdown').value = 'MR_Roll'
    page.byId('createFieldsButton').dispatch('click')
    const ssInput = () => containerSelect(page, 'inputFieldsContainer', 'input_name_1')
    const before = page.options(ssInput())
    const value = ssInput().value
    expect(before[0]).toBe('None')
    expect(new Set(before).size).toBe(before.length)
    page.choose('tf')
    page.choose('ss')
    const after = page.options(ssInput())
    expect(after).toEqual([...before, ...before])
    expect(ssInput().value).toBe(value)
  })

  it('every Generate fields click appends a set to the transfer function selects, once that form exists', async () => {
    const page = await freshPage()
    page.choose('tf')
    const tfInput = () => containerSelect(page, 'tf_inputFieldsContainer', 'input_name_1')
    const one = page.options(tfInput())
    page.choose('ss')
    page.byId('populate_dropdown').value = 'MR_Roll'
    page.byId('createFieldsButton').dispatch('click')
    page.byId('createFieldsButton').dispatch('click')
    expect(page.options(tfInput())).toEqual([...one, ...one, ...one])
  })
})
