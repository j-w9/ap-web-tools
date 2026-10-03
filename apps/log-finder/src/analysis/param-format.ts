/**
 * Parameter value formatting and `.param` file text (upstream `Libraries/Param_Helpers.js`
 * `param_to_string` and `get_param_download_text`).
 */

/** Natural sort of parameter names, matching MAVProxy and Mission Planner ordering. */
export function compareParamNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}

/**
 * Shortest decimal string that round-trips to the same 32-bit float (upstream `param_to_string`).
 * Throws if no representation with up to 9 significant figures exists (not reachable for finite
 * values, kept for parity).
 */
export function paramToString(value: number): string {
  const floatValue = Math.fround(value)
  for (const figures of [7, 8, 9]) {
    const numberValue = Number(floatValue.toPrecision(figures))
    if (floatValue !== Math.fround(numberValue)) continue
    return numberValue.toString()
  }
  throw new Error(`Could not convert ${value.toString()} to float string`)
}

/** Text of a `.param` file: one `NAME,value` line per parameter, naturally sorted. */
export function paramFileText(params: ReadonlyMap<string, number>): string {
  return [...params.keys()]
    .sort(compareParamNames)
    .map((name) => `${name},${paramToString(params.get(name) ?? 0)}\n`)
    .join('')
}

/**
 * File name for a log's parameter download: directories stripped, extension replaced by `.param`
 * (upstream `save_parameters` in `param_download_button`).
 */
export function paramFileName(logName: string): string {
  const base = logName.replace(/.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) + '.param'
}
