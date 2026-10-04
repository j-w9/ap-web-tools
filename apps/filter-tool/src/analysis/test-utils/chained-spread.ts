// Test-only: the proven chained harmonic-notch spread bug (docs/bug-proofs/filters.md, row 2). The
// port fixes it in @apwt/filters; oracle tests compare the port with upstream patched by
// `patchChainedSpread`, and check that the unpatched original differs only where
// `provenChainedSpreadCase` holds.
import { NOTCH_PREFIXES, notchParam, type Inputs, type NotchField } from '../params.js'

const SPREAD_LINE = 'var notch_spread = bandwidth_hz / (32.0 * notch_center);'
const COPY_LOOP = 'for (var c=0; c<chained; c++) {'

/** Upstream filters.js with the spread line moved from inside the per-motor copy loop to before it. */
export function patchChainedSpread(source: string): string {
  if (source.split(SPREAD_LINE).length !== 2 || source.split(COPY_LOOP).length !== 2) {
    throw new Error('patchChainedSpread: upstream HarmonicNotchFilter no longer matches')
  }
  const lines = source.split('\n').filter((line) => line.trim() !== SPREAD_LINE)
  return lines.join('\n').replace(COPY_LOOP, `${SPREAD_LINE}\n${COPY_LOOP}`)
}

/**
 * Multi-source ESC tracking (mode 3, OPTS bit 1) with a double or triple notch, more than one motor,
 * and an enabled harmonic whose centre is clamped to [0.52 bw, 0.48 fs]: the only inputs where the
 * fix changes a result.
 */
export function provenChainedSpreadCase(inputs: Inputs, sampleRate: number): boolean {
  return NOTCH_PREFIXES.some((prefix) => {
    const v = (field: NotchField) => inputs[notchParam(prefix, field)]
    if (v('ENABLE') <= 0 || v('MODE') !== 3 || (v('OPTS') & 2) === 0 || (v('OPTS') & 17) === 0) return false
    if (!(inputs.NUM_MOTORS > 1)) return false
    const freq = Math.max(inputs.ESC_RPM / 60, v('FREQ')) * v('REF')
    return [1, 2, 3, 4, 5, 6, 7, 8].some(
      (h) =>
        (v('HMNCS') & (1 << (h - 1))) !== 0 && Math.min(Math.max(freq * h, v('BW') * h * 0.52), sampleRate * 0.48) !== freq * h
    )
  })
}
