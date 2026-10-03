// Differential tests against upstream `SimpleGCS/webrtc-player.js` and `SimpleGCS/video.js`, run in
// node:vm with fake video elements, readers, storage and windows.
//  - WebRTCPlayer: identical seeded sequences of reader tracks/errors, media events, play
//    rejections, page hide and close; badge text and colour, the element and reader state match.
//  - Video options and new-window handshake: for the same saved settings and page location, the
//    WHEP options posted to the new window, the target origin, which messages are answered and the
//    30 s expiry match.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { Timer } from '../clock.js'
import { memoryStore } from '../link/storage.js'
import { FakeClock } from '../test-utils/fake-clock.js'
import { upstreamSource } from '../test-utils/upstream.js'
import { openVideoWindow, type OpenerWindow } from './popup.js'
import { loadVideoConfig, webRtcOptions } from './video-config.js'
import { WebRtcPlayer, type PlayerReaderConf, type VideoTone } from './webrtc-player.js'

const TONE_COLOURS: Record<VideoTone, string> = { live: '#4caf50', waiting: '#b36b00', error: '#b3261e', hls: '#ff9800' }

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------------------------- WebRTCPlayer

type PlayerStep =
  | { readonly kind: 'track'; readonly stream: number; readonly playRejects: boolean }
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'playing' | 'waiting' | 'pagehide' | 'close' | 'flush' }

const ERRORS = [
  'bad status code 401, retrying in some seconds',
  'bad status code 403',
  'Error: Unauthorized',
  'stream not found, retrying in some seconds',
  'bad status code 404',
  'peer connection closed, retrying in some seconds',
  'TypeError: Failed to fetch',
  'closed'
]

interface FakeVideo {
  srcObject: unknown
  paused: boolean
  playRejects: boolean
  readonly listeners: Map<string, () => void>
  addEventListener(n: string, fn: () => void): void
  removeEventListener(n: string): void
  play(): Promise<void>
  pause(): void
}

function fakeVideo(): FakeVideo {
  return {
    srcObject: null,
    paused: false,
    playRejects: false,
    listeners: new Map(),
    addEventListener(n, fn) {
      this.listeners.set(n, fn)
    },
    removeEventListener(n) {
      this.listeners.delete(n)
    },
    play() {
      return this.playRejects ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()
    },
    pause() {
      this.paused = true
    }
  }
}

interface PlayerHarness {
  readonly video: FakeVideo
  readonly windowListeners: Map<string, () => void>
  status(): { text: string; colour: string }
  conf(): PlayerReaderConf | undefined
  closes(): number
  close(): void
}

const STREAMS = [{ id: 0 }, { id: 1 }, { id: 2 }]

function upstreamPlayer(readerThrows: boolean): PlayerHarness {
  const video = fakeVideo()
  const windowListeners = new Map<string, () => void>()
  const status = { textContent: '', style: { background: '' } }
  let conf: PlayerReaderConf | undefined
  let closes = 0
  const window = {
    addEventListener: (n: string, f: () => void) => void windowListeners.set(n, f),
    removeEventListener: (n: string) => void windowListeners.delete(n)
  }
  runInNewContext(upstreamSource('SimpleGCS/webrtc-player.js'), {
    window,
    MediaMTXWebRTCReader: class {
      constructor(options: PlayerReaderConf) {
        if (readerThrows) throw new Error('RTCPeerConnection is not defined')
        conf = options
      }
      close() {
        closes++
      }
    }
  })
  const Player = Reflect.get(window, 'WebRTCPlayer') as new (v: unknown, s: unknown, o: unknown) => { close(): void }
  const player = new Player(video, status, { url: 'https://cam.example.org:8889/stream/whep', user: 'viewer', pass: 'pw' })
  return {
    video,
    windowListeners,
    status: () => ({ text: status.textContent, colour: status.style.background }),
    conf: () => conf,
    closes: () => closes,
    close: () => player.close()
  }
}

