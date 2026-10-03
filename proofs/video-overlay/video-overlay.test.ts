import { describe, expect, it } from 'vitest'
import { evalFunction, functionSource, inlineSource, parseFixture, sandboxWorld } from './_harness.js'

const VO = 'VideoOverlay/VideoOverlay.js'

describe('Video Overlay #118: overlay file with neither widgets nor widget', () => {
  it('alerts "Unable to load from: [object File]"', () => {
    const alerts: string[] = []
    const calls: string[] = []
    const text = '{"header":{"tool":"videoOverlay"}}'
    class FakeReader {
      result = ''
      onload: (() => void) | null = null
      readAsText() {
        this.result = text
        this.onload?.()
      }
    }
    const file = new File([text], 'overlay.json', { type: 'application/json' })
    const handler = evalFunction(inlineSource(VO, 'overlayInput.onchange = ', '() =>'), {
      overlayInput: { files: [file] },
      FileReader: FakeReader,
      alert: (s: string) => void alerts.push(s),
      load_layout: () => void calls.push('load_layout'),
      add_widget: () => void calls.push('add_widget')
    })
    handler()
    expect(alerts).toEqual(['Unable to load from: [object File]'])
    expect(calls).toEqual([])
  })
})

describe('Video Overlay #119: instanced message read without an instance', () => {
  it('get() throws a TypeError where get_instance() and missing data return values', async () => {
    const log = await parseFixture('copter-sitl.bin')
    expect(log.messageTypes.IMU?.instances).toEqual({ '0': 'IMU[0]', '1': 'IMU[1]' })
    const imu = log.FMT.find((f) => f?.Name === 'IMU')
    expect(imu && 'OffsetArray' in imu).toBe(false)
    expect(Object.keys(imu?.InstancesOffsetArray ?? {})).toEqual(['0', '1'])

    expect(() => log.get('IMU', 'GyrX')).toThrow("Cannot read properties of undefined (reading 'length')")
    // The same function's other "no data" paths return undefined.
    expect(log.get('NOSUCH', 'GyrX')).toBeUndefined()
    expect(log.get_instance('IMU', 7, 'GyrX')).toBeUndefined()
    expect(log.get('ATT', 'NoSuchField')).toBeUndefined()
    expect((log.get_instance('IMU', 0, 'GyrX') as ArrayLike<number>).length).toBeGreaterThan(0)
  })
})

describe('Video Overlay #120: a video without an audio track', () => {
  function run(audioTrack: { codec: string } | null) {
    const el = (): { textContent: string; value: unknown } => ({ textContent: '', value: '' })
    const infoEls: Record<string, ReturnType<typeof el>> = {
      '#fps': el(),
      '#codec': el(),
      '#resolution': el(),
      '#duration': el()
    }
    const docEls: Record<string, ReturnType<typeof el>> = {
      start_time: el(),
      end_time: el(),
      export_width: el(),
      export_height: el()
    }
    const matched: unknown[][] = []
    const vidTrack = {
      codec: 'avc',
      displayWidth: 1920,
      displayHeight: 1080,
      computePacketStats: () => Promise.resolve({ averagePacketRate: 29.97 })
    }
    const handler = evalFunction(inlineSource(VO, "input.addEventListener('change', ", 'async () =>'), {
      input: { files: [{}] },
      video: { src: '', load: () => undefined },
      URL: { createObjectURL: () => 'blob:video' },
      Mediabunny: {
        BlobSource: function BlobSource() {},
        ALL_FORMATS: [],
        Input: class {
          getPrimaryVideoTrack = () => Promise.resolve(vidTrack)
          getPrimaryAudioTrack = () => Promise.resolve(audioTrack)
          getFormat = () => Promise.resolve({ name: 'MP4' })
          computeDuration = () => Promise.resolve(75)
        }
      },
      info: { querySelector: (s: string) => infoEls[s] },
      document: { getElementById: (id: string) => docEls[id] },
      formatTime: evalFunction(functionSource(VO, 'formatTime'), {}),
      MatchExportFormatToInput: (...args: unknown[]) => void matched.push(args)
    })
    const shown = () => ({
      ...Object.fromEntries(Object.entries(infoEls).map(([k, v]) => [k, v.textContent])),
      ...Object.fromEntries(Object.entries(docEls).map(([k, v]) => [k, v.value]))
    })
    return { promise: handler() as Promise<void>, shown, matched }
  }

  it('with an audio track, fills every info and export field', async () => {
    const r = run({ codec: 'aac' })
    await r.promise
    expect(r.shown()).toEqual({
      '#fps': '29.97',
      '#codec': 'avc + aac',
      '#resolution': '1920x1080px',
      '#duration': '1:15',
      start_time: 0,
      end_time: 75,
      export_width: 1920,
      export_height: 1080
    })
    expect(r.matched).toEqual([['MP4', 'avc', 'aac', '29.97']])
  })

  it('without one (Mediabunny returns null), throws after the FPS and leaves the rest', async () => {
    const r = run(null)
    await expect(r.promise).rejects.toThrow("Cannot read properties of null (reading 'codec')")
    expect(r.shown()).toEqual({
      '#fps': '29.97',
      '#codec': '',
      '#resolution': '',
      '#duration': '',
      start_time: '',
      end_time: '',
      export_width: '',
      export_height: ''
    })
    expect(r.matched).toEqual([])
  })
})

