/**
 * Pyodide for SysID: loading the same runtime and packages as upstream `init_pyodide`, and
 * running upstream's two identification scripts with typed inputs and outputs.
 *
 * Upstream talks to Python through globals: it sets `input_data`, `t_start`, ... and runs a
 * script that leaves its results in `freq_js`, `mag_js`, ... The scripts are kept verbatim in
 * the `.py` files next to this module, so the global names are part of the contract and are
 * mapped from the typed interfaces in one place each.
 *
 * Runtime files come from the jsDelivr CDN at the version upstream loads (0.26.1); the `pyodide`
 * npm package, pinned to the same version, provides the loader and the types. Bundling the
 * runtime would add ~10 MB per build and still fetch the scientific packages from the CDN.
 */
import { loadPyodide, type PyodideInterface } from 'pyodide'
import captureOutputPy from './capture_output.py?raw'
import stateSpacePy from './state_space.py?raw'
import transferFunctionPy from './transfer_function.py?raw'
import wheelUrl from './pyAircraftIden-1.0-py3-none-any.whl?url'
import { numberSeries, seriesList, toPlain } from './convert.js'

export const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.1/full/'
const WHEEL_NAME = 'pyAircraftIden-1.0-py3-none-any.whl'

/** The parts of Pyodide the identification calls use; a real `PyodideInterface` satisfies it. */
export interface PythonRuntime {
  readonly globals: PythonGlobals
  runPython(code: string, options?: { filename?: string }): unknown
}

/** Python's global namespace (a `PyDict` proxy in Pyodide). */
export interface PythonGlobals {
  set(name: string, value: unknown): void
  get(name: string): unknown
}

function isPythonGlobals(value: unknown): value is PythonGlobals {
  return (
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof value.get === 'function' &&
    'set' in value &&
    typeof value.set === 'function'
  )
}

/** A matrix cell as upstream passes it: a number, symbol text, or null for an empty cell. */
export type CellValue = number | string | null

/** Globals of upstream's transfer function script. Strings are passed as typed and parsed by Python. */
export interface TransferFunctionInputs {
  readonly inputData: readonly number[]
  readonly outputData: readonly number[]
  /** Microseconds. */
  readonly timeData: readonly number[]
  readonly numerator: string
  readonly denominator: string
  readonly symbols: string
  readonly tStart: string
  readonly tEnd: string
  /** rad/s, as typed. */
  readonly fStart: string
  readonly fEnd: string
  readonly fCutoff: string
}

/** Globals of upstream's state space script. */
export interface StateSpaceInputs {
  readonly inputData: readonly number[]
  readonly outputData: readonly (readonly number[])[]
  readonly timeData: readonly number[]
  readonly numInputs: 1
  readonly numOutputs: number
  readonly symVar: readonly string[]
  readonly matrixA: readonly (readonly CellValue[])[]
  readonly matrixB: readonly (readonly CellValue[])[]
  readonly matrixH0: readonly (readonly CellValue[])[]
  readonly matrixH1: readonly (readonly CellValue[])[]
  readonly orderA: number
  /** `[min[], max[]]` per parameter field. */
  readonly bounds: readonly [readonly number[], readonly number[]]
  /** `[[a, b], ...]`, or `[[]]` for none. */
  readonly constraints: readonly (readonly string[])[]
  readonly tStart: number
  readonly tEnd: number
  readonly fStart: string
  readonly fEnd: string
  readonly fCutoff: string
}

/** The transfer function fit's arrays, plotted as upstream's "Frequency Response Data". */
export interface TransferFunctionOutputs {
  /** rad/s. */
  readonly freq: Float64Array
  /** Fit amplitude (dB) and phase (deg). */
  readonly mag: Float64Array
  readonly phase: Float64Array
  /** Measured amplitude (dB) and phase (deg). */
  readonly hAmp: Float64Array
  readonly hPhase: Float64Array
  readonly coherence: Float64Array
}

/** The state space fit's arrays, one series per output. */
export interface StateSpaceOutputs {
  readonly freq: Float64Array
  readonly hsAmp: readonly Float64Array[]
  readonly hsPha: readonly Float64Array[]
  readonly hestAmp: readonly Float64Array[]
  readonly hestPha: readonly Float64Array[]
  readonly coherence: readonly Float64Array[]
}

function read(py: PythonRuntime, name: string): unknown {
  return toPlain(py.globals.get(name))
}