function portPlayer(readerThrows: boolean): PlayerHarness {
  const video = fakeVideo()
  const windowListeners = new Map<string, () => void>()
  let status = { text: '', colour: '' }
  let conf: PlayerReaderConf | undefined
  let closes = 0
  const player = new WebRtcPlayer(
    video as unknown as ConstructorParameters<typeof WebRtcPlayer>[0],
    (s) => (status = { text: s.text, colour: TONE_COLOURS[s.tone] }),
    { url: 'https://cam.example.org:8889/stream/whep', user: 'viewer', pass: 'pw' },
    (options) => {
      if (readerThrows) throw new Error('RTCPeerConnection is not defined')
      conf = options
      return {
        close: () => {
          closes++
        }
      }
    },
    {
      addEventListener: (n, f) => void windowListeners.set(n, f),
      removeEventListener: (n) => void windowListeners.delete(n)
    }
  )
  return { video, windowListeners, status: () => status, conf: () => conf, closes: () => closes, close: () => player.close() }
}

async function playerStep(h: PlayerHarness, step: PlayerStep): Promise<void> {
  switch (step.kind) {
    case 'track':
      h.video.playRejects = step.playRejects
      h.conf()?.onTrack({ streams: [STREAMS[step.stream] as unknown as MediaStream] })
      return
    case 'error':
      return h.conf()?.onError(step.text)
    case 'playing':
    case 'waiting':
      return h.video.listeners.get(step.kind)?.()
    case 'pagehide':
      return h.windowListeners.get('pagehide')?.()
    case 'close':
      return h.close()
    case 'flush':
      // Let rejected play() promises settle.
      for (let i = 0; i < 3; i++) await Promise.resolve()
  }
}

function playerSteps(seed: number): PlayerStep[] {
  const r = rng(seed)
  const steps: PlayerStep[] = []
  for (let i = 0; i < 40; i++) {
    const roll = r()
    if (roll < 0.2) steps.push({ kind: 'track', stream: Math.floor(r() * 3), playRejects: r() < 0.4 })
    else if (roll < 0.4) steps.push({ kind: 'error', text: ERRORS[Math.floor(r() * ERRORS.length)]! })
    else if (roll < 0.6) steps.push({ kind: 'playing' })
    else if (roll < 0.75) steps.push({ kind: 'waiting' })
    else if (roll < 0.95) steps.push({ kind: 'flush' })
    else steps.push({ kind: r() < 0.5 ? 'pagehide' : 'close' })
  }
  return steps
}

const playerState = (h: PlayerHarness) => ({
  status: h.status(),
  srcObject: h.video.srcObject,
  paused: h.video.paused,
  listeners: [...h.video.listeners.keys()].sort(),
  windowListeners: [...h.windowListeners.keys()],
  closes: h.closes(),
  conf: h.conf() && { url: h.conf()!.url, user: h.conf()!.user, pass: h.conf()!.pass }
})

describe('WebRTCPlayer oracle (upstream webrtc-player.js)', () => {
  it('matches upstream for 150 seeded event sequences', async () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 150; seed++) {
      const up = upstreamPlayer(false)
      const port = portPlayer(false)
      expect(playerState(port)).toEqual(playerState(up))
      for (const [i, step] of playerSteps(seed).entries()) {
        await playerStep(up, step)
        await playerStep(port, step)
        expect(playerState(port), `seed ${seed} step ${i}`).toEqual(playerState(up))
        seen.add(up.status().text.replace(' Retrying…', ''))
      }
    }
    expect([...seen].sort()).toEqual(
      [
        'WebRTC · Authentication failed. Check video settings.',
        'WebRTC · Buffering',
        'WebRTC · Connecting',
        'WebRTC · Live',
        'WebRTC · Press play to watch',
        'WebRTC · Stream not found. Check video settings.',
        'WebRTC · Unable to play video. Check the connection and video settings.'
      ].sort()
    )
  })

  it('a reader that cannot be created shows the same error badge', () => {
    const up = upstreamPlayer(true)
    const port = portPlayer(true)
    expect(playerState(port)).toEqual(playerState(up))
    expect(up.status().text).toBe('WebRTC · Unable to play video. Check the connection and video settings.')
  })
})

// ------------------------------------------------------------------ video options and new window

interface PageCase {
  readonly saved: Readonly<Record<string, string>>
  readonly hostname: string
  readonly protocol: string
}

const PAGES: PageCase[] = [
  { saved: {}, hostname: 'gcs.example.org', protocol: 'https:' },
  { saved: {}, hostname: '', protocol: 'http:' },
  { saved: { 'video.host': 'cam.local', 'video.path': 'live/boat' }, hostname: 'gcs.example.org', protocol: 'http:' },
  { saved: { 'video.user': 'viewer', 'video.pass': 'fixture-view' }, hostname: '10.0.0.5', protocol: 'https:' },
  { saved: { 'video.host': '', 'video.path': '', 'video.user': 'u', 'video.pass': '' }, hostname: 'h', protocol: 'file:' }
]

