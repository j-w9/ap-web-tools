import { useCallback, useEffect, useRef, useState } from 'react'
import { DataflashLog } from '@apwt/dataflash'
import {
  ErrorBanner,
  Section,
  ToolPage,
  downloadBytes,
  downloadText,
  useLoading,
  useLogFile,
  type LogFact
} from '@apwt/tool-shell'
import { summariseLog } from './analysis/log-info.js'
import { formatPlayerTime, logTimeAtVideoTime, offsetTextFromSeconds, exportStatsText } from './analysis/sync.js'
import {
  DEFAULT_FRAME_RATE,
  EXPORT_UNSUPPORTED_MESSAGE,
  initialSelection,
  matchSelectionToInput,
  probeOutputFormats,
  selectFormat,
  type FormatSelection,
  type FrameRate
} from './analysis/export-formats.js'
import { STAGE_HEIGHT_FRACTION, STAGE_MAX_PX, stageSize } from './analysis/stage.js'
import { createExportCanvas, describeVideo, exportApisAvailable, mediabunnyBackend, probeCodecs } from './export/mediabunny.js'
import { exportRunning, exportSettings, IDLE, startExport, type ExportJob, type ExportState } from './export/pipeline.js'
import { readOverlayFile } from './widgets/layout-file.js'
import { OverlayController } from './widgets/overlay-controller.js'
import { configureFormio } from './widgets/formio-setup.js'
import { WidgetEditor } from './widgets/widget-editor.js'
import { useDialogs } from './ui/dialogs.js'
import { EditorOverlay, type EditorOverlayRefs } from './ui/EditorOverlay.js'
import { Player } from './ui/Player.js'
import { Rail, type ExportSupport } from './ui/Rail.js'
import { ExportProgress } from './ui/ExportProgress.js'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Facts about the video file, as upstream's video panel lists them. */
interface VideoFacts {
  resolution: string
  duration: string
  fps: string
  codec: string
}
const NO_VIDEO_FACTS: VideoFacts = { resolution: '', duration: '', fps: '', codec: '' }

interface LogFacts {
  date: string
  flightTime: string
  duration: string
}

