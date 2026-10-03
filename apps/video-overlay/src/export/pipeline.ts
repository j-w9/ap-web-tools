/**
 * Export pipeline, ported from upstream `exportVideo()`: a Mediabunny conversion of the loaded video
 * whose `process` callback, for each decoded frame, sets the widgets to the frame's log time, draws
 * the frame, draws the overlay on top and hands the canvas back to the encoder. The media library,
 * the canvas and the overlay are injected so the sequencing is testable without WebCodecs.
 */
import {
  exportFrameVideoTimeS,
  exportProgressFraction,
  exportProgressText,
  exportStats,
  type ExportStats
} from '../analysis/sync.js'
import type { FormatSelection, FrameRate, OutputFormatName } from '../analysis/export-formats.js'

/** Export state shown in the page. */
export type ExportState =
  | { readonly status: 'idle' }
  | { readonly status: 'preparing' }
  | { readonly status: 'encoding'; readonly progress: number; readonly progressText: string }
  | { readonly status: 'done'; readonly fileName: string; readonly bytes: number; readonly stats: ExportStats }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled' }

export const IDLE: ExportState = { status: 'idle' }

/** Whether an export is running (and can be cancelled). */
export function exportRunning(state: ExportState): state is Extract<ExportState, { status: 'preparing' | 'encoding' }> {
  return state.status === 'preparing' || state.status === 'encoding'
}

/** Settings read from the export inputs (upstream `exportSettings`, all via `parseFloat`). */
export interface ExportSettings {
  readonly fps: number
  readonly width: number
  readonly height: number
  /** Trim start and end, video seconds. */
  readonly start: number
  readonly end: number
  readonly format: OutputFormatName
  readonly videoCodec: string
  readonly audioCodec: string
}

/** Export inputs as typed (strings for the free-text number inputs, as upstream reads them). */
export interface ExportInputs {
  readonly selection: FormatSelection
  readonly frameRate: FrameRate
  readonly width: number
  readonly height: number
  readonly startText: string
  readonly endText: string
}

export function exportSettings(inputs: ExportInputs): ExportSettings {
  return {
    fps: parseFloat(inputs.frameRate),
    width: inputs.width,
    height: inputs.height,
    start: parseFloat(inputs.startText),
    end: parseFloat(inputs.endText),
    format: inputs.selection.format,
    videoCodec: inputs.selection.videoCodec,
    audioCodec: inputs.selection.audioCodec
  }
}

/** A decoded video frame (Mediabunny `VideoSample`, the part used here). */
export interface FrameSample<Context> {
  /** Seconds from the start of the trimmed output. */
  readonly timestamp: number
  draw(context: Context, dx: number, dy: number): void
}

/** A prepared conversion (Mediabunny `Conversion`). */
export interface ConversionHandle {
  readonly isValid: boolean
  readonly discardedTracks: readonly unknown[]
  execute(): Promise<void>
  cancel(): Promise<void>
}

/** The encoded result. */
export interface EncodedFile {
  readonly bytes: Uint8Array
  readonly mimeType: string
  /** Including the dot, e.g. ".mp4". */
  readonly fileExtension: string
}

/** The media library: builds the conversion with a per-frame callback. */
export interface ExportBackend<Context, Canvas> {
  createConversion(
    settings: ExportSettings,
    process: (sample: FrameSample<Context>) => Promise<Canvas>
  ): Promise<{ conversion: ConversionHandle; result: () => EncodedFile }>
  /** Whether an error is the library's "conversion cancelled". */
  isCancelError(error: unknown): boolean
}

/** The overlay as the exporter drives it. */
export interface ExportOverlay<Context> {
  /** Set every widget to the log time of this video time; resolves once all have rendered. */
  setWidgetTime(videoTimeS: number): Promise<unknown>
  /** Draw the widgets onto the frame. */
  render(context: Context): Promise<void>
}

export interface ExportDeps<Context, Canvas> {
  readonly backend: ExportBackend<Context, Canvas>
  readonly overlay: ExportOverlay<Context>
  /** The export canvas (upstream: an `OffscreenCanvas` with an opaque 2D context). */
  createCanvas(width: number, height: number): { canvas: Canvas; context: Context }
  /** Wall clock in milliseconds (upstream `performance.now()`). */
  now(): number
  /** Called with each new state. */
  onState(state: ExportState): void
  /** Offer the file for download. */
  download(fileName: string, file: EncodedFile): void
  /** Upstream logs discarded tracks with `console.warn` when the conversion is not valid. */
  warn(message: string, detail: unknown): void
}

/** A running export; `cancel()` stops it and ends in the `cancelled` state. */
export interface ExportJob {
  readonly done: Promise<ExportState>
  cancel(): void
}

/** Download name upstream uses: `VideoOverlay` plus the container's extension. */
export function exportFileName(fileExtension: string): string {
  return `VideoOverlay${fileExtension}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Start an export. */
export function startExport<Context, Canvas>(settings: ExportSettings, deps: ExportDeps<Context, Canvas>): ExportJob {
  let conversion: ConversionHandle | undefined
  let cancelled = false

  const set = (state: ExportState): ExportState => {
    deps.onState(state)
    return state
  }

  const run = async (): Promise<ExportState> => {
    set({ status: 'preparing' })
    const start = deps.now()
    const { canvas, context } = deps.createCanvas(settings.width, settings.height)

    const process = async (sample: FrameSample<Context>): Promise<Canvas> => {
      set({
        status: 'encoding',
        progress: exportProgressFraction(sample.timestamp, settings.start, settings.end),
        progressText: exportProgressText(sample.timestamp, settings.start, settings.end)
      })
      // Sample timestamps are relative to the export, so add the trim start back.
      await deps.overlay.setWidgetTime(exportFrameVideoTimeS(sample.timestamp, settings.start))
      sample.draw(context, 0, 0)
      await deps.overlay.render(context)
      return canvas
    }

    const created = await deps.backend.createConversion(settings, process)
    conversion = created.conversion
    if (cancelled) await conversion.cancel()
    if (!conversion.isValid) deps.warn('Discarded tracks:', conversion.discardedTracks)
    await conversion.execute()

    const file = created.result()
    const fileName = exportFileName(file.fileExtension)
    deps.download(fileName, file)
    const stats = exportStats((deps.now() - start) / 1000, settings.start, settings.end, settings.fps)
    return set({ status: 'done', fileName, bytes: file.bytes.byteLength, stats })
  }

  const done = run().catch((error: unknown) =>
    set(
      cancelled || deps.backend.isCancelError(error)
        ? { status: 'cancelled' }
        : { status: 'failed', message: errorMessage(error) }
    )
  )

  return {
    done,
    cancel: () => {
      cancelled = true
      void conversion?.cancel()
    }
  }
}
