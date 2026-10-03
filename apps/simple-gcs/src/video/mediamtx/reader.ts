/**
 * MediaMTX WebRTC/WHEP reader, ported to TypeScript from the copy SimpleGCS vendors unchanged
 * (`upstream/SimpleGCS/vendor/mediamtx/reader.js`, MediaMTX v1.21.0
 * `internal/servers/webrtc/reader.js`). MIT licensed, Copyright (c) 2019 aler9; see `LICENSE` in
 * this directory. There is no npm package of it. Behaviour, SDP edits, signalling requests and
 * retry timing are unchanged; only types were added and `window.MediaMTXWebRTCReader` became an
 * export.
 */

export interface ReaderConf {
  /** Absolute URL of the WHEP endpoint. */
  readonly url: string
  readonly user?: string
  readonly pass?: string
  readonly token?: string
  readonly onError?: (err: string) => void
  readonly onTrack?: (evt: RTCTrackEvent) => void
  readonly onDataChannel?: (evt: RTCDataChannelEvent) => void
}

type ReaderState = 'getting_codecs' | 'running' | 'restarting' | 'closed' | 'failed'

interface OfferData {
  iceUfrag: string
  icePwd: string
  medias: string[]
}

const errorText = (err: unknown): string => String(err)

export class MediaMTXWebRTCReader {
  static readonly #RETRY_PAUSE = 2000

  readonly #conf: ReaderConf
  #state: ReaderState = 'getting_codecs'
  #restartTimeout: ReturnType<typeof setTimeout> | null = null
  #pc: RTCPeerConnection | null = null
  #offerData: OfferData | null = null
  #sessionUrl: string | null = null
  #queuedCandidates: RTCIceCandidate[] = []
  #nonAdvertisedCodecs: string[] = []

  constructor(conf: ReaderConf) {
    this.#conf = conf
    this.#getNonAdvertisedCodecs()
  }

