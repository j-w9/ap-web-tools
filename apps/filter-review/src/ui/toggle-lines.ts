import type { SpectrumTraceKey } from '../analysis/selections.js'

/**
 * Upstream's double-click on a fieldset legend: when fewer than half of the enabled lines are
 * shown, show every enabled line, otherwise hide them; unavailable lines are left alone.
 */
export function toggleLines(
  keys: readonly SpectrumTraceKey[],
  available: ReadonlySet<SpectrumTraceKey>,
  shown: ReadonlySet<SpectrumTraceKey>
): Set<SpectrumTraceKey> {
  const enabled = keys.filter((k) => available.has(k))
  const check = keys.filter((k) => shown.has(k)).length < enabled.length * 0.5
  const next = new Set(shown)
  for (const k of enabled) {
    if (check) next.add(k)
    else next.delete(k)
  }
  return next
}
