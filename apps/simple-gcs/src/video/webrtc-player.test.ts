// Port of upstream tests/webrtc-player.test.cjs.
import { describe, expect, it } from 'vitest'
import { WebRtcPlayer, type PlayerReaderConf, type PlayerVideo, type PlayerWindow, type VideoStatus } from './webrtc-player.js'

function setup() {
  const listeners = new Map<string, () => void>()
  const windowListeners = new Map<string, () => void>()
  const video: PlayerVideo & { paused: boolean } = {
    srcObject: null,
    paused: false,
    addEventListener: (n, fn) => void listeners.set(n, fn),
    removeEventListener: (n) => void listeners.delete(n),
    play: () => Promise.resolve(),
    pause() {
      this.paused = true
    }
  }
  let status: VideoStatus = { text: '', tone: 'waiting' }
  let config: PlayerReaderConf | undefined
  let closed = 0
  const win: PlayerWindow = {
    addEventListener: (n, f) => void windowListeners.set(n, f),
    removeEventListener: (n) => void windowListeners.delete(n)
  }
  const player = new WebRtcPlayer(
    video,
    (s) => (status = s),
    { url: 'https://video.example.org/stream/whep', user: 'viewer', pass: 'test' },
    (options) => {
      config = options
      return {
        close: () => {
          closed++
        }
      }
    },
    win
  )
  return { video, status: () => status.text, player, config: config!, listeners, windowListeners, closeCount: () => closed }
}

const stream = (): MediaStream => new EventTarget() as MediaStream
const track = (s: MediaStream) => ({ streams: [s] })

describe('WebRTCPlayer', () => {
  it('WebRTC badge becomes live only on playback; errors clear stale video', () => {
    const { config, video, status, listeners } = setup()
    expect(config.user).toBe('viewer')
    expect(config.pass).toBe('test')
    expect(status()).toMatch(/Connecting/)
    const s = stream()
    config.onTrack(track(s))
    expect(video.srcObject).toBe(s)
    expect(status()).toMatch(/Connecting/)
    listeners.get('playing')!()
    expect(status()).toMatch(/Live/)
    listeners.get('waiting')!()
    expect(status()).toMatch(/Buffering/)
    config.onError('unauthorized')
    expect(status()).toMatch(/Authentication failed/)
    expect(video.srcObject).toBeNull()
    listeners.get('waiting')!()
    listeners.get('playing')!()
    expect(status()).toMatch(/Authentication failed/)
  })

  it('closing or leaving the page releases playback and ignores late callbacks', () => {
    const { config, video, status, player, listeners, windowListeners, closeCount } = setup()
    windowListeners.get('pagehide')!()
    player.close()
    expect(closeCount()).toBe(1)
    expect(video.paused).toBe(true)
    expect(listeners.size).toBe(0)
    expect(windowListeners.size).toBe(0)
    const message = status()
    config.onError('late')
    config.onTrack(track(stream()))
    expect(video.srcObject).toBeNull()
    expect(status()).toBe(message)
  })
})