/** Upstream `run_transfer_function_ID`, Python part. Throws the Python error if the script fails. */
export function runTransferFunction(py: PythonRuntime, inputs: TransferFunctionInputs): TransferFunctionOutputs {
  const globals: readonly (readonly [string, unknown])[] = [
    ['input_data', inputs.inputData],
    ['output_data', inputs.outputData],
    ['time_data', inputs.timeData],
    ['numerator', inputs.numerator],
    ['denominator', inputs.denominator],
    ['symbols', inputs.symbols],
    ['t_start', inputs.tStart],
    ['t_end', inputs.tEnd],
    ['f_start', inputs.fStart],
    ['f_end', inputs.fEnd],
    ['f_cutoff', inputs.fCutoff]
  ]
  for (const [name, value] of globals) py.globals.set(name, value)
  py.runPython(transferFunctionPy, { filename: 'transfer_function.py' })
  return {
    freq: numberSeries(read(py, 'freq_js'), 'freq_js'),
    mag: numberSeries(read(py, 'mag_js'), 'mag_js'),
    phase: numberSeries(read(py, 'phase_js'), 'phase_js'),
    hAmp: numberSeries(read(py, 'h_amp_js'), 'h_amp_js'),
    hPhase: numberSeries(read(py, 'h_phase_js'), 'h_phase_js'),
    coherence: numberSeries(read(py, 'coherence_js'), 'coherence_js')
  }
}

/** Upstream `run_SS_ID`, Python part. Throws the Python error if the script fails. */
export function runStateSpace(py: PythonRuntime, inputs: StateSpaceInputs): StateSpaceOutputs {
  const globals: readonly (readonly [string, unknown])[] = [
    ['input_data', inputs.inputData],
    ['output_data', inputs.outputData],
    ['time_data', inputs.timeData],
    ['numInputs', inputs.numInputs],
    ['numOutputs', inputs.numOutputs],
    ['sym_var', inputs.symVar],
    ['matrixA', inputs.matrixA],
    ['matrixB', inputs.matrixB],
    ['matrixH0', inputs.matrixH0],
    ['matrixH1', inputs.matrixH1],
    ['orderA', inputs.orderA],
    ['bounds_array', inputs.bounds],
    ['con_str', inputs.constraints],
    ['t_start', inputs.tStart],
    ['t_end', inputs.tEnd],
    ['f_start', inputs.fStart],
    ['f_end', inputs.fEnd],
    ['f_cutoff', inputs.fCutoff]
  ]
  for (const [name, value] of globals) py.globals.set(name, value)
  py.runPython(stateSpacePy, { filename: 'state_space.py' })
  return {
    freq: numberSeries(read(py, 'freq_js'), 'freq_js'),
    hsAmp: seriesList(read(py, 'Hs_amp_js'), 'Hs_amp_js'),
    hsPha: seriesList(read(py, 'Hs_pha_js'), 'Hs_pha_js'),
    hestAmp: seriesList(read(py, 'Hest_amp_js'), 'Hest_amp_js'),
    hestPha: seriesList(read(py, 'Hest_pha_js'), 'Hest_pha_js'),
    coherence: seriesList(read(py, 'coherence_js'), 'coherence_js')
  }
}

interface EmscriptenFs {
  writeFile(path: string, data: Uint8Array): void
}

function isEmscriptenFs(fs: unknown): fs is EmscriptenFs {
  return typeof fs === 'object' && fs !== null && 'writeFile' in fs && typeof fs.writeFile === 'function'
}

function callable(py: PyodideInterface, name: string): (...args: unknown[]) => unknown {
  const fn: unknown = py.pyimport(name)
  if (!(fn instanceof py.ffi.PyCallable)) throw new Error(`${name} is not callable`)
  return (...args) => fn(...args) as unknown
}

/**
 * Upstream `init_pyodide`: load Pyodide and micropip, install matplotlib, python-control and the
 * pyAircraftIden wheel with the same micropip calls, then redirect Python's output to the page's
 * `output` element. Progress goes to `output` as upstream's `addToOutput` does.
 */
export async function loadPython(output: (message: string) => void): Promise<PythonRuntime> {
  output('Initializing Pyodide...')
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL })

  output('Loading micropip package...')
  await pyodide.loadPackage('micropip')
  const install = callable(pyodide, 'micropip.install')

  // Upstream writes `install("matplotlib", deps=false)` and `install("control", keep_going=true,
  // deps=false)` in JavaScript, where those are assignments passed positionally; the same
  // positional values are passed here.
  output('Installing matplotlib package...')
  await install('matplotlib', false)

  output('Installing control package...')
  await install('control', true, false)

  // Browser-forced: micropip needs the wheel's own file name, which the bundler's hashed asset
  // URL does not keep, so the bytes are written to Pyodide's file system under that name.
  output(`Installing pyAircraftIden package from ${wheelUrl}...`)
  try {
    const response = await fetch(wheelUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${wheelUrl}`)
    const fs: unknown = pyodide.FS
    if (!isEmscriptenFs(fs)) throw new Error('Pyodide file system unavailable')
    fs.writeFile(`/tmp/${WHEEL_NAME}`, new Uint8Array(await response.arrayBuffer()))
    await install(`emfs:/tmp/${WHEEL_NAME}`, { keep_going: true, upgrade: true })
    output('pyAircraftIden package installed successfully.')
  } catch (error) {
    output(`Failed to install pyAircraftIden package: ${String(error)}`)
  }

  pyodide.runPython(captureOutputPy, { filename: 'capture_output.py' })

  const globals: unknown = pyodide.globals
  if (!isPythonGlobals(globals)) throw new Error('Pyodide globals are not a dictionary')
  return {
    globals,
    runPython: (code, options) => pyodide.runPython(code, options) as unknown
  }
}
