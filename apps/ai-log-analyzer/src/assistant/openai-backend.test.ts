import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APIConnectionError, AuthenticationError, InternalServerError, RateLimitError } from 'openai'
import type { AssistantStreamEvent } from 'openai/resources/beta/assistants'
import type { MessageCreateParams } from 'openai/resources/beta/threads/messages'
import type { RunSubmitToolOutputsParams } from 'openai/resources/beta/threads/runs/runs'
import type { ToolResult } from '../analysis/tool-calls.js'
import { ASSISTANT_TOOLS } from '../analysis/tool-definitions.js'
import { BackendError, type BackendEvent } from './backend.js'
import {
  ASSISTANT_CONFIG,
  ASSISTANT_MODEL,
  ASSISTANT_NAME,
  OpenAiAssistantBackend,
  mapRunStream,
  openAiAssistantsApi,
  toBackendError,
  type AssistantConfig,
  type AssistantsApi
} from './openai-backend.js'

/** Test events only carry the fields the backend reads. */
const ev = (e: object): AssistantStreamEvent => e as AssistantStreamEvent

const textDelta = (messageId: string, value: string) =>
  ev({
    event: 'thread.message.delta',
    data: { id: messageId, delta: { content: [{ index: 0, type: 'text', text: { value } }] } }
  })
const imageDelta = (fileId: string) =>
  ev({
    event: 'thread.message.delta',
    data: { id: 'msg', delta: { content: [{ index: 0, type: 'image_file', image_file: { file_id: fileId } }] } }
  })
const requiresAction = (runId: string, calls: { id: string; name: string; arguments: string }[]) =>
  ev({
    event: 'thread.run.requires_action',
    data: {
      id: runId,
      required_action: {
        type: 'submit_tool_outputs',
        submit_tool_outputs: {
          tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
        }
      }
    }
  })
const completed = ev({ event: 'thread.run.completed', data: { id: 'run' } })

async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items) {
    await Promise.resolve()
    yield item
  }
}

