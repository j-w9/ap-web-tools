/**
 * Calculations that can throw where upstream throws. Upstream checks no input ranges: it plots
 * whatever the maths gives (an empty plot for a sample rate of 0, `NaN` for an empty field) and
 * only stops when building the frequency grid fails, e.g. `new Array(NaN)` or a negative length
 * for an empty or negative gyro or loop rate. Its page then shows the generic error alert; the
 * port shows the error in place of the plot.
 */
export type Computed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

export function attempt<T>(calculate: () => T): Computed<T> {
  try {
    return { ok: true, value: calculate() }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
