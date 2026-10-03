import { useState, type RefObject } from 'react'
import { ChevronFirst, ChevronLast, Pause, Play, Rewind, FastForward, Volume2, VolumeX } from 'lucide-react'
import { formatPlayerTime, frameStepS, seekFraction, seekTime, SKIP_S, trimRangePercent } from '../analysis/sync.js'
import type { FrameRate } from '../analysis/export-formats.js'

/** Playback speeds upstream offers; 1× is selected initially. */
const RATES = ['0.25', '0.5', '1', '1.5', '2'] as const

export interface PlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>
  overlayRef: RefObject<HTMLDivElement | null>
  dashboardRef: RefObject<HTMLDivElement | null>
  videoUrl: string | null
  stage: { width: number; height: number }
  frameRate: FrameRate
  startText: string
  endText: string
  onSetStart: (time: number) => void
  onSetEnd: (time: number) => void
  /** Video time changed (playback or seek). */
  onTime: (time: number) => void
  onMetadata: () => void
}

/** The video with the overlay grid on top, and upstream's transport controls below. */
export function Player({ videoRef, overlayRef, dashboardRef, ...p }: PlayerProps) {
  const [paused, setPaused] = useState(true)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(Number.NaN)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState<string>('1')

  const video = () => videoRef.current
  const step = (delta: number) => {
    const v = video()
    if (v) v.currentTime += delta
  }
  const trim = trimRangePercent(p.startText, p.endText, duration)
  const muteGrey = 'rgb(var(--s4))'
  const highlight = 'var(--yellow)'
  const seekBackground = `linear-gradient(to right, ${muteGrey} 0%, ${muteGrey} ${trim.start}%, ${highlight} ${trim.start}%, ${highlight} ${trim.end}%, ${muteGrey} ${trim.end}%, ${muteGrey} 100%)`

  return (
    <>
      <div className="vo-stage-wrap">
        <div className="vo-stage" style={{ width: p.stage.width, height: p.stage.height }}>
          <video
            ref={videoRef}
            src={p.videoUrl ?? undefined}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onTimeUpdate={(e) => {
              setTime(e.currentTarget.currentTime)
              p.onTime(e.currentTarget.currentTime)
            }}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onLoadedMetadata={(e) => {
              setTime(e.currentTarget.currentTime)
              setDuration(e.currentTarget.duration)
              p.onMetadata()
            }}
            onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
          />
          <div ref={overlayRef} className="vo-overlay">
            <div ref={dashboardRef} className="grid-stack" />
          </div>
        </div>
      </div>

      <div className="vo-controls">
        <button type="button" className="apwt-icon-btn" title="Skip back 5 seconds" onClick={() => step(-SKIP_S)}>
          <Rewind />
        </button>
        <button type="button" className="apwt-icon-btn" title="Previous frame" onClick={() => step(-frameStepS(p.frameRate))}>
          <ChevronFirst />
        </button>
        <button
          type="button"
          className="apwt-icon-btn"
          title="Play / Pause"
          onClick={() => {
            const v = video()
            if (!v) return
            if (v.paused) void v.play()
            else v.pause()
          }}
        >
          {paused ? <Play /> : <Pause />}
        </button>
        <button type="button" className="apwt-icon-btn" title="Next frame" onClick={() => step(frameStepS(p.frameRate))}>
          <ChevronLast />
        </button>
        <button type="button" className="apwt-icon-btn" title="Skip forward 5 seconds" onClick={() => step(SKIP_S)}>
          <FastForward />
        </button>

        <span className="vo-time">
          {formatPlayerTime(time)} / {formatPlayerTime(duration || 1)}
        </span>
        <input
          type="range"
          className="vo-seek"
          aria-label="Seek"
          min={0}
          max={1}
          step={0.001}
          value={seekFraction(time, duration)}
          style={{ background: seekBackground }}
          onChange={(e) => {
            const v = video()
            if (v) v.currentTime = seekTime(Number(e.target.value), v.duration)
          }}
        />

        <button
          type="button"
          className="apwt-btn"
          title="Set start time to current time"
          onClick={() => p.onSetStart(video()?.currentTime ?? 0)}
        >
          Set start
        </button>
        <button
          type="button"
          className="apwt-btn"
          title="Set end time to current time"
          onClick={() => p.onSetEnd(video()?.currentTime ?? 0)}
        >
          Set end
        </button>

        <button
          type="button"
          className="apwt-icon-btn"
          title="Mute / Unmute"
          onClick={() => {
            const v = video()
            if (v) v.muted = !v.muted
          }}
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
        <input
          type="range"
          className="vo-volume"
          title="Volume"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => {
            const value = parseFloat(e.target.value)
            setVolume(value)
            const v = video()
            if (v) v.volume = value
          }}
        />
        <select
          className="vo-select"
          title="Playback speed"
          value={rate}
          onChange={(e) => {
            setRate(e.target.value)
            const v = video()
            if (v) v.playbackRate = parseFloat(e.target.value)
          }}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
