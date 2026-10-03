// Port of upstream tests/mavparam.test.cjs (MAVParam client and definitions).
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FtpCallback } from '../ftp/client.js'
import { paramsFixture, UPSTREAM } from '../test-utils/upstream.js'
import { ParamDefinitions, type DefinitionsCache, type ParamDefinition } from './definitions.js'
import { MavParam, type ParamFtpPort } from './model.js'
import { decodeParams, PARAM_DOWNLOAD, PARAM_UPLOAD, parseParamText } from './packed.js'

const fixture = paramsFixture()
const packed = (): Uint8Array => Uint8Array.from(Buffer.from(fixture.hex, 'hex'))
const def = (patch: Partial<ParamDefinition>): ParamDefinition => ({
  name: '',
  label: '',
  description: '',
  units: '',
  range: undefined,
  increment: undefined,
  values: {},
  bitmask: {},
  readOnly: false,
  rebootRequired: false,
  ...patch
})

interface Call {
  readonly path: string
  readonly opts?: unknown
  readonly data?: Uint8Array
}

function client() {
  const bytes = packed()
  const calls: Call[] = []
  const ftp: ParamFtpPort & {
    getFile: ParamFtpPort['getFile']
    putFile: ParamFtpPort['putFile']
  } = {
    getFile(path, cb, opts) {
      calls.push({ path, opts })
      cb({ kind: 'done', value: bytes.slice() })
    },
    putFile(path, data, cb) {
      calls.push({ path, data })
      const upload = Uint8Array.from(data)
      const view = new DataView(upload.buffer)
      view.setUint16(4, view.getUint16(2, true), true)
      const target = new DataView(bytes.buffer)
      for (const p of decodeParams(upload).values()) {
        const { offset, type } = fixture.offsets[p.name]!
        if (type === 1) target.setInt8(offset, p.value)
        else if (type === 2) target.setInt16(offset, p.value, true)
        else if (type === 3) target.setInt32(offset, p.value, true)
        else target.setFloat32(offset, p.value, true)
      }
      cb({ kind: 'done', value: data.length })
    }
  }
  return { model: new MavParam(ftp), ftp, calls }
}

describe('MAVParam', () => {
  it('fetch, incremental description search, nondefaults, reset and file apply verify readback', async () => {
    const { model, calls } = client()
    await model.refresh()
    expect(calls[0]!.path).toBe(PARAM_DOWNLOAD)
    expect(calls[0]!.opts).toMatchObject({ fixedReadSize: true, sizeIsEstimate: true })
    expect(model.search('', true).length).toBe(4)
    model.setDefinitions(new Map([['TEST_I8', def({ description: 'Motor test speed' })]]))
    expect(model.search('motor speed')[0]!.name).toBe('TEST_I8')
    await model.reset('TEST_I8')
    expect(model.params.get('TEST_I8')!.value).toBe(0)
    expect(model.search('TEST_I8', true).length).toBe(0)
    await model.apply(parseParamText('TEST_I32 16777219'))
    expect(model.params.get('TEST_I32')!.value).toBe(16777219)
    expect(calls.filter((c) => c.path === PARAM_UPLOAD).length).toBe(2)
  })

  it('unknown, read-only, invalid types and no-op imports never upload', async () => {
    const { model, calls } = client()
    await model.refresh()
    model.setDefinitions(new Map([['TEST_READONLY', def({ readOnly: true })]]))
    for (const text of ['UNKNOWN 1', 'TEST_READONLY 0', 'TEST_I8 1.5'])
      await expect(model.apply(parseParamText(text))).rejects.toThrow()
    await model.apply(parseParamText('TEST_I8 -12'))
    expect(calls.length).toBe(1)
    expect(model.busy).toBe(false)
  })

  it('rejected values and failed close are reported after refreshing actual state', async () => {
    const { model, ftp } = client()
    await model.refresh()
    ftp.putFile = (_path, bytes, cb) => cb({ kind: 'done', value: bytes.length })
    await expect(model.apply(new Map([['TEST_I8', 2]]))).rejects.toThrow(/did not retain/)
    expect(model.params.get('TEST_I8')!.value).toBe(-12)
    ftp.putFile = (_path, _bytes, cb) => cb({ kind: 'failed' })
    await expect(model.apply(new Map([['TEST_I8', 2]]))).rejects.toThrow(/not acknowledged/)
  })

  it('lost readback clears stale data; disconnect and concurrent operations cannot update another vehicle', async () => {
    const { model, ftp } = client()
    await model.refresh()
    ftp.getFile = (_path, cb) => cb({ kind: 'failed' })
    await expect(model.apply(new Map([['TEST_I8', 2]]))).rejects.toThrow(/unverified/)
    expect(model.params.size).toBe(0)
    let callback: FtpCallback<Uint8Array> | undefined
    ftp.getFile = (_path, cb) => (callback = cb)
    const pending = model.refresh()
    await expect(model.refresh()).rejects.toThrow(/already in progress/)
    model.disconnect()
    callback!({ kind: 'done', value: packed() })
    await expect(pending).rejects.toThrow(/disconnected/)
    expect(model.params.size).toBe(0)
  })
})

