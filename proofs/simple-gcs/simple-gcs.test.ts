import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { REPO, functionSource, methodSource, upstreamGMapsLoader, upstreamMavlink20, upstreamSource } from './_harness.js'

describe('Simple GCS #66: MAV_RESULT_CANCELLED is not in the bundled dialect', () => {
  it('reports result 6 as "RESULT 6"; the CANCELLED case compares with undefined', () => {
    const mavlink20 = upstreamMavlink20()
    const mavResultName = runInNewContext(`(${functionSource('SimpleGCS/app.js', 'mavResultName')})`, { mavlink20 }) as (
      code: unknown
    ) => string
    expect(mavlink20.MAV_RESULT_CANCELLED).toBeUndefined()
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(mavResultName)).toEqual([
      'ACCEPTED',
      'TEMPORARILY_REJECTED',
      'DENIED',
      'UNSUPPORTED',
      'FAILED',
      'IN_PROGRESS',
      'RESULT 6',
      'RESULT 7',
      'RESULT 8'
    ])
    // The dialect has no MAV_RESULT with value 6, in mavlink.js or in the XML it was generated from.
    const values = Object.entries(mavlink20)
      .filter(([k]) => k.startsWith('MAV_RESULT_') && k !== 'MAV_RESULT_ENUM_END')
      .map(([, v]) => v)
    expect(values).toEqual([0, 1, 2, 3, 4, 5, 7, 8])
    const xml = readFileSync(resolve(REPO, 'packages/mavlink/definitions/common.xml'), 'utf8')
    const mavResult = /<enum name="MAV_RESULT">([\s\S]*?)<\/enum>/.exec(xml)?.[1] ?? ''
    expect([...mavResult.matchAll(/value="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([0, 1, 2, 3, 4, 5, 7, 8])
  })
})

describe('Simple GCS #67: video settings checked trimmed, saved untrimmed', () => {
  function panel(answers: string[]) {
    const stored: Record<string, string> = {}
    const methods = runInNewContext(
      `({ ${methodSource('SimpleGCS/video.js', 'openSettings')}, ${methodSource('SimpleGCS/video.js', '_webrtcUrl')}, ${methodSource('SimpleGCS/video.js', '_hlsUrl')}, ${methodSource('SimpleGCS/video.js', '_webRTCOptions')} })`,
      {
        prompt: () => answers.shift() ?? null,
        localStorage: { setItem: (k: string, v: string) => (stored[k] = v) }
      }
    ) as Record<string, (this: unknown) => unknown>
    const self = {
      host: 'gcs.local',
      path: 'stream',
      user: '',
      pass: '',
      scheme: 'http',
      hlsPort: 8888,
      wrtcPort: 8889,
      el: null
    }
    Object.assign(self, methods)
    return { self: self as typeof self & Record<string, () => unknown>, stored }
  }

  it('rejects a blank host but stores " cam " with its spaces', () => {
    const blank = panel(['   ', 'stream', '', ''])
    blank.self.openSettings!()
    expect(blank.stored).toEqual({})

    const p = panel([' cam ', 'stream', '', ''])
    p.self.openSettings!()
    expect(p.stored).toEqual({ 'video.host': ' cam ', 'video.path': 'stream', 'video.user': '', 'video.pass': '' })
    expect(p.self._webRTCOptions!()).toEqual({ url: 'http:// cam :8889/stream/whep', user: '', pass: '' })
    expect(p.self._hlsUrl!()).toBe('http:// cam :8888/stream/index.m3u8')
    expect(() => new URL('http:// cam :8889/stream/whep')).toThrow(TypeError)
  })
})

describe('Simple GCS #122: a rejected Google Maps load is cached', () => {
  it("load('') then load('k1') both reject with the missing-key error; no script is added", async () => {
    const { loader, scripts } = upstreamGMapsLoader()
    await expect(loader.load('')).rejects.toThrow('GMAPS_API_KEY missing')
    await expect(loader.load('k1')).rejects.toThrow('GMAPS_API_KEY missing')
    expect(scripts).toEqual([])
  })

  it('the key dialog tells the user to refresh the page to apply a new key', () => {
    const app = upstreamSource('SimpleGCS/app.js').split('\n')
    expect(app[557]?.trim()).toBe('window.GCSUtils.toast("API key saved. Refresh page to apply.");')
  })
})

describe('Simple GCS #123: WHEP session DELETE result is never observed', () => {
  const PROBE_OFFER =
    'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n'
  const MAIN_OFFER =
    'v=0\r\no=- 4 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' +
    'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=ice-ufrag:Zz\r\na=ice-pwd:Yy\r\na=rtpmap:96 H264/90000\r\n' +
    'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n'

  it('calls fetch(DELETE) and never attaches then/catch/finally to its result', async () => {
    const requests: string[] = []
    const errors: string[] = []
    const deleteResultUse: string[] = []
    let pcs = 0
    class FakePc {
      readonly probe = pcs++ < 3
      addTransceiver() {}
      createDataChannel() {}
      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: this.probe ? PROBE_OFFER : MAIN_OFFER })
      }
      setLocalDescription() {
        return Promise.resolve()
      }
      // Probes: codec unsupported. Main connection: the answer is rejected, so #handleError runs.
      setRemoteDescription() {
        return Promise.reject(new Error(this.probe ? 'unsupported' : 'Failed to set remote answer sdp'))
      }
      close() {}
    }
    const response = (status: number, headers: Record<string, string>) => ({
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      text: () => Promise.resolve('v=0\r\nanswer\r\n')
    })
    const fetch = (url: string, init: { method: string }) => {
      requests.push(`${init.method} ${url}`)
      if (init.method === 'OPTIONS') return Promise.resolve(response(204, {}))
      if (init.method === 'POST') return Promise.resolve(response(201, { location: '/stream/whep/abc' }))
      // The DELETE result: records any attempt to observe it.
      return {
        then: () => void deleteResultUse.push('then'),
        catch: () => void deleteResultUse.push('catch'),
        finally: () => void deleteResultUse.push('finally')
      }
    }
    const window: Record<string, unknown> = { setTimeout: () => 1 }
    runInNewContext(upstreamSource('SimpleGCS/vendor/mediamtx/reader.js'), {
      window,
      RTCPeerConnection: FakePc,
      RTCSessionDescription: class {
        constructor(readonly init: unknown) {}
      },
      fetch,
      btoa,
      URL,
      clearTimeout: () => undefined
    })
    const Reader = window.MediaMTXWebRTCReader as new (c: unknown) => { close(): void }
    const reader = new Reader({ url: 'https://cam.example:8889/stream/whep', onError: (e: string) => errors.push(e) })
    for (let i = 0; i < 50; i++) await Promise.resolve()
    reader.close()
    expect(requests).toEqual([
      'OPTIONS https://cam.example:8889/stream/whep',
      'POST https://cam.example:8889/stream/whep',
      'DELETE https://cam.example:8889/stream/whep/abc'
    ])
    expect(errors).toEqual(['Error: Failed to set remote answer sdp, retrying in some seconds'])
    expect(deleteResultUse).toEqual([])
  })
})
