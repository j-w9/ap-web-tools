// Video settings and HLS selection, covering the non-network checks of upstream
// tests/video-browser.cjs (native-HLS fallback, cancelled settings) and its WHEP reader config.
import { describe, expect, it } from 'vitest'
import { memoryStore } from '../link/storage.js'
import { MediaMTXWebRTCReader } from './mediamtx/reader.js'
import { applyVideoSettings, chooseHlsPlayback, hlsUrl, loadVideoConfig, webRtcOptions } from './video-config.js'
import { describeVideoError } from './webrtc-player.js'

describe('video settings', () => {
  it('defaults to the page host and builds MediaMTX URLs', () => {
    const c = loadVideoConfig(memoryStore(), { hostname: 'gcs.example.org', protocol: 'https:' })
    expect(hlsUrl(c)).toBe('https://gcs.example.org:8888/stream/index.m3u8')
    expect(webRtcOptions(c)).toEqual({ url: 'https://gcs.example.org:8889/stream/whep', user: '', pass: '' })
  })

  it('cancelling any settings prompt leaves every saved value unchanged', () => {
    const store = memoryStore({ 'video.user': 'viewer', 'video.pass': 'fixture-view' })
    const c = loadVideoConfig(store, { hostname: '127.0.0.1', protocol: 'http:' })
    const saved = JSON.stringify([...store.data])
    for (const cancelled of ['host', 'path', 'user', 'pass'] as const) {
      const answers = { host: c.host, path: c.path, user: c.user, pass: c.pass, [cancelled]: null }
      expect(applyVideoSettings(c, answers, store)).toBeNull()
    }
    expect(applyVideoSettings(c, { host: ' ', path: 'x', user: '', pass: '' }, store)).toBeNull()
    expect(JSON.stringify([...store.data])).toBe(saved)
    const next = applyVideoSettings(c, { host: 'cam', path: 'live', user: 'u', pass: 'p' }, store)
    expect(next?.host).toBe('cam')
    expect(store.data.get('video.path')).toBe('live')
    // Upstream checks the trimmed values but stores them as entered (docs/upstream-bugs.md).
    expect(applyVideoSettings(c, { host: ' cam ', path: 'live', user: '', pass: '' }, store)?.host).toBe(' cam ')
  })

  it('protected streams never use unauthenticated native HLS', () => {
    const base = { pageIsHttps: false, url: 'http://h:8888/s/index.m3u8', canPlayNative: true }
    expect(chooseHlsPlayback({ ...base, hasAuth: true, hlsJsSupported: false })).toBe('webrtc-fallback')
    expect(chooseHlsPlayback({ ...base, hasAuth: true, hlsJsSupported: true })).toBe('hlsjs')
    expect(chooseHlsPlayback({ ...base, hasAuth: false, hlsJsSupported: false })).toBe('native')
    expect(chooseHlsPlayback({ ...base, pageIsHttps: true, hasAuth: false, hlsJsSupported: true })).toBe('webrtc-fallback')
  })

  it('reader errors map to the badge texts', () => {
    expect(describeVideoError('bad status code 401, retrying in some seconds')).toBe(
      'Authentication failed. Check video settings. Retrying…'
    )
    expect(describeVideoError('Error: stream not found')).toBe('Stream not found. Check video settings.')
    expect(describeVideoError('peer connection closed')).toBe('Unable to play video. Check the connection and video settings.')
  })

  it('offer editing enables stereo Opus and reserves payload types like the vendored reader', () => {
    const sdp =
      'v=0\r\nm=video 9 UDP 96\r\na=rtpmap:96 VP8/90000\r\nm=audio 9 UDP 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n'
    const edited = MediaMTXWebRTCReader.editOffer(sdp, ['pcma/8000/2'])
    expect(edited).toContain('a=fmtp:111 minptime=10;stereo=1;sprop-stereo=1')
    expect(edited).toContain('m=audio 9 UDP 111 30 31')
    expect(edited).toContain('a=rtpmap:30 PCMU/8000/2')
    expect(edited).toContain('a=rtpmap:31 PCMA/8000/2')
  })
})
