import { describe, expect, it, vi } from 'vitest'
import { buildSyntheticMagLog } from '../test-utils/synthetic-mag-log.js'
import { loadMagFitLog } from '../analysis/load.js'
import { runMagFit } from '../analysis/magfit.js'
import { compassCalibrations } from './calibrations.js'
import { componentTraces, errorBarTraces, lengthTraces, yawVsExistingTraces, type PlotEntry } from './traces.js'

// @apwt/plot loads the Plotly bundle, which needs a browser; the builders only use defaultColor.
vi.mock('@apwt/plot', () => ({ defaultColor: (i: number) => `color${String(i)}` }))

const data = loadMagFitLog(buildSyntheticMagLog({ duration: 30 }))
const result = runMagFit(data, {
  timeStart: data.startTime,
  timeEnd: data.endTime,
  attitudeSource: data.defaultAttitudeSource ?? 0
})

describe('traces', () => {
  const c = result.compasses[2]
  if (!c) throw new Error('compass 3 missing')
  const entries: PlotEntry[] = compassCalibrations(c).flatMap((cal) =>
    cal.valid
      ? [
          {
            compass: 2,
            calibration: cal,
            time: c.prepared.compass.time,
            attitudeYaw: c.prepared.attitudeYaw,
            existingYaw: c.prepared.existingYaw,
            color: '#000'
          }
        ]
      : []
  )

  it('draws the expected field first, then one trace per calibration', () => {
    const traces = componentTraces('x', result.attitude, entries)
    expect(traces.length).toBe(entries.length + 1)
    expect(traces[0]?.name).toBe('Expected')
    expect(lengthTraces(580, [0, 10], entries).length).toBe(entries.length + 1)
    expect(yawVsExistingTraces(entries).length).toBe(entries.length - 1)
  })

  it('builds one bar trace per compass', () => {
    const bars = errorBarTraces([{ compass: 0, bars: [{ label: 'Offsets, No motor comp', meanError: 3 }] }])
    expect(bars[0]).toMatchObject({ type: 'bar', x: ['Offsets<br>No motor comp'], y: [3] })
  })

  it('colours bars by compass', () => {
    expect(errorBarTraces([{ compass: 1, bars: [] }])[0]).toMatchObject({ name: 'Mag 2', marker: { color: 'color2' } })
  })
})
