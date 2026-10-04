/**
 * Mediabunny glue (upstream loads `mediabunny@1.40.1` from unpkg; this uses the npm package at the
 * same version): codec probing, input video description and the export conversion.
 */
import {
  ALL_FORMATS,
  AUDIO_CODECS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  VIDEO_CODECS,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
  type VideoSample
} from 'mediabunny'
import type { CodecProbe, OutputFormatName } from '../analysis/export-formats.js'
import type { ExportBackend, ExportSettings, FrameSample } from './pipeline.js'

function outputFormat(name: OutputFormatName): Mp4OutputFormat | WebMOutputFormat | MkvOutputFormat | MovOutputFormat {
  switch (name) {
    case 'mp4':
      return new Mp4OutputFormat()
    case 'webm':
      return new WebMOutputFormat()
    case 'mkv':
      return new MkvOutputFormat()
    case 'mov':
      return new MovOutputFormat()
  }
}

const isVideoCodec = (codec: string): codec is VideoCodec => VIDEO_CODECS.some((c) => c === codec)
const isAudioCodec = (codec: string): codec is AudioCodec => AUDIO_CODECS.some((c) => c === codec)

/** Whether this browser has the APIs export needs (WebCodecs encoders and `OffscreenCanvas`). */
export function exportApisAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
}

/** Encodable codecs of a container (upstream `loadCodecs`). */
export const probeCodecs: CodecProbe = async (name) => {
  const codecs = outputFormat(name).getSupportedCodecs()
  const video = await getEncodableVideoCodecs(codecs.filter(isVideoCodec))
  const audio = await getEncodableAudioCodecs(codecs.filter(isAudioCodec))
  return { video, audio }
}

/** What upstream reads from a chosen video file. */
export interface VideoFileInfo {
  readonly formatName: string
  readonly fps: string
  readonly videoCodec: string | null
  /** `undefined` when the file has no audio track (upstream threw reading its codec; proven bug #120, fixed). */
  readonly audioCodec: string | null | undefined
  readonly displayWidth: number
  readonly displayHeight: number
  /** Seconds. */
  readonly duration: number
}

/** Describe a video file (upstream `vid-upload` change handler). */
export async function describeVideo(file: File): Promise<VideoFileInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const videoTrack = await input.getPrimaryVideoTrack()
  const audioTrack = await input.getPrimaryAudioTrack()
  if (videoTrack === null) throw new TypeError("Cannot read properties of null (reading 'computePacketStats')")
  const stats = await videoTrack.computePacketStats()
  const format = await input.getFormat()
  const duration = await input.computeDuration()
  return {
    formatName: format.name,
    fps: stats.averagePacketRate.toFixed(2),
    videoCodec: videoTrack.codec,
    audioCodec: audioTrack === null ? undefined : audioTrack.codec,
    displayWidth: videoTrack.displayWidth,
    displayHeight: videoTrack.displayHeight,
    duration
  }
}

type Context2D = OffscreenCanvasRenderingContext2D

/** The export backend for a video file. */
export function mediabunnyBackend(file: File): ExportBackend<Context2D, OffscreenCanvas> {
  return {
    async createConversion(settings: ExportSettings, process: (sample: FrameSample<Context2D>) => Promise<OffscreenCanvas>) {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
      const target = new BufferTarget()
      const format = outputFormat(settings.format)
      const output = new Output({ format, target })
      if (!isVideoCodec(settings.videoCodec) || !isAudioCodec(settings.audioCodec)) throw new Error('Unknown codec')
      const conversion = await Conversion.init({
        input,
        output,
        video: {
          codec: settings.videoCodec,
          frameRate: settings.fps,
          bitrate: QUALITY_VERY_HIGH,
          process: (sample: VideoSample) => process(sample),
          processedWidth: settings.width,
          processedHeight: settings.height
        },
        audio: { codec: settings.audioCodec },
        trim: { start: settings.start, end: settings.end }
      })
      return {
        conversion,
        result: () => {
          const buffer = target.buffer
          if (buffer === null) throw new Error('The export produced no data')
          return { bytes: new Uint8Array(buffer), mimeType: format.mimeType, fileExtension: format.fileExtension }
        }
      }
    },
    isCancelError: (error) => error instanceof ConversionCanceledError
  }
}

/** The export canvas: opaque 2D, as upstream (`getContext('2d', { alpha: false })`). */
export function createExportCanvas(width: number, height: number): { canvas: OffscreenCanvas; context: Context2D } {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { alpha: false })
  if (context === null) throw new Error('This browser cannot draw on an OffscreenCanvas')
  return { canvas, context }
}
