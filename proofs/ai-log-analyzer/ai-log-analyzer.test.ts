/**
 * Reproductions of the AI Log Analyzer rows of docs/upstream-bugs.md against the original
 * logAnalyzer.js. Verdicts: docs/bug-proofs/ai-log-analyzer.md. No request leaves the process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeOpenAiServer,
  UpstreamAnalyzer,
  completed,
  fixtureLog,
  loadUpstreamParser,
  requiresAction,
  settle,
  textEvent,
  type Json,
  type UpstreamParser,
  type UpstreamParserCtor
} from './_harness.js'

let Parser: UpstreamParserCtor
beforeAll(async () => {
  Parser = await loadUpstreamParser()
})

// Upstream calls async functions without awaiting or catching them; their rejections are collected
// here so they can be asserted instead of failing the run.
const rejections: string[] = []
const onUnhandled = (reason: unknown) => {
  // Errors from the vm realm are not instances of this realm's Error, so read the text.
  rejections.push(String(reason).replace(/^Error: /, ''))
}
process.on('unhandledRejection', onUnhandled)
afterAll(() => {
  process.off('unhandledRejection', onUnhandled)
})
beforeEach(() => {
  rejections.length = 0
})

const CONNECTED = 'Connected to AI assistant! Upload a log file or ask a question about drone flight analysis.'

async function connected(setup: (s: FakeOpenAiServer) => void = () => undefined) {
  const server = new FakeOpenAiServer()
  server.assistants = [{ id: 'asst_x', name: 'Log Analyzer' }]
  setup(server)
  const app = new UpstreamAnalyzer(server, Parser)
  await app.submitKey('sk-test')
  return { server, app }
}

/** The text of the single output.json upload in the request log. */
function uploadedText(server: FakeOpenAiServer): string {
  const [body] = server.bodies('POST', /^\/files$/) as { file: { text: string } }[]
  if (!body) throw new Error('no upload')
  return body.file.text
}

