// Test-only helpers for the shared DataFlash fixture logs. (The upstream oracle loaders for
// DecodeDevID.js, LogHelpers.js and Param_Helpers.js live in @apwt/ardupilot with that code.)
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory of the shared DataFlash fixtures. */
export function fixturePath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../../../../packages/dataflash/test-fixtures', name)
}

/** Read a fixture log into a fresh ArrayBuffer. */
export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fixturePath(name)))
}
