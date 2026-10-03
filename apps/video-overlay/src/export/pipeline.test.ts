import { describe, expect, it } from 'vitest'
import {
  exportFileName,
  exportRunning,
  exportSettings,
  startExport,
  type ExportBackend,
  type ExportDeps,
  type ExportSettings,
  type ExportState,
  type FrameSample
} from './pipeline.js'

const SETTINGS: ExportSettings = {
  fps: 30,
  width: 640,
  height: 360,
  start: 10,
  end: 12,
  format: 'mp4',
  videoCodec: 'avc',
  audioCodec: 'aac'
}

class CancelError extends Error {}

/** Fake Mediabunny: calls `process` for each timestamp when executed, honouring cancel. */
function fakeBackend(opts: {
  timestamps: number[]
  valid?: boolean
  failAt?: number
  cancelAt?: number
  hooks?: { cancel?: () => void }
}) {
  const log: string[] = []
  const backend: ExportBackend<string[], string> = {
    createConversion(settings, process) {
      log.push(
        `init ${settings.format}/${settings.videoCodec}/${settings.audioCodec} ${settings.width}x${settings.height} trim ${settings.start}-${settings.end} @${settings.fps}`
      )
      let cancelled = false
      const conversion = {
        isValid: opts.valid ?? true,
        discardedTracks: opts.valid === false ? ['audio: unsupported'] : [],
        execute: async () => {
          if (opts.valid === false) throw new Error('Cannot execute this conversion')
          for (const t of opts.timestamps) {
            if (t === opts.cancelAt) opts.hooks?.cancel?.()
            if (cancelled) throw new CancelError('cancelled')
            if (t === opts.failAt) throw new Error('encoder exploded')
            const sample: FrameSample<string[]> = { timestamp: t, draw: (ctx) => ctx.push(`frame ${t}`) }
            log.push(`encode ${await process(sample)}`)
          }
        },
        cancel: () => {
          cancelled = true
          return Promise.resolve()
        }
      }
      return Promise.resolve({
        conversion,
        result: () => ({ bytes: new Uint8Array(1234), mimeType: 'video/mp4', fileExtension: '.mp4' })
      })
    },
    isCancelError: (e) => e instanceof CancelError
  }
  return { backend, log }
}

function deps(backend: ExportBackend<string[], string>, log: string[]) {
  const states: ExportState[] = []
  const downloads: string[] = []
  const warnings: unknown[] = []
  let clock = 1000
  const context: string[] = []
  const d: ExportDeps<string[], string> = {
    backend,
    overlay: {
      setWidgetTime: (t) => {
        context.push(`widgets ${t}`)
        return Promise.resolve()
      },
      render: (ctx) => {
        ctx.push('overlay')
        return Promise.resolve()
      }
    },
    createCanvas: (w, h) => {
      log.push(`canvas ${w}x${h}`)
      return { canvas: 'canvas', context }
    },
    now: () => (clock += 500),
    onState: (s) => states.push(s),
    download: (name, file) => downloads.push(`${name} ${file.mimeType} ${file.bytes.byteLength}`),
    warn: (message, detail) => warnings.push([message, detail])
  }
  return { d, states, downloads, warnings, context }
}

describe('export pipeline', () => {
  it('sets widget time, draws the frame, then the overlay, for every frame, then downloads', async () => {
    const { backend, log } = fakeBackend({ timestamps: [0, 1, 1.5] })
    const { d, states, downloads, context } = deps(backend, log)
    const final = await startExport(SETTINGS, d).done

    expect(log).toEqual([
      'canvas 640x360',
      'init mp4/avc/aac 640x360 trim 10-12 @30',
      'encode canvas',
      'encode canvas',
      'encode canvas'
    ])
    expect(context).toEqual([
      'widgets 10',
      'frame 0',
      'overlay',
      'widgets 11',
      'frame 1',
      'overlay',
      'widgets 11.5',
      'frame 1.5',
      'overlay'
    ])
    expect(states.map((s) => s.status)).toEqual(['preparing', 'encoding', 'encoding', 'encoding', 'done'])
    expect(states[3]).toEqual({ status: 'encoding', progress: 0.75, progressText: '75.00%' })
    expect(downloads).toEqual(['VideoOverlay.mp4 video/mp4 1234'])
    expect(final).toEqual({
      status: 'done',
      fileName: 'VideoOverlay.mp4',
      bytes: 1234,
      stats: { exportTimeS: 0.5, exportFps: 120, timeRatio: 4 }
    })
  })

  it('warns about discarded tracks and fails when the conversion is invalid', async () => {
    const { backend, log } = fakeBackend({ timestamps: [0], valid: false })
    const { d, warnings, downloads } = deps(backend, log)
    const final = await startExport(SETTINGS, d).done
    expect(warnings).toEqual([['Discarded tracks:', ['audio: unsupported']]])
    expect(final).toEqual({ status: 'failed', message: 'Cannot execute this conversion' })
    expect(downloads).toEqual([])
  })

  it('reports encoder errors in the page', async () => {
    const { backend, log } = fakeBackend({ timestamps: [0, 1], failAt: 1 })
    const { d } = deps(backend, log)
    expect(await startExport(SETTINGS, d).done).toEqual({ status: 'failed', message: 'encoder exploded' })
  })

  it('cancels a running export without downloading', async () => {
    const hooks: { cancel?: () => void } = {}
    const { backend, log } = fakeBackend({ timestamps: [0, 0.5, 1], cancelAt: 1, hooks })
    const { d, downloads, context } = deps(backend, log)
    const job = startExport(SETTINGS, d)
    hooks.cancel = () => job.cancel()
    expect(await job.done).toEqual({ status: 'cancelled' })
    expect(downloads).toEqual([])
    expect(context.filter((c) => c.startsWith('frame'))).toEqual(['frame 0', 'frame 0.5'])
  })

  it('cancels before the conversion exists', async () => {
    const { backend, log } = fakeBackend({ timestamps: [0, 1] })
    const { d, downloads } = deps(backend, log)
    const job = startExport(SETTINGS, d)
    job.cancel()
    expect(await job.done).toEqual({ status: 'cancelled' })
    expect(downloads).toEqual([])
  })

  it('reads settings from the inputs with parseFloat and names files like upstream', () => {
    expect(
      exportSettings({
        selection: { format: 'webm', videoCodec: 'vp9', audioCodec: 'opus' },
        frameRate: '60',
        width: 1920,
        height: 1080,
        startText: '1.5',
        endText: ''
      })
    ).toEqual({
      fps: 60,
      width: 1920,
      height: 1080,
      start: 1.5,
      end: Number.NaN,
      format: 'webm',
      videoCodec: 'vp9',
      audioCodec: 'opus'
    })
    expect(exportFileName('.mkv')).toBe('VideoOverlay.mkv')
    expect(exportRunning({ status: 'encoding', progress: 0, progressText: '0.00%' })).toBe(true)
    expect(exportRunning({ status: 'cancelled' })).toBe(false)
  })
})
