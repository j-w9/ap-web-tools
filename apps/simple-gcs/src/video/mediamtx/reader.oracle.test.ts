// Differential test: the vendored upstream `SimpleGCS/vendor/mediamtx/reader.js` (run in node:vm)
// and the TypeScript port `MediaMTXWebRTCReader` run the same seeded scenarios against a fake
// RTCPeerConnection and fake WHEP server: codec probing, ICE server links, offer editing, POST
// results, answers, trickle ICE PATCHes, connection failures, the 2 s restart and close(). Every
// request (method, URL, headers, body), peer connection configuration, local/remote description,
// closed connection, error text and track delivery must match, in order.
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { upstreamSource } from '../../test-utils/upstream.js'
import { MediaMTXWebRTCReader, type ReaderConf } from './reader.js'

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

const PROBE_OFFER =
  'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' +
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8\r\nc=IN IP4 0.0.0.0\r\na=rtpmap:111 opus/48000/2\r\n' +
  'a=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\na=rtpmap:9 G722/8000\r\n'

const MAIN_OFFERS = [
  'v=0\r\no=- 3 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1 2\r\n' +
    'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 35 36 102\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:Ab12\r\n' +
    'a=ice-pwd:pwd1234567890abcdefghij\r\na=mid:0\r\na=recvonly\r\na=rtpmap:96 VP8/90000\r\n' +
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:Ab12\r\n' +
    'a=ice-pwd:pwd1234567890abcdefghij\r\na=mid:1\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n' +
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=mid:2\r\na=sctp-port:5000\r\n',
  'v=0\r\no=- 4 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' +
    'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=ice-ufrag:Zz\r\na=ice-pwd:Yy\r\na=rtpmap:96 H264/90000\r\n' +
    'm=audio 9 UDP/TLS/RTP/SAVPF 109 0\r\na=rtpmap:109 OPUS/48000/2\r\na=fmtp:109 stereo=1;minptime=10\r\n'
]

const LINKS = [
  null,
  '<stun:stun.l.google.com:19302>; rel="ice-server"',
  '<turn:turn.example.org:3478?transport=udp>; rel="ice-server"; username="us\\"er"; credential="p\\u00e4ss"; credential-type="password", <stun:s.example.org>; rel="ice-server"',
  'garbage'
]

interface Scenario {
  readonly supports: readonly boolean[]
  readonly mainOffer: string
  readonly user: string | undefined
  readonly pass: string | undefined
  readonly token: string | undefined
  readonly r: () => number
}

type Log = unknown[][]

/** Builds the fake browser APIs for one run; both runs see identical behaviour for the same seed. */
function fakeWorld(scenario: Scenario, log: Log) {
  const pcs: FakePc[] = []
  const r = scenario.r

  class FakeSessionDescription {
    readonly type: string
    readonly sdp: string
    constructor(init: { type: string; sdp: string }) {
      this.type = init.type
      this.sdp = init.sdp
    }
  }

  class FakePc {
    readonly index: number
    connectionState = 'new'
    onicecandidate: ((e: { candidate: unknown }) => void) | null = null
    onconnectionstatechange: (() => void) | null = null
    ontrack: ((e: unknown) => void) | null = null
    ondatachannel: ((e: unknown) => void) | null = null
    private readonly probe: boolean
    constructor(config: { iceServers: unknown[] }) {
      this.index = pcs.length
      this.probe = pcs.length < 3
      pcs.push(this)
      log.push(['pc', this.index, JSON.parse(JSON.stringify(config)) as unknown])
    }
    addTransceiver(kind: string, init: { direction: string }) {
      log.push(['transceiver', this.index, kind, init.direction])
    }
    createDataChannel(label: string) {
      log.push(['datachannel', this.index, label])
    }
    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: this.probe ? PROBE_OFFER : scenario.mainOffer })
    }
    setLocalDescription(d: { type: string; sdp: string }) {
      log.push(['local', this.index, d.type, d.sdp])
      return Promise.resolve()
    }
    setRemoteDescription(d: { type: string; sdp: string }) {
      log.push(['remote', this.index, d.type, d.sdp])
      if (this.probe) return scenario.supports[this.index] ? Promise.resolve() : Promise.reject(new Error('unsupported'))
      return r() < 0.85 ? Promise.resolve() : Promise.reject(new Error('Failed to set remote answer sdp'))
    }
    close() {
      log.push(['close', this.index])
      this.connectionState = 'closed'
    }
  }

  const response = (status: number, headers: Record<string, string | null>, body: string) => ({
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(JSON.parse(body) as unknown),
    text: () => Promise.resolve(body)
  })

  const fetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => {
    log.push(['fetch', init.method, url, JSON.stringify(init.headers ?? {}), init.body ?? null])
    // Both readers leave the DELETE promise unobserved, so only the other requests fail here.
    if (init.method !== 'DELETE' && r() < 0.08) return Promise.reject(new TypeError('Failed to fetch'))
    switch (init.method) {
      case 'OPTIONS':
        return Promise.resolve(response(204, { link: LINKS[Math.floor(r() * LINKS.length)]! }, ''))
      case 'POST': {
        const roll = r()
        if (roll < 0.6)
          return Promise.resolve(response(201, { location: r() < 0.9 ? '/stream/whep/abc-123' : null }, 'v=0\r\nanswer\r\n'))
        if (roll < 0.7) return Promise.resolve(response(404, {}, ''))
        if (roll < 0.8) return Promise.resolve(response(400, {}, r() < 0.5 ? '{"error":"invalid offer"}' : '{}'))
        return Promise.resolve(response(r() < 0.5 ? 401 : 500, {}, ''))
      }
      case 'PATCH': {
        const roll = r()
        return Promise.resolve(response(roll < 0.8 ? 204 : roll < 0.9 ? 404 : 500, {}, ''))
      }
      default:
        return Promise.resolve(response(200, {}, ''))
    }
  }

  return { pcs, FakePc, FakeSessionDescription, fetch }
}

