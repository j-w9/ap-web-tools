import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { buildSyntheticLog } from '@apwt/dataflash/testing'
import { BackendError, type AssistantBackend, type BackendEvent, type ToolOutput } from '../assistant/backend.js'
import { runTurn, type TurnEvent } from './turn.js'

const log = DataflashLog.parse(buildSyntheticLog())

async function* iterate(items: readonly BackendEvent[], thenThrow?: Error): AsyncGenerator<BackendEvent> {
  for (const item of items) {
    await Promise.resolve()
    yield item
  }
  if (thenThrow !== undefined) throw thenThrow
}

/** Backend that replays one scripted stream per request and records submitted outputs. */
class ScriptedBackend implements AssistantBackend {
  sent: string[] = []
  submitted: { runId: string; outputs: readonly ToolOutput[] }[] = []
  constructor(
    private readonly streams: (readonly BackendEvent[])[],
    private readonly failure?: Error
  ) {}
  connect() {
    return Promise.resolve()
  }
  sendMessage(text: string) {
    this.sent.push(text)
    return this.next()
  }
  submitToolOutputs(runId: string, outputs: readonly ToolOutput[]) {
    this.submitted.push({ runId, outputs })
    return this.next()
  }
  private next() {
    const stream = this.streams.shift()
    return iterate(stream ?? [], stream === undefined || this.streams.length > 0 ? undefined : this.failure)
  }
  newConversation() {
    return Promise.resolve()
  }
  recreateAssistant() {
    return Promise.resolve()
  }
}

async function turn(backend: AssistantBackend, getLog: () => DataflashLog | null = () => log): Promise<TurnEvent[]> {
  const events: TurnEvent[] = []
  await runTurn(backend, 'question', getLog, (e) => events.push(e))
  return events
}

const toolCalls = (runId: string, ...names: [string, string][]): BackendEvent => ({
  type: 'tool-calls',
  runId,
  calls: names.map(([name, args], i) => ({ id: `call_${i}`, name, arguments: args }))
})

describe('runTurn', () => {
  it('streams text and images through', async () => {
    const image = new Blob(['x'])
    const backend = new ScriptedBackend([
      [
        { type: 'text', messageId: 'm', delta: 'Hi' },
        { type: 'image', fileId: 'f', image }
      ]
    ])
    expect(await turn(backend)).toEqual([
      { type: 'text', messageId: 'm', delta: 'Hi' },
      { type: 'image', fileId: 'f', image }
    ])
    expect(backend.sent).toEqual(['question'])
  })

  it('answers tool calls from the log and continues with the outputs', async () => {
    const backend = new ScriptedBackend([
      [toolCalls('run_1', ['get', '{"message_type":"ATT"}'], ['get', '{"message_type":"NOPE"}'])],
      [{ type: 'text', messageId: 'm2', delta: 'Done' }]
    ])
    const events = await turn(backend)
    expect(events.map((e) => e.type)).toEqual(['tool-started', 'tool-finished', 'tool-started', 'tool-finished', 'text'])
    expect(backend.submitted).toHaveLength(1)
    const [first, second] = backend.submitted[0]!.outputs
    expect(backend.submitted[0]!.runId).toBe('run_1')
    expect(first).toMatchObject({ callId: 'call_0', result: { status: 'data', summary: 'ATT: 25 records, 9 fields' } })
    expect(second).toMatchObject({ callId: 'call_1', result: { status: 'failure', reason: 'no-data' } })
  })

  it('reads the log when the call is answered', async () => {
    let current: DataflashLog | null = null
    const backend = new ScriptedBackend([[toolCalls('r', ['get', '{"message_type":"ATT"}'])], []])
    const pending = turn(backend, () => current)
    current = log
    await pending
    expect(backend.submitted[0]!.outputs[0]!.result.status).toBe('data')
  })

  it('reports a missing log to the assistant', async () => {
    const backend = new ScriptedBackend([[toolCalls('r', ['get', '{"message_type":"ATT"}'])], []])
    await turn(backend, () => null)
    expect(backend.submitted[0]!.outputs[0]!.result).toMatchObject({ status: 'failure', reason: 'no-log' })
  })

  it('reports failed runs and image errors as errors', async () => {
    const failed = new BackendError('rate-limit', 'slow down')
    const backend = new ScriptedBackend([
      [
        { type: 'image-error', message: 'no image' },
        { type: 'failed', error: failed }
      ]
    ])
    const events = await turn(backend)
    expect(events).toEqual([
      { type: 'error', error: new BackendError('api', 'no image') },
      { type: 'error', error: failed }
    ])
  })

  it('turns thrown errors into an error event instead of rejecting', async () => {
    const backend = new ScriptedBackend(
      [[{ type: 'text', messageId: 'm', delta: 'partial' }]],
      new BackendError('network', 'offline')
    )
    const events = await turn(backend)
    expect(events.at(-1)).toEqual({ type: 'error', error: new BackendError('network', 'offline') })
    const plain = await turn(new ScriptedBackend([[]], new Error('boom')))
    expect(plain).toEqual([{ type: 'error', error: new BackendError('unknown', 'boom') }])
  })

  it('passes crashed calls to the backend, which reports them', async () => {
    const backend = new ScriptedBackend([[toolCalls('r', ['get', 'not json'])], []])
    await turn(backend)
    expect(backend.submitted[0]!.outputs[0]!.result.status).toBe('crash')
  })
})
