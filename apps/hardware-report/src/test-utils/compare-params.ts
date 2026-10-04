// Test-only: comparisons of upstream parameter handling (`params`/`defaults`, `show_param_changes()`,
// `update_minimal_config()` and the three downloads) against the port. Shared by the oracle tests
// and the real-log test.
import { expect } from 'vitest'
import {
  PARAM_GROUPS,
  allParamsText,
  changedParamsText,
  exportFileName,
  minimalParamsText,
  presentGroupParams
} from '../analysis/minimal-params.js'
import type { ParamData, ParamHistory } from '../analysis/params.js'
import type { HardwareReport } from '../analysis/report.js'
import type { UpstreamHardwareReport } from './upstream.js'

export function savedText(up: UpstreamHardwareReport, fn: string): { name: string; text: string } | undefined {
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
export function compareExports(up: UpstreamHardwareReport, params: ParamData, inputName: string): void {
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
export function upstreamParamEntries(up: UpstreamHardwareReport, skipComments: boolean): [string, number][] {
  const entries = up.get('Object.entries(params)') as [string, number][]
  return skipComments ? entries.filter(([k]) => !k.startsWith('#')) : entries
}

export function compareParams(up: UpstreamHardwareReport, r: HardwareReport, skipComments = false): void {
  expect(upstreamParamEntries(up, skipComments)).toEqual([...r.params.values])
  expect(up.get('Object.entries(defaults)')).toEqual([...r.params.defaults])
  const changes = up.dom.getElementById('ParameterChanges')
  expect(changes.textContent).toBe(changesText(r.paramChanges))
  expect(changes.hidden).toBe(r.paramChanges.length === 0)
}