const metadata = {
  Rover: {
    TEST_I8: {
      DisplayName: 'Test speed',
      Description: 'Motor speed',
      Units: 'm/s',
      Range: { low: '0', high: '10' },
      Values: { 0: 'Off', 1: 'On' },
      ReadOnly: 'True',
      RebootRequired: 'True'
    },
    TEST_OPTIONS: { Bitmask: { 0: 'A', 2: 'C' } }
  }
}

describe('MAVParamDefinitions', () => {
  it('definitions retain descriptions, ranges, enum/bitmask options and read-only flags', () => {
    const d = ParamDefinitions.parse(metadata)
    expect(d.get('TEST_I8')!.description).toBe('Motor speed')
    expect(d.get('TEST_I8')!.readOnly).toBe(true)
    expect(d.get('TEST_I8')!.rebootRequired).toBe(true)
    expect(d.get('TEST_OPTIONS')!.bitmask).toMatchObject({ 2: 'C' })
    expect(() => ParamDefinitions.parse({})).toThrow()
  })

  it('metadata caches per vehicle, supports refresh and stale offline copies', async () => {
    let calls = 0
    let offline = false
    const fetch = (): Promise<Response> => {
      calls++
      if (offline) return Promise.reject(new Error('offline'))
      return Promise.resolve(new Response(JSON.stringify(metadata)))
    }
    const cacheData = new Map<string, Response>()
    const cache: DefinitionsCache = {
      open: () =>
        Promise.resolve({
          match: (u: string) => Promise.resolve(cacheData.get(u)?.clone()),
          put: (u: string, r: Response) => {
            cacheData.set(u, r)
            return Promise.resolve()
          }
        })
    }
    const store = new ParamDefinitions({ fetch, cache })
    await store.load('Rover')
    expect(calls).toBe(1)
    expect((await store.load('Rover')).cached).toBe(true)
    expect(calls).toBe(1)
    const other = new ParamDefinitions({ fetch, cache })
    expect((await other.load('Rover')).cached).toBe(true)
    expect(calls).toBe(1)
    offline = true
    expect((await other.load('Rover', { refresh: true })).stale).toBe(true)
    await expect(other.load('Plane')).rejects.toThrow(/offline/)
    await expect(other.load('../bad')).rejects.toThrow(/Unknown/)
  })
})

describe('MAVParamDefinitions cache option (oracle against upstream)', () => {
  it('an explicit undefined cache falls back to Cache Storage and null disables it, as upstream default parameters do', async () => {
    const { MAVParamDefinitions: Upstream } = createRequire(import.meta.url)(
      resolve(UPSTREAM, 'modules/MAVLink/mavparam.js')
    ) as { MAVParamDefinitions: new (options: Record<string, unknown>) => { load(v: string): Promise<{ cached: boolean }> } }
    const fetch = (): Promise<Response> => Promise.resolve(new Response(JSON.stringify(metadata)))
    const opened: string[] = []
    const fakeCaches: DefinitionsCache = {
      open: (name) => {
        opened.push(name)
        return Promise.resolve({ match: () => Promise.resolve(undefined), put: () => Promise.resolve() })
      }
    }
    const saved: unknown = Reflect.get(globalThis, 'caches')
    Reflect.set(globalThis, 'caches', fakeCaches)
    try {
      for (const cache of [undefined, null]) {
        opened.length = 0
        await new Upstream({ fetch, cache }).load('Rover')
        const theirs = [...opened]
        opened.length = 0
        await new ParamDefinitions({ fetch, cache }).load('Rover')
        expect(opened, String(cache)).toEqual(theirs)
      }
      expect(opened).toEqual([])
    } finally {
      Reflect.set(globalThis, 'caches', saved)
    }
  })
})
