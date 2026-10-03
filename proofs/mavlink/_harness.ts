/**
 * Runs upstream `modules/MAVLink/mavlink.js` (pymavlink-generated, with its runtime fixes) in a
 * `node:vm` context. Loader lines copied from `packages/mavlink/src/test-utils/upstream.ts`.
 * Upstream takes its Node path (CommonJS `require` of jspack), so `mavlink20.ready` is already
 * resolved; it is awaited anyway.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const UPSTREAM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../upstream')
export const UPSTREAM_MAVLINK = resolve(UPSTREAM_DIR, 'modules/MAVLink/mavlink.js')

/** An upstream message: fields by snake_case name plus metadata. */
export interface UpstreamMessage {
  readonly _name: string
  readonly _id: number
  readonly _reason?: string
  readonly _payload: readonly number[] | Uint8Array
  readonly fieldnames: readonly string[]
  readonly [field: string]: unknown
  pack(processor: UpstreamProcessor): (number | undefined)[]
}

export interface UpstreamProcessor {
  seq: number
  parseBuffer(bytes: Uint8Array | null): UpstreamMessage[] | null
}

export type MessageConstructor = new (...args: unknown[]) => UpstreamMessage

export interface UpstreamMavlink {
  readonly mavlink20: {
    readonly ready: Promise<void>
    readonly messages: Readonly<Record<string, MessageConstructor>>
    sha256(input: Uint8Array): Uint8Array
    create_signature(key: Uint8Array, data: Uint8Array): Uint8Array
    x25Crc(bytes: ArrayLike<number>, crc?: number): number
  }
  readonly MAVLink20Processor: new (logger: null, srcSystem: number, srcComponent: number) => UpstreamProcessor
}

function isUpstream(value: unknown): value is UpstreamMavlink {
  return typeof value === 'object' && value !== null && 'mavlink20' in value && 'MAVLink20Processor' in value
}

/** Lines upstream (and jspack) print with `console.log`, captured instead of printed. */
export interface Loaded extends UpstreamMavlink {
  readonly logs: string[]
}

export async function loadUpstream(): Promise<Loaded> {
  const logs: string[] = []
  const quietConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
  }
  const module = { exports: {} as unknown }
  const sandbox: Record<string, unknown> = {
    require: createRequire(UPSTREAM_MAVLINK),
    module,
    process,
    console: quietConsole,
    Buffer
  }
  sandbox.global = sandbox
  const context = createContext(sandbox)
  runInContext(readFileSync(UPSTREAM_MAVLINK, 'utf8'), context, { filename: UPSTREAM_MAVLINK })
  const exported = module.exports
  if (!isUpstream(exported)) throw new Error('upstream mavlink.js did not export mavlink20')
  await exported.mavlink20.ready
  return { ...exported, logs }
}

/** Upstream `pack` output as wire bytes (holes and `undefined` become 0, as `Uint8Array.from` does). */
export function wire(packed: readonly (number | undefined)[]): Uint8Array {
  return Uint8Array.from(packed, (b) => b ?? 0)
}

export function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