export function App() {
  const { run } = useLoading()
  const { dialogs, view: dialogView } = useDialogs()

  // ----- Page elements the overlay libraries drive -----
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dashboardRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const editorRefs: EditorOverlayRefs = {
    overlay: useRef<HTMLDivElement>(null),
    testGrid: useRef<HTMLDivElement>(null),
    textEditor: useRef<HTMLDivElement>(null),
    formEditor: useRef<HTMLDivElement>(null),
    scriptTab: useRef<HTMLButtonElement>(null),
    formTab: useRef<HTMLButtonElement>(null),
    close: useRef<HTMLButtonElement>(null)
  }
  const controllerRef = useRef<OverlayController | null>(null)

  // ----- Video -----
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoFacts, setVideoFacts] = useState<VideoFacts | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [videoSize, setVideoSize] = useState({ width: Number.NaN, height: Number.NaN })

  // ----- Log and sync -----
  const [logFacts, setLogFacts] = useState<LogFacts | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [offsetText, setOffsetTextState] = useState('0')
  /** Read by the widgets' time callback, so it is current before React re-renders. */
  const offsetRef = useRef('0')

  // ----- Overlay grid -----
  const [gridRows, setGridRows] = useState('')
  const [gridColumns, setGridColumns] = useState('')

  // ----- Export -----
  const [support, setSupport] = useState<ExportSupport>(() =>
    exportApisAvailable()
      ? { status: 'probing' }
      : { status: 'unsupported', message: `${EXPORT_UNSUPPORTED_MESSAGE}: this browser lacks WebCodecs or OffscreenCanvas.` }
  )
  const [selection, setSelection] = useState<FormatSelection | null>(null)
  const [frameRate, setFrameRate] = useState<FrameRate>(DEFAULT_FRAME_RATE)
  const [exportWidth, setExportWidth] = useState(0)
  const [exportHeight, setExportHeight] = useState(0)
  const [startText, setStartText] = useState('0')
  const [endText, setEndText] = useState('0')
  const [exportState, setExportState] = useState<ExportState>(IDLE)
  const jobRef = useRef<ExportJob | null>(null)

  // ----- Stage size -----
  const [available, setAvailable] = useState({ width: STAGE_MAX_PX, height: window.innerHeight })
  const stage = stageSize(
    Math.min(STAGE_MAX_PX, available.width),
    Math.min(STAGE_MAX_PX, available.height * STAGE_HEIGHT_FRACTION),
    videoSize.width,
    videoSize.height
  )

  useEffect(() => {
    const wrap = stageWrapRef.current
    if (!wrap) return
    const update = () => setAvailable({ width: wrap.clientWidth, height: window.innerHeight })
    const observer = new ResizeObserver(update)
    observer.observe(wrap)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const videoTime = useCallback(() => videoRef.current?.currentTime ?? 0, [])

  // ----- Overlay grids, palette and widget editor (imperative libraries) -----
  useEffect(() => {
    const dashboard = dashboardRef.current
    const palette = paletteRef.current
    const e = editorRefs
    const overlay = e.overlay.current
    const testGrid = e.testGrid.current
    const textEditor = e.textEditor.current
    const formEditor = e.formEditor.current
    const scriptTab = e.scriptTab.current
    const formTab = e.formTab.current
    const close = e.close.current
    if (!dashboard || !palette || !overlay || !testGrid || !textEditor || !formEditor || !scriptTab || !formTab || !close) return

    configureFormio()
    const controller = new OverlayController({
      dialogs,
      dashboard,
      palette,
      videoTime,
      logTimeAt: (t) => logTimeAtVideoTime(t, offsetRef.current),
      onGridSize: ({ columns, rows }) => {
        setGridRows(String(rows))
        setGridColumns(String(columns))
      },
      download: downloadText
    })
    controllerRef.current = controller
    controller.loadDefaultLayout()
    controller.loadPalette()
    const editor = new WidgetEditor({ overlay, testGrid, textEditor, formEditor, scriptTab, formTab, close }, controller)
    controller.editor = editor

    const onUnload = (event: BeforeUnloadEvent) => {
      if (!controller.hasUnsavedChanges()) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      editor.dispose()
      controller.dispose()
      controllerRef.current = null
    }
    // The element refs are stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogs, videoTime])

  // ----- Export capability -----
  useEffect(() => {
    if (!exportApisAvailable()) return
    let live = true
    probeOutputFormats(probeCodecs).then(
      (formats) => {
        if (!live) return
        setSupport({ status: 'ready', formats })
        setSelection(initialSelection(formats))
      },
      (e: unknown) => live && setSupport({ status: 'unsupported', message: errorText(e) })
    )
    return () => {
      live = false
    }
  }, [])

  const setOffset = (text: string) => {
    offsetRef.current = text
    setOffsetTextState(text)
    void controllerRef.current?.setWidgetTime(videoTime())
  }

  // ----- Video input -----
  const openVideo = (file: File) => {
    setVideoFile(file)
    setVideoError(null)
    setVideoUrl((old) => {
      if (old !== null) URL.revokeObjectURL(old)
      return URL.createObjectURL(file)
    })
    void describeVideo(file).then(
      (info) => {
        if (info.audioCodec === undefined) {
          // Upstream fills in the frame rate, then fails reading the missing audio track's codec.
          setVideoFacts((old) => ({ ...(old ?? NO_VIDEO_FACTS), fps: info.fps }))
          setVideoError("Cannot read properties of null (reading 'codec')")
          return
        }
        setVideoFacts({
          fps: info.fps,
          codec: `${String(info.videoCodec)} + ${String(info.audioCodec)}`,
          resolution: `${info.displayWidth}x${info.displayHeight}px`,
          duration: formatPlayerTime(info.duration)
        })
        setStartText('0')
        setEndText(String(info.duration))
        setExportWidth(info.displayWidth)
        setExportHeight(info.displayHeight)
        const formats = support.status === 'ready' ? support.formats : []
        const matched = matchSelectionToInput(formats, { selection, frameRate }, { ...info, audioCodec: info.audioCodec })
        setSelection(matched.selection)
        setFrameRate(matched.frameRate)
        if (matched.error !== undefined) setVideoError(matched.error)
      },
      (e: unknown) => setVideoError(errorText(e))
    )
  }

  // ----- Log input -----
  const { openFile } = useLogFile(async (buffer) => {
    await run(() => {
      try {
        const log = DataflashLog.parse(buffer)
        const summary = summariseLog(log, buffer)
        setLogError(null)
        setLogFacts((old) => ({
          date: summary.date,
          flightTime: summary.flightTime,
          duration: summary.duration ?? old?.duration ?? ''
        }))
        offsetRef.current = offsetTextFromSeconds(summary.defaultOffsetS)
        setOffsetTextState(offsetRef.current)
        controllerRef.current?.setLog(buffer)
      } catch (e) {
        setLogError(errorText(e))
      }
    }, 'Reading log')
  })

  // ----- Overlay file -----
  const loadOverlay = (file: File) => {
    void file.text().then((text) => {
      const controller = controllerRef.current
      if (!controller) return
      try {
        const content = readOverlayFile(text)
        switch (content.kind) {
          case 'rejected':
            dialogs.alert(content.message)
            break
          case 'layout':
            controller.loadLayout(content.grid, content.widgets)
            break
          case 'widget':
            controller.loadWidgetFile(content.widget)
            break
        }
      } catch (e) {
        dialogs.alert(errorText(e))
      }
    })
  }

  // ----- Export -----
  const runExport = () => {
    const controller = controllerRef.current
    const overlay = overlayRef.current
    if (!controller || !overlay || selection === null) return
    if (videoFile === null) {
      setExportState({ status: 'failed', message: 'Load a video to export.' })
      return
    }
    const settings = exportSettings({ selection, frameRate, width: exportWidth, height: exportHeight, startText, endText })
    const overlayBox = overlay.getBoundingClientRect()
    const job = startExport(settings, {
      backend: mediabunnyBackend(videoFile),
      overlay: {
        setWidgetTime: (t) => controller.setWidgetTime(t),
        render: (context) => controller.renderOverlay(context, overlayBox)
      },
      createCanvas: createExportCanvas,
      now: () => performance.now(),
      onState: setExportState,
      download: (name, file) => downloadBytes(name, file.bytes, file.mimeType),
      warn: (message, detail) => console.warn(message, detail)
    })
    jobRef.current = job
    void job.done.then(() => {
      jobRef.current = null
      // Put the widgets back to the preview time.
      void controller.setWidgetTime(videoTime())
    })
  }

  const running = exportRunning(exportState)

  return (
    <ToolPage
      title="Video Overlay"
      intro="Synchronise ArduPilot DataFlash log telemetry with video footage and export a composited video with telemetry overlay. Load a .bin log file and video, arrange your widgets, set the sync offset, and export."
      rail={
        <Rail
          videoFacts={
            videoFacts && [
              { label: 'Resolution', value: videoFacts.resolution },
              { label: 'Duration', value: videoFacts.duration },
              { label: 'FPS', value: videoFacts.fps },
              { label: 'Codec', value: videoFacts.codec }
            ]
          }
          onVideoFile={openVideo}
          videoError={videoError}
          logFacts={
            logFacts &&
            ([
              { label: 'Date', value: logFacts.date },
              { label: 'Flight time', value: logFacts.flightTime },
              { label: 'Duration', value: logFacts.duration }
            ] satisfies LogFact[])
          }
          onLogFile={openFile}
          logError={logError}
          offsetText={offsetText}
          onOffsetText={setOffset}
          onLoadOverlay={loadOverlay}
          onSaveOverlay={() => controllerRef.current?.saveLayout()}
          gridRows={gridRows}
          gridColumns={gridColumns}
          onGridRows={setGridRows}
          onGridColumns={setGridColumns}
          onGridCommit={() => controllerRef.current?.setGridSize(gridRows, gridColumns)}
          support={support}
          selection={selection}
          onFormat={(option) => setSelection(selectFormat(option))}
          onSelection={setSelection}
          frameRate={frameRate}
          onFrameRate={setFrameRate}
          exportWidth={exportWidth}
          exportHeight={exportHeight}
          startText={startText}
          endText={endText}
          onStartText={setStartText}
          onEndText={setEndText}
          onExport={runExport}
          exportDisabled={running || selection === null}
          exportError={exportState.status === 'failed' ? exportState.message : null}
        />
      }
    >
      {dialogView}

      <Section title="Preview" help="Double-click a widget to edit it; drag to move, drag its corner to resize.">
        <div ref={stageWrapRef}>
          <Player
            videoRef={videoRef}
            overlayRef={overlayRef}
            dashboardRef={dashboardRef}
            videoUrl={videoUrl}
            stage={stage}
            frameRate={frameRate}
            startText={startText}
            endText={endText}
            onSetStart={(t) => setStartText(String(t))}
            onSetEnd={(t) => setEndText(String(t))}
            onTime={(t) => void controllerRef.current?.setWidgetTime(t)}
            onMetadata={() => {
              const v = videoRef.current
              if (v) setVideoSize({ width: v.videoWidth, height: v.videoHeight })
            }}
          />
        </div>
        {exportState.status === 'done' && (
          <p className="apwt-section__help">
            Saved {exportState.fileName} ({(exportState.bytes / 1e6).toFixed(1)} MB). {exportStatsText(exportState.stats)}
          </p>
        )}
        {exportState.status === 'cancelled' && <ErrorBanner message="Export cancelled." />}
      </Section>

      <Section title="Widgets" help="Drag a widget onto the video to add it. Hover for a description.">
        <div ref={paletteRef} className="vo-palette grid-stack" />
      </Section>

      <EditorOverlay {...editorRefs} />
      <ExportProgress state={exportState} onCancel={() => jobRef.current?.cancel()} />
    </ToolPage>
  )
}