describe('AI Log Analyzer upstream rows', () => {
  it('#132 get("IMU") uploads only the last instance', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"IMU"}'])], [completed]]
    })
    await app.loadLog(fixtureLog())
    await app.send('imu')
    const log = app.evaluate('log') as UpstreamParser
    expect(Object.keys(log.messageTypes['IMU']?.instances ?? {})).toEqual(['0', '1'])
    // The file is exactly instance 1; instance 0 is not in it.
    expect(uploadedText(server)).toBe(JSON.stringify(log.get_instance('IMU', '1')))
    expect(uploadedText(server)).not.toBe(JSON.stringify(log.get_instance('IMU', '0')))
    const uploaded = JSON.parse(uploadedText(server)) as { I: Record<string, number> }
    expect(new Set(Object.values(uploaded.I))).toEqual(new Set([1]))
  })

  it('#133 numeric columns are uploaded as index-keyed objects', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"IMU"}'])], [completed]]
    })
    await app.loadLog(fixtureLog())
    await app.send('imu')
    const uploaded = JSON.parse(uploadedText(server)) as Record<string, Json>
    const timeUs = uploaded['TimeUS']
    expect(Array.isArray(timeUs)).toBe(false)
    expect(uploadedText(server).startsWith('{"TimeUS":{"0":2479841,"1":2679761,')).toBe(true)
  })

  it('#134 a no-data failure drops the remembered file from later messages', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [
        [requiresAction('run_1', ['get', '{"message_type":"ATT"}'])],
        [completed],
        [requiresAction('run_2', ['get', '{"message_type":"NOPE"}'])],
        [completed],
        [completed]
      ]
    })
    await app.loadLog(fixtureLog())
    await app.send('attitude')
    await app.send('missing type')
    await app.send('follow up')
    const messages = server.bodies('POST', /\/messages$/) as Record<string, Json>[]
    expect(messages.map((m) => m['attachments'] ?? null)).toEqual([
      null,
      [{ file_id: 'file_1', tools: [{ type: 'code_interpreter' }] }],
      [{ file_id: 'file_1', tools: [{ type: 'code_interpreter' }] }],
      // 'follow up': no attachments although file_1 is still on the account
      null
    ])
    expect(server.files).toEqual([{ id: 'file_1', filename: 'output.json' }])
    expect(app.evaluate('fileId')).toBeUndefined()
  })

  it('#135 a successful call in a mixed batch is submitted without output', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'], ['get', '{"message_type":"NOPE"}'])], [completed]]
    })
    await app.loadLog(fixtureLog())
    await app.send('both')
    expect(server.bodies('POST', /submit_tool_outputs$/)).toEqual([
      {
        tool_outputs: [
          { tool_call_id: 'call_0' },
          { tool_call_id: 'call_1', output: 'failure, requested message type does not exist in message types' }
        ],
        stream: true
      }
    ])
    // ATT was uploaded as file_1, which no request mentions afterwards.
    expect(server.files).toEqual([{ id: 'file_1', filename: 'output.json' }])
    const after = server.log.slice(server.log.findIndex((r) => r.method === 'POST' && r.path === '/files') + 1)
    expect(JSON.stringify(after)).not.toContain('file_1')
  })

  it('#136 the message is posted right after the cancel request, without checking the run', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'])], [completed]]
    })
    await app.loadLog(fixtureLog())
    await app.send('attitude')
    expect(server.lines().slice(-5)).toEqual([
      'GET /files',
      'POST /files',
      'POST /threads/thread_1/runs/run_1/cancel',
      'POST /threads/thread_1/messages',
      'POST /threads/thread_1/runs'
    ])
  })

  it('#137 a .log file is reported ready but never read', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'])], [completed]]
    })
    const handleFileUpload = app.evaluate('handleFileUpload') as (e: unknown) => Promise<void>
    await handleFileUpload({ target: { files: [{ name: 'flight.log' }] } })
    expect(app.el('label').textContent).toBe('Selected: flight.log')
    expect(app.chat()).toEqual([
      { kind: 'notice', tone: 'info', text: CONNECTED },
      { kind: 'notice', tone: 'info', text: 'Processing flight.log...' }
    ])
    const summary = app
      .el('vizArea')
      .descendants()
      .find((e) => e.id === 'summary-section')
    expect(summary?.children.map((c) => c.textContent)).toEqual(['Summary', 'Log File Ready'])
    expect(app.evaluate('log')).toBeUndefined()
    await app.send('attitude')
    expect(server.bodies('POST', /submit_tool_outputs$/)).toEqual([
      { tool_outputs: [{ tool_call_id: 'call_0', output: 'failure, user did not upload logs file' }], stream: true }
    ])
  })

  it('#137 a .log file chosen after a .bin leaves the earlier log in use', async () => {
    const { server, app } = await connected((s) => {
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'])], [completed]]
    })
    await app.loadLog(fixtureLog())
    const handleFileUpload = app.evaluate('handleFileUpload') as (e: unknown) => Promise<void>
    await handleFileUpload({ target: { files: [{ name: 'other.log' }] } })
    expect(app.el('label').textContent).toBe('Selected: other.log')
    await app.send('attitude')
    // The ATT data uploaded is the earlier .bin's.
    const log = app.evaluate('log') as { get(name: string): unknown }
    expect(uploadedText(server)).toBe(JSON.stringify(log.get('ATT')))
  })

  it('#138 every output.json is deleted, without waiting, twice in a batch', async () => {
    const { server, app } = await connected((s) => {
      s.files = [
        { id: 'file_other', filename: 'output.json' },
        { id: 'file_doc', filename: 'notes.txt' }
      ]
      s.holdDeletes = true
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'], ['get', '{"message_type":"GPS"}'])], [completed]]
    })
    await app.loadLog(fixtureLog())
    await app.send('both')
    // No delete ever answers, yet both uploads and the restarted run go ahead.
    expect(server.lines().slice(-9)).toEqual([
      'DELETE /files/file_other',
      'POST /files',
      'GET /files',
      'DELETE /files/file_other',
      'DELETE /files/file_1',
      'POST /files',
      'POST /threads/thread_1/runs/run_1/cancel',
      'POST /threads/thread_1/messages',
      'POST /threads/thread_1/runs'
    ])
    expect(server.lines().filter((l) => l.startsWith('DELETE'))).toEqual([
      'DELETE /files/file_other',
      'DELETE /files/file_other',
      'DELETE /files/file_1'
    ])
  })

  it('#139 a 401 after connecting shows the generic error and asks for no key', async () => {
    const { app } = await connected((s) => {
      s.failures = [{ method: 'POST', path: /\/messages$/, status: 401, message: 'Incorrect API key provided' }]
    })
    expect(app.prompts).toBe(1)
    await app.send('one')
    await app.send('two')
    expect(app.chat()).toEqual([
      { kind: 'notice', tone: 'info', text: CONNECTED },
      { kind: 'user', text: 'one' },
      { kind: 'notice', tone: 'error', text: 'Sorry, there was an error processing your message. Please try again.' },
      { kind: 'user', text: 'two' },
      { kind: 'notice', tone: 'error', text: 'Sorry, there was an error processing your message. Please try again.' }
    ])
    expect(app.prompts).toBe(1)
  })

  it('#140 an error in the tool handler is an unhandled rejection and nothing is shown', async () => {
    const { server, app } = await connected((s) => {
      s.failures = [{ method: 'GET', path: /^\/files$/, status: 500, message: 'Server error' }]
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'])]]
    })
    await app.loadLog(fixtureLog())
    await app.send('attitude')
    expect(rejections).toEqual(['500 Server error'])
    expect(app.chat()).toEqual([
      { kind: 'notice', tone: 'info', text: CONNECTED },
      { kind: 'user', text: 'attitude' }
    ])
    expect(app.thinking()).toBe(false)
    expect(server.lines().some((l) => l.includes('submit_tool_outputs') || l.includes('cancel'))).toBe(false)
  })

  it('#140 a failed first connection is an unhandled rejection and nothing is shown', async () => {
    const server = new FakeOpenAiServer()
    server.failures = [{ method: 'GET', path: /^\/assistants$/, status: 500, message: 'Server error' }]
    const app = new UpstreamAnalyzer(server, Parser)
    await app.submitKey('sk-test')
    expect(rejections).toEqual(['Could not initialize assistant'])
    expect(app.chat()).toEqual([])
    expect(app.el('messageInput').disabled).toBe(false)
  })

  it('#141 input is re-enabled while the tool data is still being prepared', async () => {
    let release: () => void = () => undefined
    const { server, app } = await connected((s) => {
      s.holdFilesList = new Promise((r) => {
        release = r
      })
      s.runs = [[requiresAction('run_1', ['get', '{"message_type":"ATT"}'])], [completed], [completed]]
    })
    await app.loadLog(fixtureLog())
    await app.send('attitude')
    // handleToolCall is waiting on files.list; the turn is shown as finished.
    expect(app.evaluate('isProcessing')).toBe(false)
    expect(app.el('messageInput').disabled).toBe(false)
    expect(app.el('messageInput').placeholder).toBe('Ask about your flight data...')
    expect(app.thinking()).toBe(false)
    // A message sent now is posted while run_1 still waits for its tool output.
    await app.send('meanwhile')
    release()
    await settle()
    expect(server.lines().slice(-8)).toEqual([
      'POST /threads/thread_1/runs',
      'POST /threads/thread_1/messages',
      'POST /threads/thread_1/runs',
      'GET /files',
      'POST /files',
      'POST /threads/thread_1/runs/run_1/cancel',
      'POST /threads/thread_1/messages',
      'POST /threads/thread_1/runs'
    ])
  })

  it('#142 two assistant messages run together; a delta without a value shows "undefined"', async () => {
    const { app } = await connected((s) => {
      s.runs = [
        [textEvent('m1', { value: 'Let me look.' }), requiresAction('run_1', ['get', '{"message_type":"ATT"}'])],
        [textEvent('m2', { value: 'Attitude is fine.' }), completed],
        [textEvent('m3', {}), textEvent('m3', { value: 'Hi' }), completed]
      ]
    })
    await app.loadLog(fixtureLog())
    await app.send('attitude')
    await app.send('hello')
    expect(app.chat()).toEqual([
      { kind: 'notice', tone: 'info', text: CONNECTED },
      { kind: 'user', text: 'attitude' },
      { kind: 'assistant', text: 'Let me look.Attitude is fine.' },
      { kind: 'user', text: 'hello' },
      { kind: 'assistant', text: 'undefinedHi' }
    ])
  })
})
