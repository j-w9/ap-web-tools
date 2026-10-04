import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PRESETS, PRESET_IDS, type PresetId } from './presets.js'

/** Source of a named function declaration in upstream index.html (brace matched). */
function upstreamFunction(html: string, name: string): string {
  const start = html.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`no ${name} in index.html`)
  let depth = 0
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

const SETTERS = [
  'setinputValues',
  'setParamValues',
  'setInputFields',
  'setOutputFields',
  'setConstraintList',
  'setBounds',
  'setMatrixA',
  'setMatrixB',
  'setH0',
  'setH1'
]

interface Field {
  value: string
  checked: boolean
  style: { display: string }
  onchange: () => void
}

/** Run every upstream preset setter on a page whose fields all start as `initial`; return what they wrote. */
function upstreamPreset(id: PresetId, initial: string): Map<string, Field> {
  const html = readFileSync(resolve(__dirname, '../../../../upstream/SysID/index.html'), 'utf8')
  const page = new Map<string, Field>()
  const field = (key: string): Field => {
    let f = page.get(key)
    if (!f) {
      f = { value: initial, checked: false, style: { display: 'none' }, onchange: () => undefined }
      page.set(key, f)
    }
    return f
  }
  const document = {
    getElementById: field,
    querySelector: (selector: string) => field(/input\[name=([^\]]+)\]/.exec(selector)?.[1] ?? selector)
  }
  const context = createContext({ document })
  runInContext(SETTERS.map((n) => upstreamFunction(html, n)).join('\n'), context)
  for (const n of SETTERS) (context as Record<string, (axis: string) => void>)[n]!(id)
  return page
}

/**
 * Proven upstream bug (docs/bug-proofs/sysid.md row 1): upstream's MR_Yaw lists Npedp before wlag in
 * the parameter and bound fields, but pyAircraftIden applies bounds by position in matrix-cell order
 * (A, then B, H0, H1, each row by row), so the bounds landed on the wrong parameters. The port lists
 * MR_Yaw in cell order; this maps the port's field index to upstream's for that preset.
 */
const UPSTREAM_FIELD_ORDER: Partial<Record<PresetId, readonly number[]>> = { MR_Yaw: [0, 1, 3, 2, 4] }

/** The preset's unknowns in pyAircraftIden's order: non-numeric cells of A, B, H0, H1, row by row. */
function cellOrder(id: PresetId): string[] {
  const p = PRESETS[id]
  return [p.a, p.b, p.h0, p.h1].flatMap((m) => m.flatMap((row) => row.filter((cell) => Number.isNaN(Number(cell)))))
}

describe('MR_Yaw parameter order (proven upstream bug fixed)', () => {
  it('upstream lists Npedp before wlag with their bounds; the port lists them in cell order', () => {
    const page = upstreamPreset('MR_Yaw', '?')
    const value = (key: string) => page.get(key)?.value ?? '?'
    expect([1, 2, 3, 4, 5].map((i) => value(`param_name_${i}`))).toEqual(['Nr', 'Nped', 'Npedp', 'wlag', 'wlg'])
    expect([3, 4].map((i) => [value(`Bound_min_${i}`), value(`Bound_max_${i}`)])).toEqual([
      ['-10', '10'],
      ['-50', '0']
    ])
    expect(PRESETS.MR_Yaw.params).toEqual(['Nr', 'Nped', 'wlag', 'Npedp', 'wlg'])
    expect(PRESETS.MR_Yaw.bounds[2]).toEqual(['-50', '0'])
    expect(PRESETS.MR_Yaw.bounds[3]).toEqual(['-10', '10'])
  })

  it.each(PRESET_IDS)('%s: parameter fields are in pyAircraftIden cell order', (id) => {
    expect(PRESETS[id].params).toEqual(cellOrder(id))
  })
})

describe('presets match upstream index.html setters', () => {
  it.each(PRESET_IDS)('%s', (id) => {
    const order = UPSTREAM_FIELD_ORDER[id]
    const reorder = <T>(list: readonly T[]): T[] => (order ? order.map((k) => list[k]!) : [...list])
    const p = { ...PRESETS[id], params: reorder(PRESETS[id].params), bounds: reorder(PRESETS[id].bounds) }
    const page = upstreamPreset(id, '?')
    const value = (key: string) => page.get(key)?.value ?? '?'
    expect([value('num_Outputs'), value('num_params'), value('A_order'), value('num_cons')]).toEqual([
      p.sizes.outputs,
      p.sizes.params,
      p.sizes.order,
      p.sizes.constraints
    ])
    expect(p.params.map((_, i) => value(`param_name_${i + 1}`))).toEqual(p.params)
    expect(value(`param_name_${p.params.length + 1}`)).toBe('?')
    expect([value('input_name_1'), value('input_field_1')]).toEqual([p.input.message, p.input.field])
    p.outputs.forEach((o, k) => {
      const i = k + 1
      expect([value(`output_name_${i}`), value(`output_field_${i}`)]).toEqual([o.message, o.field])
      expect(page.get(`multiplier_checkbox_${i}`)?.checked ?? false).toBe(o.multiplier !== undefined)
      if (o.multiplier !== undefined) expect(value(`multiplier_${i}`)).toBe(o.multiplier)
      expect(page.get(`compensation_checkbox_${i}`)?.checked ?? false).toBe(o.compensation !== undefined)
      if (o.compensation !== undefined) expect(value(`axis_dropdown_${i}`)).toBe(o.compensation)
    })
    expect(value(`output_name_${p.outputs.length + 1}`)).toBe('?')
    p.constraints.forEach((c, k) => expect([value(`Constraint_A_${k + 1}`), value(`Constraint_B_${k + 1}`)]).toEqual([...c]))
    p.bounds.forEach((b, k) => expect([value(`Bound_min_${k + 1}`), value(`Bound_max_${k + 1}`)]).toEqual([...b]))
    for (const [table, matrix] of [
      ['matrixA', p.a],
      ['matrixB', p.b],
      ['H0', p.h0],
      ['H1', p.h1]
    ] as const) {
      matrix.forEach((row, i) =>
        row.forEach((cell, j) => expect(value(`${table}_r${i}_c${j}`), `${table}[${i}][${j}]`).toBe(cell))
      )
      // Nothing written outside the table.
      expect(page.has(`${table}_r${matrix.length}_c0`)).toBe(false)
      expect(page.has(`${table}_r0_c${matrix[0]?.length ?? 0}`)).toBe(false)
    }
  })
})
