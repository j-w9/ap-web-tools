/**
 * Oracle tests for the chat flow: upstream logAnalyzer.js (in node:vm, on a fake DOM and a fake of
 * the v4 SDK) and the port (`connectAssistant`, `runTurn`, `updateAssistant` on the real v7 SDK
 * adapter over a fake fetch) talk to identical fake OpenAI servers. The request logs, the chat
 * lines and the key prompts must match. No request leaves the process.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { OpenAiAssistantBackend, openAiAssistantsApi } from '../assistant/openai-backend.js'
import { FakeOpenAiServer, type Json, type StreamEvent } from '../test-utils/fake-openai.js'
import { UpstreamAnalyzer, loadUpstreamParser, type ChatLine, type UpstreamParserCtor } from '../test-utils/upstream-analyzer.js'
import { connectAssistant, updateAssistant } from './session.js'
import { runTurn, type TurnEvent } from './turn.js'

const repo = resolve(__dirname, '../../../..')
const fixture = readFileSync(resolve(repo, 'packages/dataflash/test-fixtures/copter-sitl.bin'))
const logBuffer = () => fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength)

interface Side {
  submitKey(key: string): Promise<void>
  loadLog(buffer: ArrayBuffer): Promise<void>
  send(text: string): Promise<void>
  updateAssistant(): Promise<void>
  chat(): ChatLine[]
  readonly prompts: number
  readonly clients: readonly string[]
  readonly updateLabel: string
}

/** The port, driven the way App.tsx drives it. */
class PortAnalyzer implements Side {
  readonly clients: string[] = []
  prompts = 1
  updateLabel = 'Update Assistant'
  private readonly lines: ChatLine[] = []
  private backend: OpenAiAssistantBackend | null = null
  private log: DataflashLog | null = null
  private lastMessage: string | null = null

  constructor(private readonly server: FakeOpenAiServer) {}

  private readonly emit = (event: TurnEvent) => {
    switch (event.type) {
      case 'notice':
        this.lines.push({ kind: 'notice', tone: event.notice.tone, text: event.notice.text })
        this.lastMessage = null
        break
      case 'text': {
        const last = this.lines.at(-1)
        if (last?.kind === 'assistant' && this.lastMessage === event.messageId) {
          this.lines[this.lines.length - 1] = { kind: 'assistant', text: last.text + event.delta }
        } else {
          this.lines.push({ kind: 'assistant', text: event.delta })
        }
        this.lastMessage = event.messageId
        break
      }
      case 'prompt-key':
        this.prompts++
        break
      case 'image':
      case 'tool-started':
      case 'tool-finished':
        break
    }
  }

  async submitKey(key: string): Promise<void> {
    this.clients.push(key)
    const api = openAiAssistantsApi(key, this.server.fetch)
    this.backend ??= new OpenAiAssistantBackend(api)
    this.backend.switchApi(api)
    await connectAssistant(this.backend, this.emit)
  }

  loadLog(buffer: ArrayBuffer): Promise<void> {
    this.log = DataflashLog.parse(buffer)
    return Promise.resolve()
  }

  async send(text: string): Promise<void> {
    if (!this.backend) throw new Error('no key')
    this.lines.push({ kind: 'user', text })
    this.lastMessage = null
    await runTurn(this.backend, text, () => this.log, this.emit)
  }

  async updateAssistant(): Promise<void> {
    if (!this.backend) throw new Error('no key')
    const outcome = await updateAssistant(this.backend, this.emit)
    if (outcome !== 'skipped') this.updateLabel = outcome === 'updated' ? 'Updated' : 'Update Failed'
  }

  chat(): ChatLine[] {
    return this.lines
  }
}

/** Upstream appends every assistant delta to the last assistant bubble; compare the joined text. */
function merged(lines: readonly ChatLine[]): ChatLine[] {
  const out: ChatLine[] = []
  for (const line of lines) {
    const last = out.at(-1)
    if (line.kind === 'assistant' && last?.kind === 'assistant')
      out[out.length - 1] = { kind: 'assistant', text: last.text + line.text }
    else out.push(line)
  }
  return out
}

// ----------------------------------------------------------------------------- stream events

