import type { DataflashLog } from '@apwt/dataflash'

/** Filter implementation versions the simulation supports. */
export const SUPPORTED_FILTER_VERSIONS = [1, 2, 3, 4] as const

/** A supported filter implementation version. */
export type FilterVersion = (typeof SUPPORTED_FILTER_VERSIONS)[number]

/** Newest supported version, used when the log reports an unknown one. */
export const LATEST_FILTER_VERSION: FilterVersion = 4

/** Narrow a number to a supported filter version. */
export function isFilterVersion(value: number): value is FilterVersion {
  return (SUPPORTED_FILTER_VERSIONS as readonly number[]).includes(value)
}

/** Filter version from `VER.FV` and any warning raised while reading it. */
export interface FilterVersionResult {
  readonly version: FilterVersion
  readonly warning?: string
}

/**
 * Filter version from the log's `VER.FV`. Without one, upstream keeps the radio button that
 * `reset()` selected, version 1. Unsupported versions fall back to the latest supported.
 */
export function readFilterVersion(log: DataflashLog): FilterVersionResult {
  const fv = log.getNumbers('VER', 'FV')
  if (fv === undefined || fv.length === 0) return { version: 1 }
  const version = fv[0]!
  if (isFilterVersion(version)) return { version }
  return { version: LATEST_FILTER_VERSION, warning: `Unsupported filter version: ${version}` }
}
