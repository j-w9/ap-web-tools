// Row: "SID axes 22 and 23 mapped as fixed-wing yaw input and roll mixer". Verdict:
// docs/bug-proofs/analytic-tune.md. The firmware at the pinned commit defines FW_MIX_ROLL = 22 and
// FW_MIX_PITCH = 23 (ArduPlane/systemid.h), cited in the verdict file.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fill, loadPage, timesUs, upstreamDir, type FakeLog } from './_harness'

function planeLog(axis: number): FakeLog {
  return {
    PARM: { Name: [], Value: [] },
    MSG: { Message: ['ArduPlane V4.6.0 (f3836cf3)'] },
    SIDS: { TimeUS: [0], Ax: [axis], TR: [1] },
    SIDD: { TimeUS: timesUs(100, 100), Targ: fill(100, 1), Gx: fill(100, 1), Gy: fill(100, 1), Gz: fill(100, 1) }
  }
}

describe('Analytic Tune: fixed-wing SID axis numbers', () => {
  it('maps a run on axis 22 to Yaw and 23 to Roll, 24 to Pitch', async () => {
    const axes: Record<number, unknown> = {}
    for (const axis of [20, 21, 22, 23, 24]) {
      const page = await loadPage()
      page.set('__log', planeLog(axis))
      page.run('load_log(__log)')
      axes[axis] = page.run('[vehicle_type, page_axis, sid_axis]')
    }
    expect(axes).toEqual({
      20: ['ArduPlane_FW', 'Roll', 20],
      21: ['ArduPlane_FW', 'Pitch', 21],
      22: ['ArduPlane_FW', 'Yaw', 22],
      23: ['ArduPlane_FW', 'Roll', 23],
      24: ['ArduPlane_FW', 'Pitch', 24]
    })
  })

  it('labels 22 "FW Input Yaw Angle" and 23 "FW Mixer Roll" in the run table', () => {
    const source = readFileSync(resolve(upstreamDir, 'AnalyticTune/AnalyticTune.js'), 'utf8')
    expect(source).toContain('22: "FW Input Yaw Angle"')
    expect(source).toContain('23: "FW Mixer Roll"')
    expect(source).toContain('24: "FW Mixer Pitch"')
  })
})
