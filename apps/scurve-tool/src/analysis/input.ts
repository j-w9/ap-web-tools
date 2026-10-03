/**
 * How upstream reads every number field: `parseFloat(input.value)`. A browser number input reports
 * an empty or invalid entry as `''`, so that reaches the simulation as `NaN` rather than being
 * ignored, and the port does the same.
 */
export function parseNumberInput(text: string): number {
  return parseFloat(text)
}