type Action = 'flush' | 'tick' | 'candidate' | 'nullCandidate' | 'failed' | 'closedState' | 'connected' | 'track' | 'close'

function actions(r: () => number): Action[] {
  const list: Action[] = []
  for (let i = 0; i < 40; i++) {
    const roll = r()
    if (roll < 0.35) list.push('flush')
    else if (roll < 0.5) list.push('tick')
    else if (roll < 0.7) list.push('candidate')
    else if (roll < 0.74) list.push('nullCandidate')
    else if (roll < 0.8) list.push('failed')
    else if (roll < 0.83) list.push('closedState')
    else if (roll < 0.88) list.push('connected')
    else if (roll < 0.95) list.push('track')
    else list.push('close')
  }
  return list
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve()
}

interface Reader {
  close(): void
}

async function runScenario(
  seed: number,
  create: (world: ReturnType<typeof fakeWorld>, conf: ReaderConf) => Reader
): Promise<Log> {
  const setup = rng(seed)
  const supports = [setup() < 0.5, setup() < 0.5, setup() < 0.5]
  const auth = setup()
  const scenario: Scenario = {
    supports,
    mainOffer: MAIN_OFFERS[Math.floor(setup() * MAIN_OFFERS.length)]!,
    user: auth < 0.4 ? 'viewer' : auth < 0.6 ? '' : undefined,
    pass: auth < 0.3 ? 'fixture-view' : undefined,
    token: auth > 0.8 ? 'tok-en' : undefined,
    r: rng(seed * 7919 + 1)
  }
  const log: Log = []
  const world = fakeWorld(scenario, log)
  const conf: { -readonly [K in keyof ReaderConf]: ReaderConf[K] } = {
    url: 'https://cam.example.org:8889/stream/whep',
    onError: (err) => log.push(['onError', err]),
    onTrack: (evt) => log.push(['onTrack', (evt as unknown as { id: number }).id])
  }
  if (scenario.user !== undefined) conf.user = scenario.user
  if (scenario.pass !== undefined) conf.pass = scenario.pass
  if (scenario.token !== undefined) conf.token = scenario.token
  const reader = create(world, conf)
  const events = rng(seed * 104729 + 3)
  let candidate = 0
  for (const action of actions(events)) {
    const pc = world.pcs.at(-1)
    const main = pc !== undefined && pc.index >= 3 ? pc : undefined
    switch (action) {
      case 'flush':
        await flush()
        break
      case 'tick':
        await vi.advanceTimersByTimeAsync(events() < 0.5 ? 1999 : 2000)
        await flush()
        break
      case 'candidate':
        candidate++
        main?.onicecandidate?.({
          candidate: {
            sdpMLineIndex: candidate % 3 === 2 ? null : candidate % 2,
            candidate: `candidate:${candidate} 1 udp 2122260223 192.168.1.${candidate} 5000${candidate} typ host`
          }
        })
        break
      case 'nullCandidate':
        main?.onicecandidate?.({ candidate: null })
        break
      case 'failed':
      case 'closedState':
      case 'connected':
        if (main !== undefined) {
          main.connectionState = action === 'failed' ? 'failed' : action === 'closedState' ? 'closed' : 'connected'
          main.onconnectionstatechange?.()
        }
        break
      case 'track':
        main?.ontrack?.({ id: candidate })
        break
      case 'close':
        reader.close()
        break
    }
    log.push(['step', action])
  }
  await flush()
  reader.close()
  await vi.advanceTimersByTimeAsync(5000)
  await flush()
  return log
}

function upstreamReader(world: ReturnType<typeof fakeWorld>, conf: ReaderConf): Reader {
  const window: Record<string, unknown> = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms)
  }
  runInNewContext(upstreamSource('SimpleGCS/vendor/mediamtx/reader.js'), {
    window,
    RTCPeerConnection: world.FakePc,
    RTCSessionDescription: world.FakeSessionDescription,
    fetch: world.fetch,
    btoa,
    URL,
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t)
  })
  const Ctor = window.MediaMTXWebRTCReader as new (c: ReaderConf) => Reader
  return new Ctor(conf)
}

function portReader(world: ReturnType<typeof fakeWorld>, conf: ReaderConf): Reader {
  vi.stubGlobal('RTCPeerConnection', world.FakePc)
  vi.stubGlobal('RTCSessionDescription', world.FakeSessionDescription)
  vi.stubGlobal('fetch', world.fetch)
  return new MediaMTXWebRTCReader(conf)
}

describe('MediaMTX WHEP reader oracle (upstream vendor/mediamtx/reader.js)', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('matches upstream for 120 seeded signalling scenarios', async () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 120; seed++) {
      const up = await runScenario(seed, upstreamReader)
      const port = await runScenario(seed, portReader)
      expect(port, `seed ${seed}`).toEqual(up)
      for (const entry of up) {
        if (entry[0] === 'fetch') seen.add(String(entry[1]))
        if (entry[0] === 'onError') seen.add(String(entry[1]).replace(/, retrying in some seconds$/, ''))
        if (entry[0] === 'onTrack') seen.add('track')
      }
    }
    // The scenarios reach every request type, the error paths and track delivery.
    for (const expected of [
      'OPTIONS',
      'POST',
      'PATCH',
      'DELETE',
      'track',
      'Error: stream not found',
      'Error: invalid offer',
      'Error',
      'Error: bad status code 401',
      'TypeError: Failed to fetch',
      'peer connection closed',
      'Error: Failed to set remote answer sdp'
    ]) {
      expect(seen, expected).toContain(expected)
    }
  })
})
