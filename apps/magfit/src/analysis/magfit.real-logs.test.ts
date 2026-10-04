// Real-log validation (not run in CI): with APWT_REAL_LOGS pointing to a directory of DataFlash
// .bin files, load each one into upstream MAGFit (in a vm, test-utils/upstream.ts) and into the
// port, and compare as the oracle tests do: earth field, every compass, every attitude source,
// every motor compensation group and fit kind, orientation checks and fixes, a reduced window, and
// the parameter file for every calibration upstream offers with each "Use sensor" choice. A log
// upstream rejects must be rejected by the port with the same message. No log content is stored.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareAll, compareParamFile, correctUpstreamMotorTimeBase } from '../test-utils/oracle-compare.js'
import { createUpstreamMagfit, upstreamLoad, type UpstreamMagfit } from '../test-utils/upstream.js'
import { loadMagFitLog, type MagFitLog } from './load.js'
import { runMagFit, type MagFitOptions, type MagFitResult } from './magfit.js'
import type { OrientationOption } from './orientation.js'
import type { UseOverride } from './params.js'

const dir = process.env['APWT_REAL_LOGS']
const logs =
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.bin'))
        .sort()

const ORIENTATION_RADIO: Record<OrientationOption, string> = { check: '0', fix90: '1', fix45: '2' }
const USE_RADIO: Record<UseOverride, string> = { noChange: '0', use: '1', dontUse: '2' }

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Run upstream `calculate()` with the given window, attitude source and orientation radios. */
function upstreamCalculate(up: UpstreamMagfit, options: MagFitOptions & { attitudeSource: number }): void {
  up.element('TimeStart')['value'] = String(options.timeStart)
  up.element('TimeEnd')['value'] = String(options.timeEnd)
  for (let i = 0; i < 3; i++) {
    up.setRadio(`input[name="MAG${i}orientation"]:checked`, ORIENTATION_RADIO[options.orientation?.[i] ?? 'check'])
  }
  // Selecting an attitude source radio clears the cached source (upstream add_attitude_source).
  up.evaluate(`body_frame_earth_field.forEach((f, i) => { f.select.checked = i == ${options.attitudeSource} }); source = null`)
  up.alerts.length = 0
  up.evaluate('calculate()')
}

/** Compare a calculation, its orientation warnings and the default parameter file. */
function compareRun(up: UpstreamMagfit, data: MagFitLog, options: MagFitOptions & { attitudeSource: number }): MagFitResult {
  upstreamCalculate(up, options)
  // Upstream parses the inputs back from strings.
  const result = runMagFit(data, {
    ...options,
    timeStart: parseFloat(String(options.timeStart)),
    timeEnd: parseFloat(String(options.timeEnd))
  })
  compareAll(up, data, result)
  expect(result.compasses.flatMap((c) => c?.orientationCheck?.warning ?? [])).toEqual(up.alerts)
  compareParamFile(up, result)
  return result
}

/** Make `name` the shown (saved) calibration of compass `i`, as ticking it last does upstream. */
function selectUpstream(up: UpstreamMagfit, i: number, name: string | null): void {
  up.evaluate(`(() => {
    const sel = MAG_Data[${i}].param_selection
    sel.forEach((s) => { s.show = false })
    const name = ${JSON.stringify(name)}
    if (name === null) return
    const at = sel.findIndex((s) => s.name == name)
    const s = sel.splice(at, 1)[0]
    s.show = true
    sel.splice(0, 0, s)
  })()`)
}

describe.skipIf(dir === undefined)('MAGFit on real logs', () => {
  it.each(logs)('%s matches upstream', async (name) => {
    const buffer = toArrayBuffer(readFileSync(join(dir ?? '', name)))
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)

    let data: MagFitLog
    try {
      data = loadMagFitLog(buffer)
    } catch (e) {
      // Upstream alerts the reason and stops; the port throws the same text.
      expect(up.alerts).toEqual([(e as Error).message])
      return
    }
    // Proven upstream bug fixed: battery current resampled at compass 1's times for every compass.
    correctUpstreamMotorTimeBase(up)

    const attitudeSource = data.defaultAttitudeSource ?? 0
    const full = { timeStart: data.startTime, timeEnd: data.endTime }

    // Default calculation after load, then every attitude source.
    for (let k = 0; k < data.attitudeSources.length; k++) compareRun(up, data, { ...full, attitudeSource: k })

    // Orientation fixes and a reduced window.
    for (const option of ['fix90', 'fix45'] as const) {
      compareRun(up, data, { ...full, attitudeSource, orientation: [option, option, option] })
    }
    const span = data.endTime - data.startTime
    const result = compareRun(up, data, {
      timeStart: data.startTime + span * 0.2,
      timeEnd: data.startTime + span * 0.85,
      attitudeSource
    })

    // Every calibration upstream offers, saved for each compass with each "Use sensor" choice.
    const defaults = result.compasses.map(
      (_, i) =>
        up.evaluate<{ name: string; show: boolean }[] | undefined>(`MAG_Data[${i}]?.param_selection`)?.find((s) => s.show)
          ?.name ?? null
    )
    result.compasses.forEach((c, i) => {
      if (c === undefined) return
      const names = up.evaluate<{ name: string }[]>(`MAG_Data[${i}].param_selection`).map((s) => s.name)
      for (const calibration of [null, ...names]) {
        selectUpstream(up, i, calibration)
        compareParamFile(up, result)
      }
      for (const use of ['use', 'dontUse', 'noChange'] as const) {
        up.setRadio(`input[name="MAG${i}use"]:checked`, USE_RADIO[use])
        selectUpstream(up, i, names[0] ?? null)
        compareParamFile(
          up,
          result,
          result.compasses.map((_, j) => (j === i ? use : 'noChange'))
        )
      }
      selectUpstream(up, i, defaults[i] ?? null)
    })
  })
})
