import { useEffect, useRef, useState } from 'react'
import { MediaMTXWebRTCReader } from '../video/mediamtx/reader.js'
import { isVideoConfigMessage, VIDEO_READY } from '../video/popup.js'
import { WebRtcPlayer, type VideoStatus } from '../video/webrtc-player.js'

/**
 * The separate video window (upstream `video.html` + `video-window.js`): receives the WebRTC
 * options only from the same-origin window that opened it.
 */
export function VideoWindow() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<VideoStatus>(() =>
    window.opener === null
      ? { text: 'Open video from the GCS video panel.', tone: 'error' }
      : { text: 'WebRTC · Connecting', tone: 'waiting' }
  )

  useEffect(() => {
    const parent: unknown = window.opener
    const video = videoRef.current
    if (parent === null || !(parent instanceof Object) || video === null) return
    let player: WebRtcPlayer | null = null
    const opener = window.opener as Window
    const receive = (event: MessageEvent): void => {
      if (event.source !== opener || event.origin !== location.origin || !isVideoConfigMessage(event.data)) return
      window.removeEventListener('message', receive)
      clearTimeout(timer)
      window.opener = null
      player = new WebRtcPlayer(video, setStatus, event.data.options, (conf) => new MediaMTXWebRTCReader(conf), window)
    }
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive)
      window.opener = null
      setStatus({ text: 'Unable to connect to the GCS video panel. Close this window and try again.', tone: 'error' })
    }, 30000)
    window.addEventListener('message', receive)
    opener.postMessage(VIDEO_READY, location.origin)
    return () => {
      window.removeEventListener('message', receive)
      clearTimeout(timer)
      player?.close()
    }
  }, [])

  return (
    <div className="gcs-video-window">
      <video ref={videoRef} autoPlay muted controls playsInline />
      <div className={`gcs-video__badge gcs-tone-${status.tone}`} role="status">
        {status.text}
      </div>
    </div>
  )
}