async function collect(stream: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const out: BackendEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

type Call =
  | { op: 'listAssistants' }
  | { op: 'createAssistant'; config: AssistantConfig }
  | { op: 'deleteAssistant'; id: string }
  | { op: 'createThread'; id: string }
  | { op: 'createMessage'; threadId: string; message: MessageCreateParams }
  | { op: 'streamRun'; threadId: string; assistantId: string }
  | { op: 'submitToolOutputs'; threadId: string; runId: string; outputs: RunSubmitToolOutputsParams.ToolOutput[] }
  | { op: 'cancelRun'; threadId: string; runId: string }
  | { op: 'listFiles' }
  | { op: 'deleteFile'; id: string }
  | { op: 'uploadFile'; name: string; text: string }
  | { op: 'fileContent'; id: string }

/** Scriptable stand-in for the OpenAI API; records every call. */
class FakeApi implements AssistantsApi {
  calls: Call[] = []
  assistants: { id: string; name: string | null }[] = []
  files: { id: string; filename: string }[] = []
  /** One event list per run started (streamRun or submitToolOutputs), in order. */
  runs: AssistantStreamEvent[][] = []
  failWith: Partial<Record<Call['op'], unknown>> = {}
  private threads = 0
  private uploads = 0

  private check(op: Call['op']) {
    if (op in this.failWith) throw this.failWith[op]
  }

  listAssistants() {
    this.calls.push({ op: 'listAssistants' })
    this.check('listAssistants')
    return Promise.resolve(this.assistants)
  }
  createAssistant(config: AssistantConfig) {
    this.calls.push({ op: 'createAssistant', config })
    this.check('createAssistant')
    const id = `asst_new${this.assistants.length}`
    this.assistants.push({ id, name: config.name })
    return Promise.resolve({ id })
  }
  deleteAssistant(id: string) {
    this.calls.push({ op: 'deleteAssistant', id })
    this.assistants = this.assistants.filter((a) => a.id !== id)
    return Promise.resolve()
  }
  createThread() {
    const id = `thread_${++this.threads}`
    this.calls.push({ op: 'createThread', id })
    this.check('createThread')
    return Promise.resolve({ id })
  }
  createMessage(threadId: string, message: MessageCreateParams) {
    this.calls.push({ op: 'createMessage', threadId, message })
    this.check('createMessage')
    return Promise.resolve()
  }
  private nextRun() {
    return Promise.resolve(iterate(this.runs.shift() ?? [completed]))
  }
  streamRun(threadId: string, assistantId: string) {
    this.calls.push({ op: 'streamRun', threadId, assistantId })
    this.check('streamRun')
    return this.nextRun()
  }
  submitToolOutputs(threadId: string, runId: string, outputs: RunSubmitToolOutputsParams.ToolOutput[]) {
    this.calls.push({ op: 'submitToolOutputs', threadId, runId, outputs })
    return this.nextRun()
  }
  cancelRun(threadId: string, runId: string) {
    this.calls.push({ op: 'cancelRun', threadId, runId })
    return Promise.resolve()
  }
  listFiles() {
    this.calls.push({ op: 'listFiles' })
    return Promise.resolve(this.files)
  }
  deleteFile(id: string) {
    this.calls.push({ op: 'deleteFile', id })
    this.files = this.files.filter((f) => f.id !== id)
    return Promise.resolve()
  }
  async uploadFile(file: File) {
    this.calls.push({ op: 'uploadFile', name: file.name, text: await file.text() })
    const id = `file_${++this.uploads}`
    this.files.push({ id, filename: file.name })
    return { id }
  }
  fileContent(id: string) {
    this.calls.push({ op: 'fileContent', id })
    this.check('fileContent')
    return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
  }

  ops() {
    return this.calls.map((c) => c.op)
  }
}

const backendFor = (api: FakeApi) => new OpenAiAssistantBackend(api)

const dataResult = (json: string): ToolResult => ({
  status: 'data',
  json,
  summary: 'ATT: 1 records, 1 fields'
})
const failureResult: ToolResult = { status: 'failure', reason: 'no-log', message: 'failure, user did not upload logs file' }

describe('assistant configuration', () => {
  it('uses upstream name, model, instructions and tools', () => {
    expect(ASSISTANT_NAME).toBe('Log Analyzer')
    expect(ASSISTANT_MODEL).toBe('gpt-4o')
    expect(ASSISTANT_CONFIG.instructions).toBe(
      readFileSync(resolve(__dirname, '../../../../upstream/AILogAnalyzer/instructions.txt'), 'utf8')
    )
    expect(ASSISTANT_CONFIG.tools).toEqual(ASSISTANT_TOOLS)
  })
})

describe('OpenAiAssistantBackend.connect', () => {
  it('reuses an existing assistant with the target name and opens one thread', async () => {
    const api = new FakeApi()
    api.assistants = [
      { id: 'asst_other', name: 'Other' },
      { id: 'asst_log', name: ASSISTANT_NAME }
    ]
    const backend = backendFor(api)
    await backend.connect()
    await backend.connect()
    expect(api.ops()).toEqual(['listAssistants', 'createThread'])
    await collect(backend.sendMessage('hi'))
    expect(api.calls).toContainEqual({ op: 'streamRun', threadId: 'thread_1', assistantId: 'asst_log' })
  })

  it('creates the assistant when none exists', async () => {
    const api = new FakeApi()
    await backendFor(api).connect()
    expect(api.ops()).toEqual(['listAssistants', 'createAssistant', 'createThread'])
    expect(api.calls[1]).toEqual({ op: 'createAssistant', config: ASSISTANT_CONFIG })
  })

  it('classifies a bad key without echoing the key', async () => {
    const api = new FakeApi()
    api.failWith.listAssistants = new AuthenticationError(
      401,
      { message: 'Incorrect API key provided: sk-test-1234', code: 'invalid_api_key' },
      undefined,
      new Headers()
    )
    const error = await backendFor(api)
      .connect()
      .then(
        () => null,
        (e: unknown) => e
      )
    expect(error).toBeInstanceOf(BackendError)
    expect(error).toMatchObject({ kind: 'auth' })
    expect((error as Error).message).not.toContain('sk-')
  })

  it('retries the thread after a failed connect', async () => {
    const api = new FakeApi()
    api.failWith.createThread = new APIConnectionError({ message: 'offline' })
    const backend = backendFor(api)
    await expect(backend.connect()).rejects.toMatchObject({ kind: 'network' })
    delete api.failWith.createThread
    await backend.connect()
    expect(api.ops().filter((o) => o === 'createAssistant')).toHaveLength(1)
  })
})

describe('OpenAiAssistantBackend.sendMessage', () => {
  it('posts the message and streams text, images and tool calls', async () => {
    const api = new FakeApi()
    api.runs = [
      [
        textDelta('msg_1', 'Hello'),
        textDelta('msg_1', ' there'),
        imageDelta('file_img'),
        requiresAction('run_1', [{ id: 'call_1', name: 'get', arguments: '{"message_type":"GPS"}' }])
      ]
    ]
    const backend = backendFor(api)
    const events = await collect(backend.sendMessage('Show GPS'))
    expect(api.calls).toContainEqual({
      op: 'createMessage',
      threadId: 'thread_1',
      message: { role: 'user', content: 'Show GPS', attachments: null }
    })
    expect(events[0]).toEqual({ type: 'text', messageId: 'msg_1', delta: 'Hello' })
    expect(events[1]).toEqual({ type: 'text', messageId: 'msg_1', delta: ' there' })
    expect(events[2]).toMatchObject({ type: 'image', fileId: 'file_img' })
    expect(events[3]).toEqual({
      type: 'tool-calls',
      runId: 'run_1',
      calls: [{ id: 'call_1', name: 'get', arguments: '{"message_type":"GPS"}' }]
    })
  })

  it('reports images that fail to download and keeps streaming', async () => {
    const api = new FakeApi()
    api.failWith.fileContent = new APIConnectionError({ message: 'offline' })
    api.runs = [[imageDelta('file_img'), textDelta('m', 'done')]]
    const events = await collect(backendFor(api).sendMessage('plot'))
    expect(events[0]?.type).toBe('image-error')
    expect(events[1]).toEqual({ type: 'text', messageId: 'm', delta: 'done' })
  })

  it('wraps errors thrown while streaming', async () => {
    const api = new FakeApi()
    api.failWith.streamRun = new RateLimitError(
      429,
      { message: 'slow down', code: 'rate_limit_exceeded' },
      undefined,
      new Headers()
    )
    await expect(collect(backendFor(api).sendMessage('x'))).rejects.toMatchObject({ kind: 'rate-limit' })
  })
})

describe('OpenAiAssistantBackend.submitToolOutputs', () => {
  it('uploads the data, restarts the run with output.json attached, then attaches it to later messages', async () => {
    const api = new FakeApi()
    api.files = [
      { id: 'file_old', filename: 'output.json' },
      { id: 'file_keep', filename: 'notes.txt' }
    ]
    api.runs = [[textDelta('msg_2', 'Analysis')]]
    const backend = backendFor(api)
    await backend.connect()
    api.calls = []

    const events = await collect(backend.submitToolOutputs('run_1', [{ callId: 'call_1', result: dataResult('{"a":1}') }]))

    expect(api.ops()).toEqual(['listFiles', 'deleteFile', 'uploadFile', 'cancelRun', 'createMessage', 'streamRun'])
    expect(api.calls).toContainEqual({ op: 'deleteFile', id: 'file_old' })
    expect(api.calls).toContainEqual({ op: 'uploadFile', name: 'output.json', text: '{"a":1}' })
    expect(api.calls).toContainEqual({ op: 'cancelRun', threadId: 'thread_1', runId: 'run_1' })
    expect(api.calls).toContainEqual({
      op: 'createMessage',
      threadId: 'thread_1',
      message: {
        role: 'user',
        content:
          'The data for the requested message has been extracted. Continue processing using the output.json file with id: file_1',
        attachments: [{ file_id: 'file_1', tools: [{ type: 'code_interpreter' }] }]
      }
    })
    expect(events).toEqual([{ type: 'text', messageId: 'msg_2', delta: 'Analysis' }])
    expect(api.files.map((f) => f.id)).toEqual(['file_keep', 'file_1'])

    api.calls = []
    await collect(backend.sendMessage('and the max?'))
    expect(api.calls[0]).toEqual({
      op: 'createMessage',
      threadId: 'thread_1',
      message: {
        role: 'user',
        content: 'and the max?',
        attachments: [{ file_id: 'file_1', tools: [{ type: 'code_interpreter' }] }]
      }
    })
  })

  it('submits failure messages so the assistant can recover', async () => {
    const api = new FakeApi()
    const backend = backendFor(api)
    await backend.connect()
    api.calls = []
    await collect(backend.submitToolOutputs('run_1', [{ callId: 'call_1', result: failureResult }]))
    expect(api.calls).toEqual([
      {
        op: 'submitToolOutputs',
        threadId: 'thread_1',
        runId: 'run_1',
        outputs: [{ tool_call_id: 'call_1', output: 'failure, user did not upload logs file' }]
      }
    ])
  })

  it('in a mixed batch uploads each data result and submits every output, with none for successes', async () => {
    const api = new FakeApi()
    const backend = backendFor(api)
    await backend.connect()
    api.calls = []
    await collect(
      backend.submitToolOutputs('run_1', [
        { callId: 'ok1', result: dataResult('{"first":1}') },
        { callId: 'ok2', result: dataResult('{"second":2}') },
        { callId: 'bad', result: failureResult }
      ])
    )
    expect(api.ops()).toEqual(['listFiles', 'uploadFile', 'listFiles', 'deleteFile', 'uploadFile', 'submitToolOutputs'])
    expect(api.calls).toContainEqual({ op: 'deleteFile', id: 'file_1' })
    const submit = api.calls.at(-1)
    expect(submit?.op === 'submitToolOutputs' && submit.outputs).toEqual([
      { tool_call_id: 'ok1' },
      { tool_call_id: 'ok2' },
      { tool_call_id: 'bad', output: 'failure, user did not upload logs file' }
    ])
    // The last upload stays attached to later messages (upstream global fileId).
    api.calls = []
    await collect(backend.sendMessage('next'))
    expect(api.calls[0]).toMatchObject({ message: { attachments: [{ file_id: 'file_2' }] } })
  })

  it('a no-data failure clears the remembered file, other failures keep it', async () => {
    const api = new FakeApi()
    const backend = backendFor(api)
    await collect(backend.submitToolOutputs('run_1', [{ callId: 'a', result: dataResult('{}') }]))
    await collect(backend.submitToolOutputs('run_2', [{ callId: 'b', result: failureResult }]))
    api.calls = []
    await collect(backend.sendMessage('still attached'))
    expect(api.calls[0]).toMatchObject({ message: { attachments: [{ file_id: 'file_1' }] } })

    const noData: ToolResult = {
      status: 'failure',
      reason: 'no-data',
      message: 'failure, requested message type does not exist in message types'
    }
    await collect(backend.submitToolOutputs('run_3', [{ callId: 'c', result: noData }]))
    api.calls = []
    await collect(backend.sendMessage('cleared'))
    expect(api.calls[0]).toMatchObject({ message: { attachments: null } })
  })

  it('stops at a crashed call without submitting anything', async () => {
    const api = new FakeApi()
    const backend = backendFor(api)
    await backend.connect()
    api.calls = []
    const crash: ToolResult = { status: 'crash', message: 'Unexpected token' }
    await expect(
      collect(
        backend.submitToolOutputs('run_1', [
          { callId: 'a', result: dataResult('{}') },
          { callId: 'b', result: crash }
        ])
      )
    ).rejects.toMatchObject({ kind: 'unknown' })
    expect(api.ops()).toEqual(['listFiles', 'uploadFile'])
  })

  it('keeps uploading when deleting an old output.json fails', async () => {
    const api = new FakeApi()
    api.files = [{ id: 'file_old', filename: 'output.json' }]
    api.deleteFile = () => Promise.reject(new Error('gone'))
    api.runs = [[]]
    await collect(backendFor(api).submitToolOutputs('run_1', [{ callId: 'a', result: dataResult('{}') }]))
    expect(api.ops()).toContain('uploadFile')
  })
})

describe('OpenAiAssistantBackend conversation and assistant reset', () => {
  it('newConversation opens a new thread and keeps the attachment, like upstream after an update', async () => {
    const api = new FakeApi()
    api.runs = [[]]
    const backend = backendFor(api)
    await collect(backend.submitToolOutputs('run_1', [{ callId: 'c', result: dataResult('{}') }]))
    await backend.newConversation()
    api.calls = []
    await collect(backend.sendMessage('fresh'))
    expect(api.calls[0]).toEqual({ op: 'createThread', id: 'thread_2' })
    expect(api.calls[1]).toEqual({
      op: 'createMessage',
      threadId: 'thread_2',
      message: { role: 'user', content: 'fresh', attachments: [{ file_id: 'file_1', tools: [{ type: 'code_interpreter' }] }] }
    })
  })

  it('recreateAssistant deletes the assistant and creates it again', async () => {
    const api = new FakeApi()
    api.assistants = [{ id: 'asst_log', name: ASSISTANT_NAME }]
    const backend = backendFor(api)
    await backend.connect()
    api.calls = []
    await backend.recreateAssistant()
    expect(api.ops()).toEqual(['deleteAssistant', 'listAssistants', 'createAssistant', 'createThread'])
    expect(api.calls[0]).toEqual({ op: 'deleteAssistant', id: 'asst_log' })
  })
})

describe('mapRunStream', () => {
  it('turns run failures into classified errors', async () => {
    const events = await collect(
      mapRunStream(
        iterate([
          ev({
            event: 'thread.run.failed',
            data: { id: 'r', last_error: { code: 'rate_limit_exceeded', message: 'You exceeded your current quota' } }
          }),
          ev({
            event: 'thread.run.failed',
            data: { id: 'r', last_error: { code: 'rate_limit_exceeded', message: 'Too many requests' } }
          }),
          ev({ event: 'thread.run.failed', data: { id: 'r', last_error: { code: 'server_error', message: 'boom' } } }),
          ev({ event: 'thread.run.failed', data: { id: 'r', last_error: null } }),
          ev({ event: 'thread.run.expired', data: { id: 'r' } }),
          ev({ event: 'error', data: { code: null, message: 'bad', param: null, type: 'server_error' } })
        ]),
        () => Promise.reject(new Error('unused'))
      )
    )
    expect(events.map((e) => (e.type === 'failed' ? e.error.kind : e.type))).toEqual([
      'quota',
      'rate-limit',
      'api',
      'api',
      'api',
      'api'
    ])
  })

  it('ignores progress events and empty deltas', async () => {
    const events = await collect(
      mapRunStream(
        iterate([
          ev({ event: 'thread.run.created', data: { id: 'r' } }),
          ev({ event: 'thread.message.delta', data: { id: 'm', delta: {} } }),
          textDelta('m', ''),
          completed
        ]),
        () => Promise.reject(new Error('unused'))
      )
    )
    expect(events).toEqual([])
  })
})

describe('toBackendError', () => {
  it.each([
    [new RateLimitError(429, { code: 'insufficient_quota', message: 'quota' }, undefined, new Headers()), 'quota'],
    [new RateLimitError(429, { code: 'rate_limit_exceeded', message: 'rpm' }, undefined, new Headers()), 'rate-limit'],
    [new APIConnectionError({ message: 'Connection error.' }), 'network'],
    [new InternalServerError(500, { message: 'oops' }, undefined, new Headers()), 'api'],
    [new Error('weird'), 'unknown'],
    ['string', 'unknown']
  ])('classifies %s', (error, kind) => {
    expect(toBackendError(error).kind).toBe(kind)
  })

  it('passes BackendErrors through', () => {
    const e = new BackendError('network', 'x')
    expect(toBackendError(e)).toBe(e)
  })
})

describe('openAiAssistantsApi', () => {
  /** A fetch that answers locally, so no request can reach OpenAI. */
  function fakeFetch(respond: (url: string, init: RequestInit | undefined) => Response) {
    const requests: { url: string; init: RequestInit | undefined }[] = []
    const fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      requests.push({ url, init })
      return Promise.resolve(respond(url, init))
    }
    return { fetch, requests }
  }

  const headerOf = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name)

  it('lists assistants with the key, the Assistants v2 header and upstream query', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({ object: 'list', data: [{ id: 'asst_1', name: ASSISTANT_NAME }], has_more: false })
    )
    const api = openAiAssistantsApi('test-key-not-real', fetch)
    expect(await api.listAssistants()).toMatchObject([{ id: 'asst_1', name: ASSISTANT_NAME }])
    const request = requests[0]
    expect(request?.url).toBe('https://api.openai.com/v1/assistants?order=desc&limit=100')
    expect(headerOf(request?.init, 'authorization')).toBe('Bearer test-key-not-real')
    expect(headerOf(request?.init, 'openai-beta')).toBe('assistants=v2')
  })

  it('streams a run as server-sent events', async () => {
    const sse = [
      'event: thread.run.created\ndata: {"id":"run_1","object":"thread.run"}\n\n',
      'event: thread.message.delta\ndata: {"id":"msg_1","object":"thread.message.delta","delta":{"content":[{"index":0,"type":"text","text":{"value":"Hi"}}]}}\n\n',
      'event: done\ndata: [DONE]\n\n'
    ].join('')
    const { fetch, requests } = fakeFetch(() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }))
    const api = openAiAssistantsApi('test-key-not-real', fetch)
    const events = await collect(
      mapRunStream(await api.streamRun('thread_1', 'asst_1'), () => Promise.reject(new Error('unused')))
    )
    expect(events).toEqual([{ type: 'text', messageId: 'msg_1', delta: 'Hi' }])
    expect(requests[0]?.url).toBe('https://api.openai.com/v1/threads/thread_1/runs')
    const body = requests[0]?.init?.body
    expect(typeof body === 'string' ? JSON.parse(body) : body).toEqual({ assistant_id: 'asst_1', stream: true })
  })

  it('maps a 401 response to an auth error', async () => {
    const { fetch } = fakeFetch(() =>
      Response.json(
        { error: { message: 'Incorrect API key provided: test-key', type: 'invalid_request_error', code: 'invalid_api_key' } },
        { status: 401 }
      )
    )
    const backend = new OpenAiAssistantBackend(openAiAssistantsApi('test-key-not-real', fetch))
    await expect(backend.connect()).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('OpenAiAssistantBackend.switchApi', () => {
  it('starts a new session on the new client and keeps the remembered file', async () => {
    const first = new FakeApi()
    first.runs = [[]]
    const backend = new OpenAiAssistantBackend(first)
    await collect(backend.submitToolOutputs('run_1', [{ callId: 'c', result: dataResult('{}') }]))
    const second = new FakeApi()
    backend.switchApi(second)
    await collect(backend.sendMessage('again'))
    expect(second.ops().slice(0, 4)).toEqual(['listAssistants', 'createAssistant', 'createThread', 'createMessage'])
    expect(second.calls[3]).toMatchObject({ message: { attachments: [{ file_id: 'file_1' }] } })
  })
})
