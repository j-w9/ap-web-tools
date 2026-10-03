import { useEffect, useRef } from 'react'
import { useLatest } from '@apwt/tool-shell'
import { MediaMTXWebRTCReader } from '../video/mediamtx/reader.js'
import {
  chooseHlsPlayback,
  hlsAuthHeader,
  hlsUrl,
  MAX_HLS_RETRIES,
  webRtcOptions,
  type VideoConfig
} from '../video/video-config.js'
import { WebRtcPlayer, type VideoStatus } from '../video/webrtc-player.js'

export type VideoProtocol = 'webrtc' | 'hls'

export interface VideoSurfaceProps {
  readonly protocol: VideoProtocol
  readonly config: VideoConfig
  readonly onStatus: (status: VideoStatus) => void
  /** HLS cannot play here: switch to WebRTC (upstream `_useWebRTC()` from `_playStableHLS`). */
  readonly onFallback: () => void
}

/** Stops playback and releases the element (upstream `_cleanup`). */
function releaseVideo(video: HTMLVideoElement): void {
  video.pause()
  video.removeAttribute('src')
  video.load()
}

/**
 * One playback session (upstream `_useWebRTC` / `_useHLS`). Mounting starts it; unmounting is
 * upstream's `_cleanup`, so hiding or closing the panel stops playback and retries.
 */
export function VideoSurface({ protocol, config, onStatus, onFallback }: VideoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const callbacks = useLatest({ onStatus, onFallback })

  useEffect(() => {
    const video = videoRef.current
    if (video === null) return
    if (protocol === 'webrtc') {
      callbacks.current.onStatus({ text: 'WebRTC', tone: 'waiting' })
      const player = new WebRtcPlayer(
        video,
        (s) => callbacks.current.onStatus(s),
        webRtcOptions(config),
        (conf) => new MediaMTXWebRTCReader(conf),
        window
      )
      return () => {
        player.close()
        releaseVideo(video)
      }
    }

    callbacks.current.onStatus({ text: 'HLS', tone: 'hls' })
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let destroy: (() => void) | null = null
    const url = hlsUrl(config)
    const auth = hlsAuthHeader(config)
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return
      const playback = chooseHlsPlayback({
        pageIsHttps: location.protocol === 'https:',
        url,
        hasAuth: auth !== null,
        canPlayNative: video.canPlayType('application/vnd.apple.mpegurl') !== '',
        hlsJsSupported: Hls.isSupported()
      })
      if (playback === 'webrtc-fallback') {
        callbacks.current.onFallback()
        return
      }
      if (playback === 'native') {
        video.src = url
        video.play().catch(() => {})
        return
      }
      let retries = 0
      const play = (): void => {
        destroy?.()
        // Stable, non-aggressive settings: stability over latency.
        const hls = new Hls({
          autoStartLoad: true,
          startPosition: -1,
          lowLatencyMode: false,
          backBufferLength: 30,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          maxLiveSyncPlaybackRate: 1.0,
          maxBufferLength: 30,
          maxBufferSize: 100 * 1000 * 1000,
          maxBufferHole: 2,
          enableWorker: true,
          fragLoadingTimeOut: 20000,
          manifestLoadingTimeOut: 10000,
          levelLoadingTimeOut: 10000,
          xhrSetup: (xhr) => {
            if (auth !== null) xhr.setRequestHeader('Authorization', auth)
          }
        })
        let current = true
        destroy = () => {
          current = false
          hls.destroy()
        }
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!current || disposed || !data.fatal) return
          retries++
          if (retries >= MAX_HLS_RETRIES) {
            callbacks.current.onFallback()
          } else {
            clearTimeout(retryTimer)
            retryTimer = setTimeout(play, 2000)
          }
        })
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!current || disposed) return
          video.play().catch(() => {})
          retries = 0
        })
        hls.loadSource(url)
        hls.attachMedia(video)
      }
      play()
    })
    return () => {
      disposed = true
      clearTimeout(retryTimer)
      destroy?.()
      releaseVideo(video)
    }
  }, [protocol, config, callbacks])

  return <video ref={videoRef} className="gcs-video__media" autoPlay playsInline muted controls />
}
