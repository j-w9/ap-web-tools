import { describe, expect, it } from 'vitest'
import { EMPTY_TRANSCRIPT, isThinking, transcriptReducer, type Transcript, type TranscriptAction } from './transcript.js'

const run = (...actions: TranscriptAction[]): Transcript => actions.reduce(transcriptReducer, EMPTY_TRANSCRIPT)

describe('transcriptReducer', () => {
  it('appends user messages and notices with increasing ids', () => {
    const t = run({ type: 'user', text: 'hi' }, { type: 'notice', notice: { tone: 'error', text: 'oops', detail: null } })
    expect(t.entries).toEqual([
      { kind: 'user', id: 1, text: 'hi' },
      { kind: 'notice', id: 2, tone: 'error', text: 'oops', detail: null }
    ])
  })

  it('joins streamed deltas of one message and splits different messages', () => {
    const t = run(
      { type: 'text', messageId: 'a', delta: 'Hel' },
      { type: 'text', messageId: 'a', delta: 'lo' },
      { type: 'text', messageId: 'b', delta: 'Next' }
    )
    expect(t.entries).toEqual([
      { kind: 'assistant', id: 1, messageId: 'a', markdown: 'Hello' },
      { kind: 'assistant', id: 2, messageId: 'b', markdown: 'Next' }
    ])
  })

  it('starts a new bubble when something comes between deltas of one message', () => {
    const t = run(
      { type: 'text', messageId: 'a', delta: 'one' },
      { type: 'notice', notice: { tone: 'info', text: 'between', detail: null } },
      { type: 'text', messageId: 'a', delta: 'two' }
    )
    expect(t.entries.map((e) => e.kind)).toEqual(['assistant', 'notice', 'assistant'])
  })

  it('tracks tool activity from start to result', () => {
    const call = { id: 'c1', name: 'get', arguments: '{"message_type":"GPS"}' }
    const started = run({ type: 'tool-started', call })
    expect(started.entries[0]).toMatchObject({ kind: 'tool', callId: 'c1', activity: { status: 'running' } })
    const done = transcriptReducer(started, {
      type: 'tool-finished',
      callId: 'c1',
      result: { status: 'data', json: '{}', summary: 'GPS: 1 records' }
    })
    expect(done.entries[0]).toMatchObject({ activity: { status: 'done', summary: 'GPS: 1 records' } })
    const failed = transcriptReducer(started, {
      type: 'tool-finished',
      callId: 'c1',
      result: { status: 'failure', reason: 'no-log', message: 'no log' }
    })
    expect(failed.entries[0]).toMatchObject({ activity: { status: 'failed', message: 'no log' } })
  })

  it('clears entries but keeps ids unique', () => {
    const t = run({ type: 'user', text: 'a' }, { type: 'clear' }, { type: 'user', text: 'b' })
    expect(t.entries).toEqual([{ kind: 'user', id: 2, text: 'b' }])
  })
})

describe('isThinking', () => {
  it('shows while busy until the reply starts', () => {
    const asked = run({ type: 'user', text: 'q' })
    expect(isThinking(asked, true)).toBe(true)
    expect(isThinking(asked, false)).toBe(false)
    const replying = transcriptReducer(asked, { type: 'text', messageId: 'm', delta: 'a' })
    expect(isThinking(replying, true)).toBe(false)
    const tool = transcriptReducer(replying, { type: 'tool-started', call: { id: 'c', name: 'get', arguments: '{}' } })
    expect(isThinking(tool, true)).toBe(true)
  })
})
