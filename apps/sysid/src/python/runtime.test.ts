import { describe, expect, it, vi } from 'vitest'
import { toPlain, type ConvertibleProxy } from './convert.js'
import {
  runStateSpace,
  runTransferFunction,
  type PythonRuntime,
  type StateSpaceInputs,
  type TransferFunctionInputs
} from './runtime.js'
import stateSpacePy from './state_space.py?raw'
import transferFunctionPy from './transfer_function.py?raw'

/** A fake Pyodide: records globals and scripts, answers result globals from `results`. */
function fakeRuntime(results: Record<string, unknown>) {
  const set = new Map<string, unknown>()
  const scripts: string[] = []
  const runtime: PythonRuntime = {
    globals: { set: (name, value) => set.set(name, value), get: (name) => results[name] },
    runPython: (code) => {
      scripts.push(code)
      return undefined
    }
  }
  return { runtime, set, scripts }
}

function proxy(value: unknown): ConvertibleProxy & { destroyed: boolean } {
  const p = {
    destroyed: false,
    toJs: () => value,
    destroy: () => {
      p.destroyed = true
    }
  }
  return p
}

const TF_INPUTS: TransferFunctionInputs = {
  inputData: [1, 2],
  outputData: [3, 4],
  timeData: [10, 20],
  numerator: 'b0',
  denominator: 'a1*s + a0',
  symbols: 'b0 a1 a0',
  tStart: '1',
  tEnd: '2',
  fStart: '3',
  fEnd: '40',
  fCutoff: '100'
}

describe('runTransferFunction', () => {
  it('sets upstream globals, runs the upstream script and reads the *_js arrays', () => {
    const h = proxy([5, 6])
    const { runtime, set, scripts } = fakeRuntime({
      freq_js: [1, 2],
      mag_js: Float32Array.of(3, 4),
      phase_js: [5, 6],
      h_amp_js: h,
      h_phase_js: [7, 8],
      coherence_js: [0.5, 0.9]
    })
    const out = runTransferFunction(runtime, TF_INPUTS)
    expect(Object.fromEntries(set)).toEqual({
      input_data: [1, 2],
      output_data: [3, 4],
      time_data: [10, 20],
      numerator: 'b0',
      denominator: 'a1*s + a0',
      symbols: 'b0 a1 a0',
      t_start: '1',
      t_end: '2',
      f_start: '3',
      f_end: '40',
      f_cutoff: '100'
    })
    expect(scripts).toEqual([transferFunctionPy])
    expect(Array.from(out.mag)).toEqual([3, 4])
    expect(Array.from(out.hAmp)).toEqual([5, 6])
    expect(h.destroyed).toBe(true)
  })

  it('fails loudly on a missing or malformed result', () => {
    const { runtime } = fakeRuntime({ freq_js: [1, 'x'] })
    expect(() => runTransferFunction(runtime, TF_INPUTS)).toThrow('freq_js[1] is not a number')
  })

  it('passes Python errors through', () => {
    const { runtime } = fakeRuntime({})
    runtime.runPython = () => {
      throw new Error('Traceback\nValueError: bad')
    }
    expect(() => runTransferFunction(runtime, TF_INPUTS)).toThrow('ValueError: bad')
  })
})

describe('runStateSpace', () => {
  it('maps every input to its upstream global and reads one series per output', () => {
    const inputs: StateSpaceInputs = {
      inputData: [1],
      outputData: [[2], [3]],
      timeData: [4],
      numInputs: 1,
      numOutputs: 2,
      symVar: ['a'],
      matrixA: [['a']],
      matrixB: [[1]],
      matrixH0: [[1], [0]],
      matrixH1: [[0], [null]],
      orderA: 1,
      bounds: [[-1], [1]],
      constraints: [[]],
      tStart: 1,
      tEnd: 2,
      fStart: '1',
      fEnd: '2',
      fCutoff: '3'
    }
    const series = [[1], [2]]
    const { runtime, set, scripts } = fakeRuntime({
      freq_js: [1],
      Hs_amp_js: series,
      Hs_pha_js: series,
      Hest_amp_js: series,
      Hest_pha_js: series,
      coherence_js: series
    })
    const out = runStateSpace(runtime, inputs)
    expect([...set.keys()].sort()).toEqual(
      [
        'input_data',
        'output_data',
        'time_data',
        'numInputs',
        'numOutputs',
        'sym_var',
        'matrixA',
        'matrixB',
        'matrixH0',
        'matrixH1',
        'orderA',
        'bounds_array',
        'con_str',
        't_start',
        't_end',
        'f_start',
        'f_end',
        'f_cutoff'
      ].sort()
    )
    expect(set.get('con_str')).toEqual([[]])
    expect(scripts).toEqual([stateSpacePy])
    expect(out.hsAmp.map((s) => Array.from(s))).toEqual(series)
  })
})

describe('toPlain', () => {
  it('destroys the proxy even when conversion throws', () => {
    const destroy = vi.fn()
    expect(() =>
      toPlain({
        toJs: () => {
          throw new Error('boom')
        },
        destroy
      })
    ).toThrow('boom')
    expect(destroy).toHaveBeenCalledOnce()
  })
})
