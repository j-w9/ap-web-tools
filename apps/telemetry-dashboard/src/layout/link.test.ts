import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { compressLayout, dashboardLink, decompressLayout, readHash } from './link.js'

const UPSTREAM = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream/TelemetryDashboard/TelemetryDashboard.js')

/** Upstream's compress/decompress functions, run as written. */
function upstreamCodec(): { compress(json: string): Promise<string>; decompress(text: string): Promise<string> } {
  const source = readFileSync(UPSTREAM, 'utf8')
  const start = source.indexOf('async function compress_layout')
  const end = source.indexOf('async function get_dashboard_link')
  const context = createContext({ TextEncoder, CompressionStream, DecompressionStream, Response, Uint8Array, btoa, atob, String })
  runInContext(source.slice(start, end) + '\nthis.c = compress_layout; this.d = decompress_layout', context)
  return { compress: context.c as (json: string) => Promise<string>, decompress: context.d as (text: string) => Promise<string> }
}

describe('dashboard links', () => {
  const json = JSON.stringify({
    header: { version: 1 },
    grid: { columns: 12, rows: 12, color: 'rgb(255, 255, 255)' },
    widgets: {}
  })

  it('compresses exactly as upstream and round-trips', async () => {
    const upstream = upstreamCodec()
    const ours = await compressLayout(json)
    expect(ours).toBe(await upstream.compress(json))
    expect(ours).not.toMatch(/[+/=]/)
    expect(await decompressLayout(ours)).toBe(json)
    expect(await upstream.decompress(ours)).toBe(json)
  })

  it('rejects malformed layout parameters', async () => {
    await expect(decompressLayout('!!!')).rejects.toThrow()
  })

  it('puts connection settings in the hash only when set, like get_dashboard_link', async () => {
    const plain = await dashboardLink(
      'https://x.org/T/?q=1#old',
      { ws: '', heartbeat: false, sysid: '254', compid: '190', signing: 'k' },
      json
    )
    expect(plain.startsWith('https://x.org/T/#layout=')).toBe(true)
    const full = await dashboardLink(
      'https://x.org/T/',
      { ws: 'ws://1.2.3.4:5', heartbeat: true, sysid: '1', compid: '2', signing: 'pass' },
      json
    )
    const hash = readHash(new URL(full).hash)
    expect(hash).toMatchObject({ ws: 'ws://1.2.3.4:5', heartbeat: true, sysid: '1', compid: '2', signing: 'pass' })
    expect(await decompressLayout(hash.layout ?? '')).toBe(json)
    const noMenu = await dashboardLink('https://x.org/T/', null, json)
    expect(new URL(noMenu).hash.startsWith('#layout=')).toBe(true)
  })

  it('reads hash parameters on load', () => {
    expect(readHash('')).toEqual({ layout: null, ws: null, heartbeat: false, sysid: null, compid: null, signing: null })
    expect(readHash('#heartbeat=').heartbeat).toBe(false)
    expect(readHash('#heartbeat=0').heartbeat).toBe(true)
  })
})
