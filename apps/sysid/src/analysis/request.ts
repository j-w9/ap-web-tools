/**
 * Turning the setup into the Python inputs, as upstream's Submit handler reads its fields in
 * `run_transfer_function_ID` and `run_SS_ID`. The text of each field is passed on exactly as
 * upstream passes it (often as a string Python converts with `float()`), so the same inputs are
 * accepted and rejected.
 */
import type { DataflashLog } from '@apwt/dataflash'
import { MissingDataError } from './columns.js'
import { prepareSignals } from './prepare.js'
import { SIZE_ALERT, inputSource, outputSource, readSlot, type Setup, type TextMatrix } from './setup.js'
import type { CellValue, StateSpaceInputs, TransferFunctionInputs } from '../python/runtime.js'

/** Upstream `getMatrixValues`: numeric text becomes a number, other text stays, empty or missing is null. */
export function matrixValues(matrix: TextMatrix | undefined, rows: number, cols: number): CellValue[][] {
  const values: CellValue[][] = []
  for (let i = 0; i < rows; i++) {
    const row: CellValue[] = []
    for (let j = 0; j < cols; j++) {
      const text = matrix?.[i]?.[j]
      if (text === undefined) {
        row.push(null)
        continue
      }
      const cell = text.trim()
      // Upstream: `!isNaN(cellValue) && cellValue !== ''` then parseFloat.
      if (!Number.isNaN(Number(cell)) && cell !== '') row.push(parseFloat(cell))
      else if (cell !== '') row.push(cell)
      else row.push(null)
    }
    values.push(row)
  }
  return values
}

function missing(what: string): never {
  throw new MissingDataError(`${what} is missing: generate the state space fields for the current sizes first.`)
}

/** Python inputs of the transfer function identification. */
export function transferFunctionInputs(log: DataflashLog, setup: Setup): TransferFunctionInputs {
  const input = readSlot(setup, { kind: 'input' }) ?? missing('Input 1')
  const output = readSlot(setup, { kind: 'output', index: 0 }) ?? missing('Output 1')
  const tStart = setup.startTime.trim()
  const tEnd = setup.endTime.trim()
  // Upstream multiplies the text by 1e6, i.e. Number(text).
  const signals = prepareSignals(log, inputSource(input), [outputSource(output)], Number(tStart), Number(tEnd))
  return {
    inputData: signals.input,
    outputData: signals.outputs[0] ?? [],
    timeData: signals.timeUs,
    numerator: setup.tf.numerator.trim(),
    denominator: setup.tf.denominator.trim(),
    symbols: setup.tf.params.trim(),
    tStart,
    tEnd,
    fStart: setup.startFreq.trim(),
    fEnd: setup.endFreq.trim(),
    fCutoff: setup.cutoffFreq.trim()
  }
}

export type StateSpaceRequest =
  { readonly ok: true; readonly inputs: StateSpaceInputs } | { readonly ok: false; readonly alert: string }

/** Python inputs of the state space identification, or upstream's alert for a bad output count. */
export function stateSpaceInputs(log: DataflashLog, setup: Setup): StateSpaceRequest {
  const ss = setup.ss
  const numOutputs = parseInt(ss.outputs.trim())
  const orderA = parseInt(ss.order, 10)
  const numParams = parseInt(ss.params, 10)
  if (Number.isNaN(numOutputs) || numOutputs <= 0) return { ok: false, alert: SIZE_ALERT }

  const input = readSlot(setup, { kind: 'input' }) ?? missing('Input 1')
  const outputs = Array.from({ length: numOutputs }, (_, index) => {
    const fields = readSlot(setup, { kind: 'output', index })
    return fields ?? missing(`Output ${index + 1}`)
  })
  const symVar = Array.from({ length: Math.max(0, numParams) }, (_, i) => {
    const name = ss.paramNames[i]
    return name === undefined ? missing(`Param ${i + 1}`) : name.trim()
  })
  const tStart = parseFloat(setup.startTime.trim())
  const tEnd = parseFloat(setup.endTime.trim())
  const numConstraints = parseInt(ss.constraints, 10)

  const signals = prepareSignals(log, inputSource(input), outputs.map(outputSource), tStart, tEnd)

  const boundsMin: number[] = []
  const boundsMax: number[] = []
  for (let i = 0; i < numParams; i++) {
    const bound = ss.bounds[i] ?? missing(`Bound ${i + 1}`)
    boundsMin.push(parseFloat(bound.min))
    boundsMax.push(parseFloat(bound.max))
  }

  const m = ss.matrices
  const constraints: string[][] =
    numConstraints > 0
      ? Array.from({ length: numConstraints }, (_, i) => {
          const c = ss.constraintFields[i] ?? missing(`Constraint ${i + 1}`)
          return [c.a.trim(), c.b.trim()]
        })
      : [[]]

  return {
    ok: true,
    inputs: {
      inputData: signals.input,
      outputData: signals.outputs,
      timeData: signals.timeUs,
      numInputs: 1,
      numOutputs,
      symVar,
      matrixA: matrixValues(m?.a, orderA, orderA),
      matrixB: matrixValues(m?.b, orderA, 1),
      matrixH0: matrixValues(m?.h0, numOutputs, orderA),
      matrixH1: matrixValues(m?.h1, numOutputs, orderA),
      orderA,
      bounds: [boundsMin, boundsMax],
      constraints,
      tStart,
      tEnd,
      fStart: setup.startFreq.trim(),
      fEnd: setup.endFreq.trim(),
      fCutoff: setup.cutoffFreq.trim()
    }
  }
}
