import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import stateSpacePy from './state_space.py?raw'
import transferFunctionPy from './transfer_function.py?raw'

/** The Python strings upstream SysID.js passes to `pyodide.runPython`, in source order. */
function upstreamScripts(): string[] {
  const source = readFileSync(resolve(__dirname, '../../../../upstream/SysID/SysID.js'), 'utf8')
  return Array.from(source.matchAll(/runPython\(`([\s\S]*?)`\)/g), (m) => m[1] ?? '')
}

/** Code lines only: indentation, blank lines and comments dropped. */
function code(script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

const UPSTREAM_CUTOFF = 'f_cutoff = float(f_cutoff)/(2*3.14)'
const PORT_CUTOFF = 'f_cutoff = float(f_cutoff)/(2*math.pi)'

// Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 6): the rad/s cutoff is converted to Hz
// with 2*3.14. The port's scripts are upstream's line for line except that one line.
describe.each([
  ['transfer_function.py', 1, transferFunctionPy],
  ['state_space.py', 2, stateSpacePy]
] as const)('%s', (_name, index, port) => {
  it('is upstream code with only the cutoff conversion changed to 2*math.pi', () => {
    const upstream = code(upstreamScripts()[index] ?? '')
    expect(upstream).toContain(UPSTREAM_CUTOFF)
    expect(code(port)).toContain(PORT_CUTOFF)
    expect(code(port)).toEqual(upstream.map((line) => (line === UPSTREAM_CUTOFF ? PORT_CUTOFF : line)))
  })
})
