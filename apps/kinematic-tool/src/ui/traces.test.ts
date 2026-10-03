import { beforeAll, describe, expect, it } from 'vitest'
import { COPTER_DEFAULTS, PLANE_DEFAULTS } from '../analysis/params.js'
import { DEFAULT_DEMAND } from '../analysis/scenario.js'
import { simulate } from '../analysis/simulate.js'
import { loadTestLibs } from '../test-utils/wasm.js'
import type { ControlLib } from '../wasm/control.js'
import type { RuckigLib } from '../wasm/ruckig-planner.js'
import { quantityTraces } from './traces.js'

let libs: { control: ControlLib; ruckig: RuckigLib }
beforeAll(async () => {
  libs = await loadTestLibs()
})

describe('quantityTraces', () => {
  it('keeps the plane legend for the single jerk trace, like upstream showlegend: true', () => {
    const plane = simulate(libs, { vehicle: 'plane', axis: 'R', mode: 'angle', demand: DEFAULT_DEMAND, params: PLANE_DEFAULTS })
    const jerk = quantityTraces(plane, 'jerk')
    expect(jerk.map((t) => [t.name, 'showlegend' in t ? t.showlegend : undefined])).toEqual([['Input shaping 4.8+', true]])
  })

  it('leaves the copter legend to Plotly and omits the unplotted sqrt jerk', () => {
    const copter = simulate(libs, {
      vehicle: 'copter',
      axis: 'R',
      mode: 'angle',
      demand: DEFAULT_DEMAND,
      params: COPTER_DEFAULTS
    })
    const jerk = quantityTraces(copter, 'jerk')
    expect(jerk.map((t) => [t.name, 'showlegend' in t ? t.showlegend : undefined])).toEqual([
      ['SCurve (4.7+)', undefined],
      ['Minimum time', undefined]
    ])
  })
})