interface Posted {
  readonly message: unknown
  readonly origin: string
}

/** A window stub shared by both sides; `fire` delivers a message event to the listeners. */
function fakeOpener(clock: FakeClock, page: PageCase) {
  const listeners = new Set<(e: MessageEvent) => void>()
  const posted: Posted[] = []
  const popup = { postMessage: (message: unknown, origin: string) => void posted.push({ message, origin }) }
  const origin = page.protocol === 'file:' ? 'null' : `${page.protocol}//${page.hostname || 'localhost'}`
  const win = {
    open: () => popup,
    addEventListener: (_t: 'message', l: (e: MessageEvent) => void) => void listeners.add(l),
    removeEventListener: (_t: 'message', l: (e: MessageEvent) => void) => void listeners.delete(l),
    location: {
      origin,
      href: page.protocol === 'file:' ? 'file:///SimpleGCS/index.html' : `${origin}/SimpleGCS/index.html`,
      hostname: page.hostname,
      protocol: page.protocol
    },
    setTimeout: (fn: () => void, ms: number): Timer => clock.after(ms, fn),
    clearTimeout: (t: Timer | null) => t?.cancel()
  }
  return {
    win,
    popup,
    posted,
    listeners,
    fire: (source: unknown, from: string, data: unknown) => {
      const event: Pick<MessageEvent, 'source' | 'origin' | 'data'> = { source: source as MessageEventSource, origin: from, data }
      for (const l of [...listeners]) l(event as MessageEvent)
    }
  }
}

function upstreamNewWindow(page: PageCase, clock: FakeClock) {
  const o = fakeOpener(clock, page)
  const store = new Map(Object.entries(page.saved))
  runInNewContext(upstreamSource('SimpleGCS/video.js'), {
    window: o.win,
    location: o.win.location,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    document: { baseURI: o.win.location.href },
    URL,
    setTimeout: o.win.setTimeout,
    clearTimeout: o.win.clearTimeout
  })
  const api = Reflect.get(o.win, 'VideoPanel') as { openNewWindow(): void }
  api.openNewWindow()
  return o
}

function portNewWindow(page: PageCase, clock: FakeClock) {
  const o = fakeOpener(clock, page)
  openVideoWindow(o.win as unknown as OpenerWindow, webRtcOptions(loadVideoConfig(memoryStore(page.saved), o.win.location)))
  return o
}

describe('video options and new-window handshake oracle (upstream video.js)', () => {
  it.each(PAGES.map((p, i) => [i, p] as const))('page %i posts the same options to the same origin', (_i, page) => {
    const results = [upstreamNewWindow, portNewWindow].map((open) => {
      const clock = new FakeClock()
      const o = open(page, clock)
      const origin = o.win.location.origin
      o.fire({}, origin, 'simplegcs-video-ready') // another window
      o.fire(o.popup, 'https://evil.example', 'simplegcs-video-ready') // another origin
      o.fire(o.popup, origin, 'ready') // another message
      const ignored = o.posted.length
      o.fire(o.popup, origin, 'simplegcs-video-ready')
      o.fire(o.popup, origin, 'simplegcs-video-ready') // answered once only
      return { ignored, posted: o.posted, listening: o.listeners.size, timers: clock.pending }
    })
    expect(results[0]!.ignored).toBe(0)
    expect(results[0]!.posted).toHaveLength(1)
    expect(results[1]).toEqual(results[0])
  })

  it('stops listening after 30 s without a ready message', () => {
    const results = [upstreamNewWindow, portNewWindow].map((open) => {
      const clock = new FakeClock()
      const o = open(PAGES[3]!, clock)
      clock.tick(29999)
      const listening = o.listeners.size
      clock.tick(1)
      o.fire(o.popup, o.win.location.origin, 'simplegcs-video-ready')
      return { listening, after: o.listeners.size, posted: o.posted.length }
    })
    expect(results[0]).toEqual({ listening: 1, after: 0, posted: 0 })
    expect(results[1]).toEqual(results[0])
  })
})
