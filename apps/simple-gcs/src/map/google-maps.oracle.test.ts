// Differential test: upstream `GMapsLoader` (`SimpleGCS/util.js`, run in node:vm) and the port's
// `loadGoogleMaps` see the same calls: already loaded API, missing key (the rejected promise stays
// cached until a reload, hence "Refresh page to apply"), script URL, callback success, script
// error (the cache is cleared so a later call retries) and concurrent calls sharing one script.
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { upstreamSource } from '../test-utils/upstream.js'

interface Script {
  src: string
  async: boolean
  defer: boolean
  onerror: ((e: unknown) => void) | null
}

type Step = { readonly kind: 'load'; readonly key: string } | { readonly kind: 'callback' | 'scriptError' | 'apiPresent' }

function world() {
  const scripts: Script[] = []
  const win: Record<string, unknown> = {}
  const document = {
    createElement: (): Script => ({ src: '', async: false, defer: false, onerror: null }),
    head: { appendChild: (s: Script) => void scripts.push(s) }
  }
  return { scripts, win, document }
}

async function run(
  steps: readonly Step[],
  load: (w: ReturnType<typeof world>, key: string) => Promise<void>,
  w: ReturnType<typeof world>
) {
  const log: string[] = []
  const pending: Promise<void>[] = []
  for (const step of steps) {
    switch (step.kind) {
      case 'load': {
        const n = pending.length
        const p = load(w, step.key).then(
          () => void log.push(`resolved ${n}`),
          () => void log.push(`rejected ${n}`)
        )
        pending.push(p)
        break
      }
      case 'callback': {
        const cb = w.win.__onGMapsLoaded
        if (typeof cb === 'function') (cb as () => void)()
        break
      }
      case 'scriptError':
        w.scripts.at(-1)?.onerror?.(new Error('script error'))
        break
      case 'apiPresent':
        w.win.google = { maps: {} }
        break
    }
    for (let i = 0; i < 5; i++) await Promise.resolve()
    log.push(`scripts ${w.scripts.map((s) => `${s.src}|${s.async}|${s.defer}`).join(',')} cb ${typeof w.win.__onGMapsLoaded}`)
  }
  return log
}

async function upstream(steps: readonly Step[]) {
  const w = world()
  runInNewContext(upstreamSource('SimpleGCS/util.js'), {
    window: w.win,
    document: w.document,
    encodeURIComponent,
    Promise,
    Error
  })
  const loader = w.win.GMapsLoader as { load(key: string): Promise<void> }
  return run(steps, (_w, key) => loader.load(key), w)
}

async function port(steps: readonly Step[]) {
  const w = world()
  vi.resetModules()
  vi.stubGlobal('window', w.win)
  vi.stubGlobal('document', w.document)
  const { loadGoogleMaps } = await import('./google-maps.js')
  return run(steps, (_w, key) => loadGoogleMaps(key), w)
}

const SCENARIOS: Step[][] = [
  [
    { kind: 'load', key: '' },
    { kind: 'load', key: 'k1' },
    { kind: 'load', key: 'k2' }
  ],
  [{ kind: 'load', key: 'k 1&x' }, { kind: 'load', key: 'k2' }, { kind: 'callback' }, { kind: 'load', key: 'k3' }],
  [{ kind: 'load', key: 'k1' }, { kind: 'scriptError' }, { kind: 'load', key: 'k2' }, { kind: 'callback' }],
  [{ kind: 'apiPresent' }, { kind: 'load', key: '' }],
  [{ kind: 'load', key: '' }, { kind: 'apiPresent' }, { kind: 'load', key: '' }]
]

describe('Google Maps loader oracle (upstream util.js GMapsLoader)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(SCENARIOS.map((s, i) => [i, s] as const))('scenario %i matches', async (_i, steps) => {
    expect(await port(steps)).toEqual(await upstream(steps))
  })
})