  /** Close the reader and all its resources. */
  close(): void {
    this.#state = 'closed'
    if (this.#pc !== null) this.#pc.close()
    if (this.#restartTimeout !== null) clearTimeout(this.#restartTimeout)
  }

  static #supportsNonAdvertisedCodec(codec: string, fmtp: string | undefined): Promise<boolean> {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [] })
      const mediaType = 'audio'
      let payloadType = ''

      pc.addTransceiver(mediaType, { direction: 'recvonly' })
      pc.createOffer()
        .then((offer) => {
          if (offer.sdp === undefined) throw new Error('SDP not present')
          if (offer.sdp.includes(` ${codec}`)) {
            // codec is advertised, there's no need to add it manually
            throw new Error('already present')
          }
          const sections = offer.sdp.split(`m=${mediaType}`)
          const payloadTypes = sections
            .slice(1)
            .map((s) => (s.split('\r\n')[0] ?? '').split(' ').slice(3))
            .reduce<string[]>((prev, cur) => [...prev, ...cur], [])
          payloadType = MediaMTXWebRTCReader.#reservePayloadType(payloadTypes)

          const lines = (sections[1] ?? '').split('\r\n')
          lines[0] = `${lines[0]!} ${payloadType}`
          lines.splice(lines.length - 1, 0, `a=rtpmap:${payloadType} ${codec}`)
          if (fmtp !== undefined) lines.splice(lines.length - 1, 0, `a=fmtp:${payloadType} ${fmtp}`)
          sections[1] = lines.join('\r\n')
          return pc.setLocalDescription({ type: offer.type, sdp: sections.join(`m=${mediaType}`) })
        })
        .then(() =>
          pc.setRemoteDescription(
            new RTCSessionDescription({
              type: 'answer',
              sdp:
                'v=0\r\n' +
                'o=- 6539324223450680508 0 IN IP4 0.0.0.0\r\n' +
                's=-\r\n' +
                't=0 0\r\n' +
                'a=fingerprint:sha-256 0D:9F:78:15:42:B5:4B:E6:E2:94:3E:5B:37:78:E1:4B:54:59:A3:36:3A:E5:05:EB:27:EE:8F:D2:2D:41:29:25\r\n' +
                `m=${mediaType} 9 UDP/TLS/RTP/SAVPF ${payloadType}\r\n` +
                'c=IN IP4 0.0.0.0\r\n' +
                'a=ice-pwd:7c3bf4770007e7432ee4ea4d697db675\r\n' +
                'a=ice-ufrag:29e036dc\r\n' +
                'a=sendonly\r\n' +
                'a=rtcp-mux\r\n' +
                `a=rtpmap:${payloadType} ${codec}\r\n` +
                (fmtp !== undefined ? `a=fmtp:${payloadType} ${fmtp}\r\n` : '')
            })
          )
        )
        .then(() => resolve(true))
        .catch(() => resolve(false))
        .finally(() => pc.close())
    })
  }

  static #unquoteCredential(v: string): string {
    return String(JSON.parse(`"${v}"`))
  }

  static #linkToIceServers(links: string | null): RTCIceServer[] {
    return links !== null
      ? links.split(', ').map((link) => {
          const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i)
          // Upstream dereferences the match unconditionally and throws for a malformed header.
          if (m === null) throw new TypeError("Cannot read properties of null (reading '1')")
          const ret: RTCIceServer & { credentialType?: string } = { urls: [m[1] ?? ''] }
          if (m[3] !== undefined) {
            ret.username = MediaMTXWebRTCReader.#unquoteCredential(m[3])
            ret.credential = MediaMTXWebRTCReader.#unquoteCredential(m[4] ?? '')
            ret.credentialType = 'password'
          }
          return ret
        })
      : []
  }

  static #parseOffer(sdp: string): OfferData {
    const ret: OfferData = { iceUfrag: '', icePwd: '', medias: [] }
    for (const line of sdp.split('\r\n')) {
      if (line.startsWith('m=')) ret.medias.push(line.slice('m='.length))
      else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) ret.iceUfrag = line.slice('a=ice-ufrag:'.length)
      else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) ret.icePwd = line.slice('a=ice-pwd:'.length)
    }
    return ret
  }

  static #reservePayloadType(payloadTypes: string[]): string {
    // everything is valid between 30 and 127, except for interval between 64 and 95
    // https://chromium.googlesource.com/external/webrtc/+/refs/heads/master/call/payload_type.h#29
    for (let i = 30; i <= 127; i++) {
      if ((i <= 63 || i >= 96) && !payloadTypes.includes(i.toString())) {
        const pl = i.toString()
        payloadTypes.push(pl)
        return pl
      }
    }
    throw Error('unable to find a free payload type')
  }

  /** Adds `a=rtpmap`/`a=fmtp`/`a=rtcp-fb` lines for each codec, reserving a payload type each. */
  static #addCodecs(payloadTypes: string[], section: string, codecs: readonly (readonly [string, string | undefined])[]): string {
    const lines = section.split('\r\n')
    for (const [rtpmap, fmtp] of codecs) {
      const payloadType = MediaMTXWebRTCReader.#reservePayloadType(payloadTypes)
      lines[0] = `${lines[0]!} ${payloadType}`
      lines.splice(lines.length - 1, 0, `a=rtpmap:${payloadType} ${rtpmap}`)
      if (fmtp !== undefined) lines.splice(lines.length - 1, 0, `a=fmtp:${payloadType} ${fmtp}`)
      lines.splice(lines.length - 1, 0, `a=rtcp-fb:${payloadType} transport-cc`)
    }
    return lines.join('\r\n')
  }

  static #enableStereoPcmau(payloadTypes: string[], section: string): string {
    return MediaMTXWebRTCReader.#addCodecs(payloadTypes, section, [
      ['PCMU/8000/2', undefined],
      ['PCMA/8000/2', undefined]
    ])
  }

  static #enableMultichannelOpus(payloadTypes: string[], section: string): string {
    return MediaMTXWebRTCReader.#addCodecs(payloadTypes, section, [
      ['multiopus/48000/3', 'channel_mapping=0,2,1;num_streams=2;coupled_streams=1'],
      ['multiopus/48000/4', 'channel_mapping=0,1,2,3;num_streams=2;coupled_streams=2'],
      ['multiopus/48000/5', 'channel_mapping=0,4,1,2,3;num_streams=3;coupled_streams=2'],
      ['multiopus/48000/6', 'channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2'],
      ['multiopus/48000/7', 'channel_mapping=0,4,1,2,3,5,6;num_streams=4;coupled_streams=4'],
      ['multiopus/48000/8', 'channel_mapping=0,6,1,4,5,2,3,7;num_streams=5;coupled_streams=4']
    ])
  }

  static #enableL16(payloadTypes: string[], section: string): string {
    return MediaMTXWebRTCReader.#addCodecs(payloadTypes, section, [
      ['L16/8000/2', undefined],
      ['L16/16000/2', undefined],
      ['L16/48000/2', undefined]
    ])
  }

  static #enableStereoOpus(section: string): string {
    let opusPayloadFormat = ''
    const lines = section.split('\r\n')
    for (const line of lines) {
      if (line.startsWith('a=rtpmap:') && line.toLowerCase().includes('opus/')) {
        opusPayloadFormat = line.slice('a=rtpmap:'.length).split(' ')[0] ?? ''
        break
      }
    }
    if (opusPayloadFormat === '') return section
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith(`a=fmtp:${opusPayloadFormat} `)) {
        if (!lines[i]!.includes('stereo')) lines[i] = `${lines[i]!};stereo=1`
        if (!lines[i]!.includes('sprop-stereo')) lines[i] = `${lines[i]!};sprop-stereo=1`
      }
    }
    return lines.join('\r\n')
  }

  /** The offer SDP with stereo and non-advertised audio codecs enabled (exposed for tests). */
  static editOffer(sdp: string, nonAdvertisedCodecs: readonly string[]): string {
    const sections = sdp.split('m=')
    const payloadTypes = sections
      .slice(1)
      .map((s) => (s.split('\r\n')[0] ?? '').split(' ').slice(3))
      .reduce<string[]>((prev, cur) => [...prev, ...cur], [])
    for (let i = 1; i < sections.length; i++) {
      if (sections[i]!.startsWith('audio')) {
        sections[i] = MediaMTXWebRTCReader.#enableStereoOpus(sections[i]!)
        if (nonAdvertisedCodecs.includes('pcma/8000/2'))
          sections[i] = MediaMTXWebRTCReader.#enableStereoPcmau(payloadTypes, sections[i]!)
        if (nonAdvertisedCodecs.includes('multiopus/48000/6')) {
          sections[i] = MediaMTXWebRTCReader.#enableMultichannelOpus(payloadTypes, sections[i]!)
        }
        if (nonAdvertisedCodecs.includes('L16/48000/2')) sections[i] = MediaMTXWebRTCReader.#enableL16(payloadTypes, sections[i]!)
        break
      }
    }
    return sections.join('m=')
  }

  static #generateSdpFragment(od: OfferData, candidates: readonly RTCIceCandidate[]): string {
    const candidatesByMedia = new Map<number | null, RTCIceCandidate[]>()
    for (const candidate of candidates) {
      const mid = candidate.sdpMLineIndex
      const list = candidatesByMedia.get(mid) ?? []
      list.push(candidate)
      candidatesByMedia.set(mid, list)
    }
    let frag = `a=ice-ufrag:${od.iceUfrag}\r\n` + `a=ice-pwd:${od.icePwd}\r\n`
    let mid = 0
    for (const media of od.medias) {
      const list = candidatesByMedia.get(mid)
      if (list !== undefined) {
        frag += `m=${media}\r\n` + `a=mid:${mid}\r\n`
        for (const candidate of list) frag += `a=${candidate.candidate}\r\n`
      }
      mid++
    }
    return frag
  }

  #handleError(err: string): void {
    if (this.#state === 'running') {
      if (this.#pc !== null) {
        this.#pc.close()
        this.#pc = null
      }
      this.#offerData = null
      if (this.#sessionUrl !== null) {
        void fetch(this.#sessionUrl, { method: 'DELETE' })
        this.#sessionUrl = null
      }
      this.#queuedCandidates = []
      this.#state = 'restarting'
      this.#restartTimeout = setTimeout(() => this.#restart(), MediaMTXWebRTCReader.#RETRY_PAUSE)
      this.#conf.onError?.(`${err}, retrying in some seconds`)
    } else if (this.#state === 'getting_codecs') {
      this.#state = 'failed'
      this.#conf.onError?.(err)
    }
  }

  #restart(): void {
    this.#restartTimeout = null
    this.#state = 'running'
    this.#start()
  }

  #getNonAdvertisedCodecs(): void {
    const candidates: readonly (readonly [string, string | undefined])[] = [
      ['pcma/8000/2', undefined],
      ['multiopus/48000/6', 'channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2'],
      ['L16/48000/2', undefined]
    ]
    Promise.all(
      candidates.map(([codec, fmtp]) =>
        MediaMTXWebRTCReader.#supportsNonAdvertisedCodec(codec, fmtp).then((r) => (r ? codec : false))
      )
    )
      .then((c) => c.filter((e): e is string => e !== false))
      .then((codecs) => {
        // `close()` may have run while codecs were probed.
        if (this.#state !== 'getting_codecs') throw new Error('closed')
        this.#nonAdvertisedCodecs = codecs
        this.#state = 'running'
        this.#start()
      })
      .catch((err: unknown) => this.#handleError(errorText(err)))
  }

  #start(): void {
    this.#requestICEServers()
      .then((iceServers) => this.#setupPeerConnection(iceServers))
      .then((offer) => this.#sendOffer(offer))
      .then((answer) => this.#setAnswer(answer))
      .catch((err: unknown) => this.#handleError(errorText(err)))
  }

  #authHeader(): Record<string, string> {
    if (this.#conf.user !== undefined && this.#conf.user !== '') {
      return { Authorization: `Basic ${btoa(`${this.#conf.user}:${this.#conf.pass ?? 'undefined'}`)}` }
    }
    if (this.#conf.token !== undefined && this.#conf.token !== '') return { Authorization: `Bearer ${this.#conf.token}` }
    return {}
  }

  #requestICEServers(): Promise<RTCIceServer[]> {
    return fetch(this.#conf.url, { method: 'OPTIONS', headers: this.#authHeader() }).then((res) =>
      MediaMTXWebRTCReader.#linkToIceServers(res.headers.get('Link'))
    )
  }

  #setupPeerConnection(iceServers: RTCIceServer[]): Promise<string> {
    if (this.#state !== 'running') throw new Error('closed')
    // `sdpSemantics` is a legacy Chrome option the original still passes.
    const config: RTCConfiguration & { sdpSemantics: string } = { iceServers, sdpSemantics: 'unified-plan' }
    const pc = new RTCPeerConnection(config)
    this.#pc = pc
    const direction = 'recvonly'
    pc.addTransceiver('video', { direction })
    pc.addTransceiver('audio', { direction })
    // using data channels requires creating a data channel locally
    pc.createDataChannel('')
    pc.onicecandidate = (evt) => this.#onLocalCandidate(evt)
    pc.onconnectionstatechange = () => this.#onConnectionState()
    pc.ontrack = (evt) => this.#onTrack(evt)
    pc.ondatachannel = (evt) => this.#onDataChannel(evt)
    return pc.createOffer().then((offer) => {
      const sdp = MediaMTXWebRTCReader.editOffer(offer.sdp ?? '', this.#nonAdvertisedCodecs)
      this.#offerData = MediaMTXWebRTCReader.#parseOffer(sdp)
      return pc.setLocalDescription({ type: offer.type, sdp }).then(() => sdp)
    })
  }

  #sendOffer(offer: string): Promise<string> {
    if (this.#state !== 'running') throw new Error('closed')
    return fetch(this.#conf.url, {
      method: 'POST',
      headers: { ...this.#authHeader(), 'Content-Type': 'application/sdp' },
      body: offer
    }).then(async (res) => {
      switch (res.status) {
        case 201:
          break
        case 404:
          throw new Error('stream not found')
        case 400: {
          const e = (await res.json()) as { error?: unknown }
          // Upstream's `new Error(e.error)`: the value is converted as `Error` converts it
          // (undefined gives an empty message).
          throw new Error(...([e.error] as [string?]))
        }
        default:
          throw new Error(`bad status code ${res.status}`)
      }
      this.#sessionUrl = new URL(res.headers.get('location') ?? 'null', this.#conf.url).toString()
      return res.text()
    })
  }

  #setAnswer(answer: string): Promise<void> {
    if (this.#state !== 'running' || this.#pc === null) throw new Error('closed')
    return this.#pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer })).then(() => {
      if (this.#state !== 'running') return
      if (this.#queuedCandidates.length !== 0) {
        this.#sendLocalCandidates(this.#queuedCandidates)
        this.#queuedCandidates = []
      }
    })
  }

  #onLocalCandidate(evt: RTCPeerConnectionIceEvent): void {
    if (this.#state !== 'running') return
    if (evt.candidate !== null) {
      if (this.#sessionUrl === null) this.#queuedCandidates.push(evt.candidate)
      else this.#sendLocalCandidates([evt.candidate])
    }
  }

  #sendLocalCandidates(candidates: readonly RTCIceCandidate[]): void {
    if (this.#sessionUrl === null || this.#offerData === null) return
    fetch(this.#sessionUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*' },
      body: MediaMTXWebRTCReader.#generateSdpFragment(this.#offerData, candidates)
    })
      .then((res) => {
        switch (res.status) {
          case 204:
            break
          case 404:
            throw new Error('stream not found')
          default:
            throw new Error(`bad status code ${res.status}`)
        }
      })
      .catch((err: unknown) => this.#handleError(errorText(err)))
  }

  #onConnectionState(): void {
    if (this.#state !== 'running' || this.#pc === null) return
    // "closed" can arrive before "failed" and without the close() method being called at all.
    // It happens when the other peer sends a termination message like a DTLS CloseNotify.
    if (this.#pc.connectionState === 'failed' || this.#pc.connectionState === 'closed')
      this.#handleError('peer connection closed')
  }

  #onTrack(evt: RTCTrackEvent): void {
    this.#conf.onTrack?.(evt)
  }

  #onDataChannel(evt: RTCDataChannelEvent): void {
    this.#conf.onDataChannel?.(evt)
  }
}
