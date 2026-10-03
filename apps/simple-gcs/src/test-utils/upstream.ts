// Test-only access to the vendored upstream SimpleGCS sources and fixtures, for oracle tests that
// run the original JavaScript side by side with the port.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const UPSTREAM = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream')
const require = createRequire(import.meta.url)

export interface ParamsFixture {
  readonly hex: string
  readonly offsets: Readonly<Record<string, { readonly offset: number; readonly type: number }>>
  readonly uploadHex: string
}

export function paramsFixture(): ParamsFixture {
  return JSON.parse(readFileSync(resolve(UPSTREAM, 'tests/fixtures/params.json'), 'utf8')) as ParamsFixture
}

export const upstreamSource = (path: string): string => readFileSync(resolve(UPSTREAM, path), 'utf8')

/** The static helpers of upstream `MAVParam` used by the oracle tests. */
export interface UpstreamMavParamStatics {
  decode(data: Uint8Array): Map<string, { name: string; value: number; type: number; defaultValue?: number }>
  encodeUpload(params: readonly { name: string; value: number; type: number }[]): Uint8Array
  parseText(text: string): Map<string, number>
  saveText(params: Iterable<{ name: string; value: number; type: number }>): string
  formatValue(p: { type: number; value: number }, value?: number): string
  vehicleName(type: number): string
}

/** Upstream `modules/MAVLink/mavparam.js` (CommonJS export). */
export function upstreamMavParam(): UpstreamMavParamStatics {
  const mod = require(resolve(UPSTREAM, 'modules/MAVLink/mavparam.js')) as { MAVParam: UpstreamMavParamStatics }
  return mod.MAVParam
}

export interface UpstreamMissionParser {
  parseMission(data: Uint8Array): Record<string, unknown>[] | null
  parseFence(data: Uint8Array): Record<string, unknown>[] | null
}

/** Upstream `MissionParser` from `modules/MAVLink/mavftp.js`, with the MAVLink global it expects. */
export function upstreamMissionParser(): UpstreamMissionParser {
  const mav = require(resolve(UPSTREAM, 'modules/MAVLink/mavlink.js')) as { mavlink20: unknown }
  Reflect.set(globalThis, 'mavlink20', mav.mavlink20)
  const mod = require(resolve(UPSTREAM, 'modules/MAVLink/mavftp.js')) as { MissionParser: new () => UpstreamMissionParser }
  return new mod.MissionParser()
}
