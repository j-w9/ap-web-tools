/** Naming of parameter downloads; the file text itself comes from `@apwt/ardupilot` `paramFileText`. */

/**
 * File name for a log's parameter download: directories stripped, extension replaced by `.param`
 * (upstream `save_parameters` in `param_download_button`).
 */
export function paramFileName(logName: string): string {
  const base = logName.replace(/.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) + '.param'
}
