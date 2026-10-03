import { Clapperboard, FolderOpen, Save } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { ControlGroup, ErrorBanner, LogInput, RadioChips, RailCard, type LogFact } from '@apwt/tool-shell'
import {
  codecLocked,
  FRAME_RATES,
  type FormatSelection,
  type FrameRate,
  type OutputFormatOption
} from '../analysis/export-formats.js'

/** Export capability, probed once at start-up. */
export type ExportSupport =
  | { readonly status: 'probing' }
  | { readonly status: 'ready'; readonly formats: readonly OutputFormatOption[] }
  | { readonly status: 'unsupported'; readonly message: string }

export interface RailProps {
  videoFacts: readonly LogFact[] | null
  onVideoFile: (file: File) => void
  videoError: string | null

  logFacts: readonly LogFact[] | null
  onLogFile: (file: File) => void
  logError: string | null
  offsetText: string
  /** The offset as typed (widgets read it at their next time update, as upstream read the input). */
  onOffsetText: (text: string) => void
  /** The offset input's `change` event: widgets are moved to the current time. */
  onOffsetCommit: (text: string) => void

  onLoadOverlay: (file: File) => void
  onSaveOverlay: () => void
  gridRows: string
  gridColumns: string
  onGridRows: (text: string) => void
  onGridColumns: (text: string) => void
  /** The rows or columns input's `change` event (upstream `gridSizeUpdate`). */
  onGridCommit: (rows: string, columns: string) => void

  support: ExportSupport
  selection: FormatSelection | null
  onFormat: (option: OutputFormatOption) => void
  onSelection: (selection: FormatSelection) => void
  frameRate: FrameRate
  onFrameRate: (rate: FrameRate) => void
  exportWidth: number
  exportHeight: number
  startText: string
  endText: string
  onStartText: (text: string) => void
  onEndText: (text: string) => void
  onExport: () => void
  exportDisabled: boolean
  exportError: string | null
}

/**
 * A number input that reports its text as typed and, separately, the native `change` event
 * (commit: Enter, blur or a spinner step), which is when upstream acted on these inputs.
 */
function CommitInput(props: {
  readonly value: string
  readonly step?: number
  readonly onText: (text: string) => void
  readonly onCommit: (text: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const commit = useRef(props.onCommit)
  useLayoutEffect(() => {
    commit.current = props.onCommit
  })
  useLayoutEffect(() => {
    const el = input.current
    if (el === null) return
    const onChange = () => commit.current(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  return <input ref={input} type="number" step={props.step} value={props.value} onChange={(e) => props.onText(e.target.value)} />
}

/** The control rail: video, log and sync offset, overlay file and grid size, export settings. */
export function Rail(p: RailProps) {
  const overlayInput = useRef<HTMLInputElement>(null)
  const formats = p.support.status === 'ready' ? p.support.formats : []
  const format = formats.find((f) => f.name === p.selection?.format)
  const selection = p.selection

  return (
    <RailCard>
      <ControlGroup label="Video">
        <LogInput
          facts={p.videoFacts}
          onFile={p.onVideoFile}
          accept="video/*"
          title="Open a video"
          hint="The flight footage to overlay"
          changeLabel="Open another video"
        />
        <ErrorBanner message={p.videoError} />
      </ControlGroup>

      <ControlGroup label="Log">
        <LogInput facts={p.logFacts} onFile={p.onLogFile} hint="Any ArduPilot DataFlash log" />
        <ErrorBanner message={p.logError} />
        <label
          className="apwt-field"
          title="Offset of the log relative to the video. This relative to the boot time, when the log is first loaded this is set such that the timestamp of the first item in the log coincides with the start of the video. Increasing the value advances the log relative the video, decreasing the value advances the video relative to the log."
        >
          <span>Log offset (s)</span>
          <CommitInput step={0.01} value={p.offsetText} onText={p.onOffsetText} onCommit={p.onOffsetCommit} />
        </label>
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          Increase to advance the log relative to the video.
        </p>
      </ControlGroup>

      <ControlGroup label="Overlay">
        <div className="vo-btn-row">
          <button type="button" className="apwt-btn" onClick={() => overlayInput.current?.click()}>
            <FolderOpen />
            Load
          </button>
          <button type="button" className="apwt-btn" onClick={p.onSaveOverlay}>
            <Save />
            Save
          </button>
        </div>
        <input
          ref={overlayInput}
          type="file"
          accept=".json"
          className="apwt-sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) p.onLoadOverlay(f)
            e.target.value = ''
          }}
        />
        <label className="apwt-field">
          <span>Rows</span>
          <CommitInput value={p.gridRows} onText={p.onGridRows} onCommit={(rows) => p.onGridCommit(rows, p.gridColumns)} />
        </label>
        <label className="apwt-field">
          <span>Columns</span>
          <CommitInput
            value={p.gridColumns}
            onText={p.onGridColumns}
            onCommit={(columns) => p.onGridCommit(p.gridRows, columns)}
          />
        </label>
      </ControlGroup>

      <ControlGroup label="Export">
        {p.support.status === 'probing' && <p className="apwt-section__help">Checking which formats this browser can encode…</p>}
        {p.support.status === 'unsupported' && <ErrorBanner message={p.support.message} />}
        {selection && format && (
          <>
            <span className="apwt-label">Format</span>
            <RadioChips
              name="format"
              options={formats.map((f) => ({ value: f.name, label: f.name }))}
              value={selection.format}
              onChange={(name) => {
                const option = formats.find((f) => f.name === name)
                if (option) p.onFormat(option)
              }}
            />
            <span className="apwt-label">Video codec</span>
            <RadioChips
              name="video-codec"
              options={format.video.map((c) => ({ value: c, label: c, disabled: codecLocked(format.video) }))}
              value={selection.videoCodec}
              onChange={(videoCodec) => p.onSelection({ ...selection, videoCodec })}
            />
            <span className="apwt-label">Audio codec</span>
            <RadioChips
              name="audio-codec"
              options={format.audio.map((c) => ({ value: c, label: c, disabled: codecLocked(format.audio) }))}
              value={selection.audioCodec}
              onChange={(audioCodec) => p.onSelection({ ...selection, audioCodec })}
            />
          </>
        )}
        <label className="apwt-field">
          <span>FPS</span>
          <select
            value={p.frameRate}
            onChange={(e) => {
              const frameRate = FRAME_RATES.find((r) => r === e.target.value)
              if (frameRate) p.onFrameRate(frameRate)
            }}
          >
            {FRAME_RATES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="apwt-field">
          <span>Width (px)</span>
          <input type="number" value={p.exportWidth} disabled />
        </label>
        <label className="apwt-field">
          <span>Height (px)</span>
          <input type="number" value={p.exportHeight} disabled />
        </label>
        <label className="apwt-field">
          <span>Start time (s)</span>
          <input type="number" step={0.01} value={p.startText} onChange={(e) => p.onStartText(e.target.value)} />
        </label>
        <label className="apwt-field">
          <span>End time (s)</span>
          <input type="number" step={0.01} value={p.endText} onChange={(e) => p.onEndText(e.target.value)} />
        </label>
        <ErrorBanner message={p.exportError} />
      </ControlGroup>

      <div className="apwt-group">
        <button
          type="button"
          className="apwt-btn apwt-btn--primary apwt-btn--block"
          disabled={p.exportDisabled}
          onClick={p.onExport}
        >
          <Clapperboard />
          Export
        </button>
      </div>
    </RailCard>
  )
}
