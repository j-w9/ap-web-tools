import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { X } from 'lucide-react'
import type { VideoConfig, VideoSettingsAnswers } from '../video/video-config.js'
import type { VideoStatus } from '../video/webrtc-player.js'
import { VideoSurface, type VideoProtocol } from './VideoSurface.js'

export interface VideoPanelProps {
  /** Hidden panels keep their place but stop playback (upstream `hide`). */
  readonly hidden: boolean
  readonly protocol: VideoProtocol
  readonly config: VideoConfig
  readonly onProtocol: (protocol: VideoProtocol) => void
  readonly onNewWindow: () => void
  readonly onSettings: (answers: VideoSettingsAnswers) => void
  readonly onClose: () => void
}

interface Geometry {
  readonly left: number | null
  readonly top: number | null
  readonly width: number
  readonly height: number
}

const isMobile = (): boolean =>
  window.matchMedia('(max-width: 600px)').matches ||
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

/** Default size: 420x240, or up to 380 px wide at 16:9 on phones (upstream `open`). */
function defaultGeometry(mapWidth: number): Geometry {
  if (isMobile()) {
    const width = Math.min(mapWidth - 24, 380)
    return { left: null, top: null, width, height: Math.round((width * 9) / 16) }
  }
  return { left: null, top: null, width: 420, height: 240 }
}

interface Drag {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** The inset video panel over the map (upstream `SimpleGCS/video.js`, `VideoPanel`). */
export function VideoPanel({ hidden, protocol, config, onProtocol, onNewWindow, onSettings, onClose }: VideoPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<Geometry>(() =>
    defaultGeometry(document.querySelector('.gcs-map-wrap')?.clientWidth ?? window.innerWidth)
  )
  const [status, setStatus] = useState<VideoStatus>({ text: protocol === 'webrtc' ? 'WebRTC' : 'HLS', tone: 'waiting' })
  const [editing, setEditing] = useState<VideoSettingsAnswers | null>(null)
  const drag = useRef<Drag | null>(null)

  // Re-anchor after rotation or switching to a narrow viewport.
  useEffect(() => {
    const onResize = (): void => {
      if (!isMobile()) return
      setGeometry(defaultGeometry(panelRef.current?.parentElement?.clientWidth ?? window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  const start = (event: ReactPointerEvent<HTMLElement>): void => {
    const panel = panelRef.current
    if (
      panel === null ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button, input, form') !== null)
    )
      return
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: panel.offsetLeft,
      top: panel.offsetTop,
      width: panel.offsetWidth,
      height: panel.offsetHeight
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.pointerType !== 'touch') event.preventDefault()
  }
  const end = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerId !== drag.current?.id) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  /** Moves the panel by the bar (clamped to the map) or resizes it by the grip. */
  const dragMove = (event: ReactPointerEvent<HTMLElement>, kind: 'bar' | 'grip'): void => {
    const d = drag.current
    if (d === null || event.pointerId !== d.id) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (kind === 'grip') {
      setGeometry({ left: d.left, top: d.top, width: Math.max(280, d.width + dx), height: Math.max(160, d.height + dy) })
      return
    }
    const parent = panelRef.current?.parentElement
    const w = parent?.clientWidth ?? window.innerWidth
    const h = parent?.clientHeight ?? window.innerHeight
    setGeometry({
      left: Math.max(0, Math.min(w - 80, d.left + dx)),
      top: Math.max(0, Math.min(h - 36, d.top + dy)),
      width: d.width,
      height: d.height
    })
  }

  const fallback = useCallback(() => onProtocol('webrtc'), [onProtocol])
  // Keep video controls and gestures from panning the map behind it.
  const stop = (e: { stopPropagation(): void }): void => e.stopPropagation()

  return (
    <div
      id="video-panel"
      ref={panelRef}
      className="gcs-video"
      hidden={hidden}
      style={{
        width: geometry.width,
        height: geometry.height,
        ...(geometry.left !== null && geometry.top !== null
          ? { left: geometry.left, top: geometry.top }
          : { right: 12, bottom: 12 })
      }}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onWheel={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      <div
        className="gcs-video__bar"
        style={{ touchAction: 'none' }}
        onPointerDown={start}
        onPointerMove={(e) => dragMove(e, 'bar')}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <span className="gcs-video__title">Video</span>
        <button type="button" className="gcs-video__btn" onClick={() => onProtocol(protocol === 'webrtc' ? 'hls' : 'webrtc')}>
          {protocol === 'webrtc' ? 'Switch to HLS' : 'Switch to WebRTC'}
        </button>
        <button type="button" className="gcs-video__btn" onClick={onNewWindow}>
          New window
        </button>
        <button
          type="button"
          className="gcs-video__btn"
          onClick={() => setEditing({ host: config.host, path: config.path, user: config.user, pass: config.pass })}
        >
          Settings
        </button>
        <button type="button" className="gcs-video__btn" aria-label="Close video" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="gcs-video__body">
        {!hidden && <VideoSurface protocol={protocol} config={config} onStatus={setStatus} onFallback={fallback} />}
        <span className={`gcs-video__badge gcs-tone-${status.tone}`} role="status">
          {status.text}
        </span>
        {editing !== null && (
          <form
            className="gcs-video__settings"
            onSubmit={(e) => {
              e.preventDefault()
              onSettings(editing)
              setEditing(null)
            }}
          >
            {(
              [
                ['host', 'MediaMTX host', 'text'],
                ['path', 'Path', 'text'],
                ['user', 'Viewer username', 'text'],
                ['pass', 'Viewer password', 'password']
              ] as const
            ).map(([key, label, type]) => (
              <label key={key} className="apwt-field">
                <span className="apwt-label">{label}</span>
                <input
                  type={type}
                  value={editing[key] ?? ''}
                  onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                />
              </label>
            ))}
            <div className="gcs-row">
              <button type="submit" className="apwt-btn apwt-btn--primary">
                Save
              </button>
              <button type="button" className="apwt-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        <div
          className="gcs-video__grip"
          style={{ touchAction: 'none' }}
          onPointerDown={start}
          onPointerMove={(e) => dragMove(e, 'grip')}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        />
      </div>
    </div>
  )
}