describe('Video Overlay #121: log duration and default offset by file position', () => {
  // One message type with a TimeUS (Q) column; its two records hold 5 s then 1 s in file order.
  function fakeLog() {
    const times: Record<number, number> = { 100: 5_000_000, 200: 1_000_000 }
    return {
      offset: 0,
      FMT: [{ Columns: ['TimeUS'], Format: 'Q', FormatOffset: [0], OffsetArray: [100, 200] }],
      parse_type(this: { offset: number }) {
        return times[this.offset]
      }
    }
  }

  it('returns last-minus-first by position (-4 s) and offsets by the first record (-5 s)', () => {
    const input = { value: undefined as unknown }
    const fns = evalFunction(
      `function () { ${functionSource(VO, 'getLogDurationUS')}\n${functionSource(VO, 'setDefaultOffset')}\nreturn { getLogDurationUS, setDefaultOffset } }`,
      { log: fakeLog(), document: { getElementById: () => input } }
    )() as { getLogDurationUS(): number; setDefaultOffset(): void }
    expect(fns.getLogDurationUS()).toBe(-4_000_000)
    fns.setDefaultOffset()
    expect(input.value).toBe(-5)
  })
})

describe('Video Overlay #165: sandbox widget posts its script twice on load', () => {
  it('both load listeners call init()', () => {
    const world = sandboxWorld()
    const widget = world.create({ sandbox: 'div.textContent = "hi"' })
    expect(widget.iframe.loadListeners).toHaveLength(2)
    for (const fn of widget.iframe.loadListeners) fn()
    expect(widget.iframe.posts).toEqual([
      { script: 'div.textContent = "hi"', options: { label: 'x' } },
      { script: 'div.textContent = "hi"', options: { label: 'x' } }
    ])
  })
})

describe('Video Overlay #166: a log that fails to parse', () => {
  it('stays assigned to the global log, and a later loadLog() sends its buffer', async () => {
    const buffer = new ArrayBuffer(8)
    let pending: Promise<unknown> | undefined
    const loadLogCalls: string[] = []
    class FakeReader {
      result: ArrayBuffer | null = null
      onload: (() => void) | null = null
      readAsArrayBuffer() {
        this.result = buffer
        this.onload?.()
      }
    }
    class ThrowingParser {
      buffer: ArrayBuffer | undefined
      processData(data: ArrayBuffer) {
        this.buffer = data
        throw new Error('parse failed')
      }
    }
    const globals: Record<string, unknown> = {
      logInput: { files: [{}] },
      FileReader: FakeReader,
      loading_call: (fn: () => Promise<unknown>) => {
        pending = fn()
      },
      import_done: [],
      Promise,
      DataflashParser: ThrowingParser,
      grid: { getGridItems: () => [{ loadLog: () => void loadLogCalls.push('loadLog') }] },
      log: undefined
    }
    evalFunction(inlineSource(VO, 'logInput.onchange = ', '() =>'), globals)()
    await expect(pending).rejects.toThrow('parse failed')
    expect(loadLogCalls).toEqual([])
    const failed = globals.log as ThrowingParser
    expect(failed).toBeInstanceOf(ThrowingParser)
    expect(failed.buffer).toBe(buffer)

    // Later, e.g. a dropped sandbox widget's loadLog(), posts that buffer.
    const world = sandboxWorld()
    world.context.log = failed
    const widget = world.create()
    for (const fn of widget.iframe.loadListeners) fn()
    widget.loadLog()
    await widget.initDone
    await Promise.resolve()
    expect(widget.iframe.posts.at(-1)).toEqual({ logData: buffer })
  })
})
