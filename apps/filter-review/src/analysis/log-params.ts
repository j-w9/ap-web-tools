import type { DataflashLog } from '@apwt/dataflash'

/**
 * First logged value of a parameter, ignoring later changes (upstream `get_param_value` with
 * `allow_change === false`, which alerts about the change; here it is passed to `onChange`).
 */
export function firstParamIgnoringChanges(
  log: DataflashLog,
  name: string,
  onChange?: (message: string) => void
): number | undefined {
  const history = log.paramHistory(name)
  const first = history[0]
  if (first === undefined) return undefined
  const change = history.find((h) => h.value !== first.value)
  if (change !== undefined) onChange?.(`Ignoring param change ${name} changed from ${first.value} to ${change.value}`)
  return first.value
}
