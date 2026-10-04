// Real-log validation (not run in CI): with APWT_REAL_LOGS pointing to a directory of DataFlash
// .bin files, load each one into upstream AirspeedFit (in a vm, test-utils/upstream.ts; the
// weather lookup is answered offline) and into the port, and compare as the oracle tests do: what
// was loaded (every ARSP instance, velocity sources, log facts, auto window), then the fit of all
// sensors with each EKF velocity source (samples, seeds, wind model, per-sensor ratios and
// residuals, before/after series, warnings, temperature readout) and the parameter file. A log
// upstream rejects must be rejected by the port with the same message. No log content is stored.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { compareFit, compareLoad, numberValue, readoutText } from '../test-utils/oracle-compare.js'
import { createUpstreamTool, upstreamLoad } from '../test-utils/upstream.js'
import { prepareFit, runWindModel, sliderToQ } from './fit.js'
import { loadAirspeedLog, type AirspeedLog } from './load.js'
import { paramFileText, planSave, ratioSuggestions } from './params.js'

const dir = process.env['APWT_REAL_LOGS']
const logs =
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.bin'))
        .sort()

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe.skipIf(dir === undefined)('AirspeedFit on real logs', () => {
  it.each(logs)('%s matches upstream', async (name) => {
    const buffer = toArrayBuffer(readFileSync(join(dir ?? '', name)))
    const up = await createUpstreamTool()
    await upstreamLoad(up, buffer)
    await new Promise((r) => setTimeout(r, 0)) // let the failed weather lookup settle

    let log: AirspeedLog
    try {
      log = loadAirspeedLog(DataflashLog.parse(buffer))
    } catch (e) {
      // Upstream alerts the reason and stops; the port throws the same text.
      expect(up.alerts).toEqual([(e as Error).message])
      return
    }
    expect(up.alerts).toEqual([])
    compareLoad(up, log)

    const q = sliderToQ(numberValue(up, 'q_slider'))
    log.sources.forEach((source, k) => {
      up.evaluate(`log_data.sources.forEach((s, i) => { s.select.checked = i == ${k} }); calculate()`)
      const inputs = {
        source: source.name,
        groundTempC: numberValue(up, 'ground_temp'),
        window: [numberValue(up, 'TimeStart'), numberValue(up, 'TimeEnd')] as const
      }
      const prepared = prepareFit(log, inputs)
      const model = runWindModel(prepared, q)
      expect(readoutText(log, inputs)).toBe(up.element('temp_debug')['innerHTML'])
      if (up.evaluate('fit_result') === null) {
        expect(model).toBeNull()
        return
      }
      compareFit(up, log, prepared, model, source.name)

      up.alerts.length = 0
      up.saved.length = 0
      up.confirms.length = 0
      up.evaluate('save_parameters()')
      const suggestions = ratioSuggestions(log.sensors, model)
      const plan = planSave(suggestions)
      if (plan.kind === 'save') {
        expect(plan.text).toBe(up.saved[0])
        expect(paramFileText(suggestions)).toBe(up.saved[0])
        expect(plan.summary).toBe(up.alerts.at(-1))
        expect(plan.confirm === null ? [] : [plan.confirm]).toEqual(up.confirms)
      } else {
        expect(up.saved).toEqual([])
        expect(plan.message).toBe(up.alerts[0])
      }
    })
  })
})
