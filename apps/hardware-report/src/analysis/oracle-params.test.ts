// Oracle: upstream HardwareReport.js parameter handling run in a vm (test-utils/upstream.ts) against
// the port: `load_param_file()` parsing, the PARM loop of `load_log()` (values, defaults, changes and
// `show_param_changes()`), `update_minimal_config()` (which groups are enabled, their tooltips) and the
// three downloads (`save_all_parameters`, `save_changed_parameters`, `save_minimal_parameters`) with
// their file names.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { createUpstreamHardwareReport, type UpstreamHardwareReport } from '../test-utils/upstream.js'
import {
  PARAM_GROUPS,
  allParamsText,
  changedParamsText,
  exportFileName,
  minimalParamsText,
  presentGroupParams
} from './minimal-params.js'
import type { ParamData, ParamHistory } from './params.js'
import { buildLogReport, buildParamFileReport, type HardwareReport } from './report.js'

function savedText(up: UpstreamHardwareReport, fn: string): { name: string; text: string } | undefined {
  up.saved.length = 0
  up.call(fn)
  const file = up.saved[0]
  return file === undefined ? undefined : { name: file.name, text: file.parts.map(String).join('') }
}

function changesText(changes: readonly ParamHistory[]): string {
  return changes
    .map((c) => c.name + 'Time (s)Value' + c.changes.map((ch) => ch.time.toFixed(2) + String(ch.value)).join(''))
    .join('')
}

/** Compare group enablement and tooltips, then every download, for each base and a few group selections. */
function compareExports(up: UpstreamHardwareReport, params: ParamData, inputName: string): void {
  const input = (id: string) => up.dom.getElementById('param_' + id)
  const bases = params.defaults.size > 0 ? [true, false] : [false]
  for (const changedOnly of bases) {
    up.dom.getElementById('param_base_changed').checked = changedOnly
    up.dom.getElementById('param_base_all').checked = !changedOnly
    for (const g of PARAM_GROUPS) input(g.id).checked = false
    up.call('update_minimal_config')
    for (const g of PARAM_GROUPS) {
      const present = presentGroupParams(g, params.values, params.defaults, changedOnly)
      expect(input(g.id).disabled, `${g.id} disabled`).toBe(present.length === 0)
      expect(input(g.id).getAttribute('title'), `${g.id} title`).toBe(present.join(', '))
    }

    const enabled = PARAM_GROUPS.filter((g) => !input(g.id).disabled).map((g) => g.id)
    const selections = [[], enabled, enabled.filter((_, i) => i % 2 === 0)]
    for (const selection of selections) {
      for (const g of PARAM_GROUPS) input(g.id).checked = selection.includes(g.id)
      const minimal = savedText(up, 'save_minimal_parameters')
      expect(minimal).toEqual({
        name: exportFileName(inputName, '_minimal.param'),
        text: minimalParamsText(params.values, params.defaults, { changedOnly, includedGroups: new Set(selection) })
      })
    }
  }
  expect(savedText(up, 'save_all_parameters')).toEqual({
    name: exportFileName(inputName, '.param'),
    text: allParamsText(params.values)
  })
  expect(savedText(up, 'save_changed_parameters')).toEqual({
    name: exportFileName(inputName, '_changed.param'),
    text: changedParamsText(params.values, params.defaults)
  })
}

/**
 * Upstream's parameter entries. Proven upstream bug fixed in the port: `load_param_file` stores a
 * `#` comment line as an entry (e.g. `"#"` → NaN); the port skips those lines as ArduPilot does
 * (docs/bug-proofs/hardware-report.md). A name starting with `#` can only come from such a line, so
 * those entries are left out of the comparison and asserted separately.
 */
function upstreamParamEntries(up: UpstreamHardwareReport, skipComments: boolean): [string, number][] {
  const entries = up.get('Object.entries(params)') as [string, number][]
  return skipComments ? entries.filter(([k]) => !k.startsWith('#')) : entries
}

function compareParams(up: UpstreamHardwareReport, r: HardwareReport, skipComments = false): void {
  expect(upstreamParamEntries(up, skipComments)).toEqual([...r.params.values])
  expect(up.get('Object.entries(defaults)')).toEqual([...r.params.defaults])
  const changes = up.dom.getElementById('ParameterChanges')
  expect(changes.textContent).toBe(changesText(r.paramChanges))
  expect(changes.hidden).toBe(r.paramChanges.length === 0)
}

async function compareParamFile(text: string, inputName = 'vehicle.param'): Promise<HardwareReport> {
  const up = await createUpstreamHardwareReport()
  up.loadParamFile(text)
  up.dom.getElementById('fileItem').value = 'C:\\fakepath\\' + inputName
  const r = buildParamFileReport(text)
  compareParams(up, r, true)
  const upstreamNaN = upstreamParamEntries(up, false).some(([, v]) => Number.isNaN(v))
  if ([...r.params.values.values()].some(Number.isNaN)) {
    // A NaN value (from a junk line) makes upstream's param_to_string throw, so nothing is saved.
    expect(() => up.call('save_all_parameters')).toThrow(/Could not convert NaN to float string/)
    expect(() => allParamsText(r.params.values)).toThrow(/Could not convert NaN to float string/)
  } else if (upstreamNaN) {
    // Only comment lines gave upstream a NaN: it can not save (proven bug); the port saves exactly
    // what upstream saves for the same file without those lines.
    expect(() => up.call('save_all_parameters')).toThrow(/Could not convert NaN to float string/)
    const clean = await createUpstreamHardwareReport()
    const withoutComments = text
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n')
    clean.loadParamFile(withoutComments)
    clean.dom.getElementById('fileItem').value = 'C:\\fakepath\\' + inputName
    compareParams(clean, r)
    compareExports(clean, r.params, inputName)
  } else {
    compareExports(up, r.params, inputName)
  }
  return r
}

