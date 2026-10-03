// The individual elements, chain evaluation and unwrap are tested against upstream in
// @apwt/filters; this checks the gyro filters the tool builds from its parameters.
import { describe, it } from 'vitest'
import { chainResponse, frequencyGrid, type TransferElement } from '@apwt/filters'
import { gyroFilters } from './predict.js'
import { DEFAULT_INPUTS, NOTCH_FIELDS, NOTCH_PREFIXES, notchParam, withInputs, type InputName } from './params.js'
import { expectBitEqual, expectComplexBitEqual } from './test-utils/compare.js'
import { rng } from './test-utils/random.js'
import { loadAnalyticTuneUpstream, type UpstreamFilter } from './test-utils/upstream.js'

const up = loadAnalyticTuneUpstream()

/** Model grids as the tool builds them: Nyquist and bin width of a measured log rate. */
const GRIDS = [
  { rate: 400, window: 1024 },
  { rate: 399.8734, window: 512 },
  { rate: 1000.3, window: 2048 },
  { rate: 333.33, window: 256 }
]

function compareChain(mine: TransferElement[], theirs: UpstreamFilter[], label: string): void {
  for (const g of GRIDS) {
    const max = g.rate * 0.5
    const step = g.rate / g.window
    const expected = up.evaluate_transfer_functions([theirs], max, step, false, false)
    const freq = frequencyGrid(max, step)
    expectBitEqual(freq, expected.freq, `${label} freq`)
    expectComplexBitEqual(chainResponse(freq, [mine]), expected.H_total, `${label} @${g.rate}/${g.window}`)
  }
}

describe('gyro filters match upstream get_filters', () => {
  const next = rng(7)
  const int = (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next())

  it.each(Array.from({ length: 40 }, (_, i) => i))('random notch configuration %i', (n) => {
    const values = new Map<InputName, number>()
    for (const prefix of NOTCH_PREFIXES) {
      for (const field of NOTCH_FIELDS) {
        const name = notchParam(prefix, field)
        const value = {
          ENABLE: n % 7 === 0 ? 0 : 1,
          MODE: int(0, 5),
          FREQ: int(20, 300),
          BW: int(5, 150),
          ATT: int(10, 50),
          REF: [0, 0.25, 1, 0.1][int(0, 3)]!,
          FM_RAT: next(),
          HMNCS: int(0, 255),
          OPTS: int(0, 31)
        }[field]
        values.set(name, value)
      }
    }
    values.set('INS_GYRO_FILTER', n % 5 === 0 ? 0 : int(10, 120))
    values.set('Throttle', next() * 1.2 - 0.1)
    values.set('RPM1', int(0, 9000))
    values.set('RPM2', int(0, 9000))
    values.set('ESC_RPM', int(0, 9000))
    values.set('NUM_MOTORS', int(1, 4))
    const inputs = withInputs(DEFAULT_INPUTS, values)
    for (const [name, value] of values) up.setForm(name, value)
    const rate = [2000, 1000, 4000, 8000][n % 4]!
    compareChain(gyroFilters(inputs, rate), up.get_filters(rate), `gyro ${n}`)
  })
})
