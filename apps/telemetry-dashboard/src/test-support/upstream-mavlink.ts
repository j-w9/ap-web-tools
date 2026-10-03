/**
 * Test-only: runs upstream `modules/MAVLink/mavlink.js` in a `node:vm` context (its Node path, as
 * `packages/mavlink/src/test-utils/upstream.ts` does) so the legacy adapter and the heartbeat can
 * be compared with what the original dashboard produced from the same bytes.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

export const UPSTREAM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream')
const UPSTREAM_MAVLINK = resolve(UPSTREAM_DIR, 'modules/MAVLink/mavlink.js')

/** Loose view of upstream's objects: tests compare them, they do not rely on their types. */
export interface UpstreamMessage {
  readonly _name: string
  readonly _id: number
  readonly fieldnames: readonly string[]
  readonly [field: string]: unknown
  pack(processor: UpstreamProcessor): number[]
}

export interface UpstreamProcessor {
  seq: number
  srcSystem: number
  srcComponent: number
  signing: { secret_key: Uint8Array; sign_outgoing: boolean; timestamp: number; link_id: number }
  decode(frame: Uint8Array): UpstreamMessage
  parseChar(c: number): UpstreamMessage | null
}

export interface UpstreamMavlink {
  readonly mavlink20: Record<string, unknown> & {
    readonly map: Readonly<Record<string, { readonly type: new () => UpstreamMessage; readonly crc_extra: number }>>
    readonly messages: Readonly<Record<string, new (...args: unknown[]) => UpstreamMessage>>
    readonly ready: Promise<void>
    sha256(data: Uint8Array): ArrayLike<number>
  }
  readonly MAVLink20Processor: new (logger: null, srcSystem: number, srcComponent: number) => UpstreamProcessor
}

function isUpstream(value: unknown): value is UpstreamMavlink {
  return typeof value === 'object' && value !== null && 'mavlink20' in value && 'MAVLink20Processor' in value
}

export async function loadUpstreamMavlink(): Promise<UpstreamMavlink> {
  const module: { exports: unknown } = { exports: {} }
  const sandbox: Record<string, unknown> = { require: createRequire(UPSTREAM_MAVLINK), module, process, console, Buffer }
  sandbox.global = sandbox
  runInContext(readFileSync(UPSTREAM_MAVLINK, 'utf8'), createContext(sandbox), { filename: UPSTREAM_MAVLINK })
  const exported = module.exports
  if (!isUpstream(exported)) throw new Error('upstream mavlink.js did not export mavlink20')
  await exported.mavlink20.ready
  return exported
}

/** Re-creates a vm-realm value in this realm so `toEqual` compares structure, not prototypes. */
export function plain(value: unknown): unknown {
  return structuredClone(value)
}

/** Seeded PRNG (mulberry32) for reproducible random payloads. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