async function compareLog(bytes: Uint8Array, inputName = 'flight.BIN'): Promise<HardwareReport> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  up.dom.getElementById('fileItem').value = inputName
  const r = buildLogReport(DataflashLog.parse(bytes))
  compareParams(up, r)
  compareExports(up, r.params, inputName)
  return r
}

describe('oracle: parameter files', () => {
  it('saves a parameter file with # comment lines, which upstream can not save (proven bug, fixed)', async () => {
    const text = '#NOTE: 2024-01-01 Plane 4.5\n# comment\nINS_GYR_ID,3408138\nRC1_MIN,1100\nFLTMODE1,7\n'
    const up = await createUpstreamHardwareReport()
    up.loadParamFile(text)
    // Upstream stores the comments as parameters and its Save All throws.
    expect(upstreamParamEntries(up, false).slice(0, 2)).toEqual([
      ['#NOTE:', 2024],
      ['#', NaN]
    ])
    expect(() => up.call('save_all_parameters')).toThrow(/Could not convert NaN to float string/)
    // Port: comments skipped; every file matches upstream's for the text without the comment lines.
    const r = await compareParamFile(text)
    expect([...r.params.values.keys()]).toEqual(['INS_GYR_ID', 'RC1_MIN', 'FLTMODE1'])
    expect(allParamsText(r.params.values)).toContain('INS_GYR_ID')
  })

  it('parses every line with two fields, junk included (comment lines skipped)', async () => {
    const r = await compareParamFile(
      [
        '# Mission Planner export,1',
        'INS_GYR_ID,3408138',
        'INS_ACC_ID 3408138',
        'COMPASS_DEV_ID=97539',
        'RC1_MIN\t1100',
        '  RC1_MAX,1900',
        'RC1_TRIM,1500\r',
        'SR0_RAW_SENS,2,extra',
        'FLTMODE1,7',
        'FLTMODE1,9',
        'LONELY',
        '',
        '12,3',
        '3,4',
        'STAT_BOOTCNT,99',
        'AHRS_TRIM_X,0.01',
        'SERIAL10_BAUD,57',
        'SERIAL2_BAUD,921'
      ].join('\n') + '\n'
    )
    expect([...r.params.values.keys()].slice(0, 3)).toEqual(['3', '12', 'INS_GYR_ID'])
  })

  it('writes the same files for a clean parameter file', async () => {
    await compareParamFile(
      'INS_GYR_ID,3408138\nRC1_MIN,1100\nFLTMODE1,7\nSTAT_BOOTCNT,99\nAHRS_TRIM_X,0.01\nSERIAL10_BAUD,57\nSERIAL2_BAUD,921\n'
    )
  })

  it('names the files from the chosen file, or "log"', async () => {
    await compareParamFile('A,1\n', 'no-extension')
    await compareParamFile('A,1\n', '.param')
    await compareParamFile('A,1\n', 'my.vehicle.parm')
  })
})

describe('oracle: parameters from logs', () => {
  it.each(['copter-sitl.bin', 'copter-files.bin'])('matches %s', async (name) => {
    await compareLog(readFixture(name))
  })

  it('tracks changes and defaults, and hides STAT_ changes', async () => {
    const bytes = baseLog()
      .params({ ARMING_CHECK: 1, INS_GYR_ID: 5, RC1_MIN: 1000, STAT_RUNTIME: 10, COMPASS_DEC: 0.1 }, 1_000_000, {
        ARMING_CHECK: 1,
        RC1_MIN: 1100,
        STAT_RUNTIME: 0,
        COMPASS_DEC: 0
      })
      .params({ RC1_MIN: 1050, STAT_RUNTIME: 11 }, 2_500_000, { RC1_MIN: 1100, STAT_RUNTIME: 0 })
      .params({ RC1_MIN: 1050, INS_GYR_ID: 6 }, 3_000_000)
      .params({ RC1_MIN: 1100 }, 4_123_456, { RC1_MIN: 1100 })
      .bytes()
    const r = await compareLog(bytes)
    expect(r.paramChanges.map((c) => c.name)).toEqual(['RC1_MIN', 'INS_GYR_ID'])
  })

  it('hides the changes section when only STAT_ parameters change', async () => {
    const bytes = baseLog().params({ STAT_RUNTIME: 1 }, 1).params({ STAT_RUNTIME: 2 }, 2).bytes()
    const r = await compareLog(bytes)
    expect(r.paramChanges).toEqual([])
  })
})