const textEvent = (id: string, value: string): StreamEvent => ({
  event: 'thread.message.delta',
  data: { id, object: 'thread.message.delta', delta: { content: [{ index: 0, type: 'text', text: { value } }] } }
})
const imageEvent = (fileId: string): StreamEvent => ({
  event: 'thread.message.delta',
  data: {
    id: 'msg_img',
    object: 'thread.message.delta',
    delta: { content: [{ index: 0, type: 'image_file', image_file: { file_id: fileId } }] }
  }
})
const requiresAction = (runId: string, ...calls: [string, string][]): StreamEvent => ({
  event: 'thread.run.requires_action',
  data: {
    id: runId,
    object: 'thread.run',
    status: 'requires_action',
    required_action: {
      type: 'submit_tool_outputs',
      submit_tool_outputs: {
        tool_calls: calls.map(([name, args], i): Json => ({
          id: `call_${i}`,
          type: 'function',
          function: { name, arguments: args }
        }))
      }
    }
  }
})
const completed: StreamEvent = { event: 'thread.run.completed', data: { id: 'run', object: 'thread.run', status: 'completed' } }
const runFailed: StreamEvent = {
  event: 'thread.run.failed',
  data: { id: 'run', object: 'thread.run', status: 'failed', last_error: { code: 'server_error', message: 'boom' } }
}
const streamError: StreamEvent = {
  event: 'error',
  data: { message: 'stream broke', type: 'server_error', code: null, param: null }
}

// ----------------------------------------------------------------------------------- driver

let Parser: UpstreamParserCtor
// Upstream calls its async connect path without handling rejections (e.g. a 401 while connecting or a
// failed thread creation), so those promises reject unhandled inside the upstream code under test.
// That is upstream behaviour, recorded in docs/upstream-bugs.md; collect them here so they are
// asserted instead of failing the run as unhandled.
const upstreamRejections: string[] = []
const onUnhandled = (reason: unknown) => {
  // Errors from the vm realm are not instances of this realm's Error, so read the text.
  upstreamRejections.push(String(reason).replace(/^Error: /, ''))
}
process.on('unhandledRejection', onUnhandled)
afterAll(() => {
  process.off('unhandledRejection', onUnhandled)
  for (const message of upstreamRejections) {
    expect(['Invalid API key (401)', 'Could not create conversation thread']).toContain(message)
  }
})

beforeAll(async () => {
  Parser = await loadUpstreamParser()
})

/**
 * @param portOnly Lines the port adds where upstream left an error unhandled (the crash clause of
 * docs/porting-policy.md), listed with their position.
 */
async function compare(
  setup: (server: FakeOpenAiServer) => void,
  steps: (side: Side) => Promise<void>,
  portOnly: readonly { readonly at: number; readonly line: ChatLine }[] = []
) {
  const upstreamServer = new FakeOpenAiServer()
  const portServer = new FakeOpenAiServer()
  setup(upstreamServer)
  setup(portServer)
  const upstream = new UpstreamAnalyzer(upstreamServer, Parser)
  const port = new PortAnalyzer(portServer)
  await steps(upstream)
  await steps(port)
  expect(portServer.log).toEqual(upstreamServer.log)
  const expected = merged(upstream.chat())
  for (const { at, line } of portOnly) expected.splice(at, 0, line)
  expect(merged(port.chat())).toEqual(expected)
  expect(port.prompts).toBe(upstream.prompts)
  expect(port.clients).toEqual(upstream.clients)
  expect(port.updateLabel).toBe(upstream.updateLabel)
  return { upstreamServer, upstream }
}

describe('chat flow matches upstream logAnalyzer.js', () => {
  it('creates the assistant, opens a thread and streams a reply', async () => {
    const { upstreamServer } = await compare(
      (s) => {
        s.runs = [[textEvent('m1', 'Hello'), textEvent('m1', ' pilot'), completed]]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.send('hi')
      }
    )
    expect(upstreamServer.log.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /assistants',
      'POST /assistants',
      'POST /threads',
      'POST /threads/thread_1/messages',
      'POST /threads/thread_1/runs'
    ])
  })

  it('answers get from the log: deletes old output.json files, uploads, cancels and restarts', async () => {
    await compare(
      (s) => {
        s.assistants = [{ id: 'asst_x', name: 'Log Analyzer' }]
        s.files = [
          { id: 'file_old1', filename: 'output.json' },
          { id: 'file_doc', filename: 'notes.txt' },
          { id: 'file_old2', filename: 'output.json' }
        ]
        s.runs = [
          [textEvent('m1', 'Let me look.'), requiresAction('run_1', ['get', '{"message_type":"ATT"}'])],
          [textEvent('m2', 'Attitude is fine.'), imageEvent('file_png'), completed],
          [textEvent('m3', 'Still fine.'), completed]
        ]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.loadLog(logBuffer())
        await side.send('check attitude')
        await side.send('again')
      }
    )
  })

  it('reports no-data, no-log and unsupported calls; a no-data failure drops the attachment', async () => {
    await compare(
      (s) => {
        s.runs = [
          [requiresAction('run_1', ['get', '{"message_type":"ATT"}'])],
          [completed],
          [requiresAction('run_2', ['get', '{"message_type":"NOPE"}'], ['plot', '{}'])],
          [textEvent('m', 'No such message.'), completed],
          [completed]
        ]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.send('before a log')
        await side.loadLog(logBuffer())
        await side.send('missing type')
        await side.send('follow up')
      }
    )
  })

  it('handles a mixed batch and a second round of calls', async () => {
    await compare(
      (s) => {
        s.runs = [
          [
            requiresAction(
              'run_1',
              ['get', '{"message_type":"ATT"}'],
              ['get', '{"message_type":"GPS"}'],
              ['get', '{"message_type":"XXXX"}']
            )
          ],
          [requiresAction('run_2', ['get', '{"message_type":"BARO"}'])],
          [textEvent('m', 'Done'), completed],
          [completed]
        ]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.loadLog(logBuffer())
        await side.send('everything')
        await side.send('and now')
      }
    )
  })

  it('a 401 while connecting shows the 401 line and asks for the key again', async () => {
    await compare(
      (s) => {
        s.failures = [{ method: 'GET', path: /^\/assistants$/, status: 401, message: 'Incorrect API key provided', times: 1 }]
        s.runs = [[textEvent('m', 'ok'), completed]]
      },
      async (side) => {
        await side.submitKey('sk-bad')
        await side.submitKey('sk-good')
        await side.send('hi')
      }
    )
  })

  it('a 401 at send time while creating the thread shows both upstream lines', async () => {
    await compare(
      (s) => {
        // The first thread fails without a 401 (upstream keeps the key), the retry at send time gets a 401.
        s.failures = [
          { method: 'POST', path: /^\/threads$/, status: 400, message: 'Bad request', times: 1 },
          { method: 'POST', path: /^\/threads$/, status: 401, message: 'Incorrect API key provided', times: 1 }
        ]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.send('hi')
      },
      // Upstream's rejection from the first connection attempt was unhandled; the port shows its text.
      [{ at: 0, line: { kind: 'notice', tone: 'error', text: 'Could not create conversation thread' } }]
    )
  })

  it('a failed message post, a failed run and a broken stream show upstream texts', async () => {
    await compare(
      (s) => {
        s.failures = [{ method: 'POST', path: /\/messages$/, status: 400, message: 'Thread is busy', times: 1 }]
        s.runs = [[runFailed], [textEvent('m', 'part'), streamError]]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.send('one')
        await side.send('two')
        await side.send('three')
      }
    )
  })

  it('a chart that cannot be downloaded is reported and streaming continues', async () => {
    await compare(
      (s) => {
        s.failures = [{ method: 'GET', path: /\/content$/, status: 404, message: 'No such file' }]
        s.runs = [[imageEvent('file_gone'), textEvent('m', 'See chart'), completed]]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.send('plot')
      }
    )
  })

  it('updates the assistant, and reports a failed delete', async () => {
    await compare(
      (s) => {
        s.assistants = [{ id: 'asst_x', name: 'Log Analyzer' }]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.updateAssistant()
      }
    )
    await compare(
      (s) => {
        s.assistants = [{ id: 'asst_x', name: 'Log Analyzer' }]
        s.failures = [{ method: 'DELETE', path: /^\/assistants\//, status: 400, message: 'Cannot delete' }]
      },
      async (side) => {
        await side.submitKey('sk-test')
        await side.updateAssistant()
      }
    )
  })
})
