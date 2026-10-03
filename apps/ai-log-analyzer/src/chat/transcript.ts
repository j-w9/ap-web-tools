/**
 * The chat transcript as data, updated by a pure reducer (upstream appended DOM nodes in
 * `addChatMessage`, `showThinkingMessage` and the tool handlers).
 */
import type { ToolResult } from '../analysis/tool-calls.js'
import type { RequestedToolCall } from '../assistant/backend.js'
import type { Notice, NoticeTone } from './turn.js'

export type ToolActivity =
  | { readonly status: 'running' }
  | { readonly status: 'done'; readonly summary: string }
  | { readonly status: 'failed'; readonly message: string }

export type { NoticeTone }

export type ChatEntry =
  | { readonly kind: 'user'; readonly id: number; readonly text: string }
  /** Markdown text streamed from one assistant message. */
  | { readonly kind: 'assistant'; readonly id: number; readonly messageId: string; readonly markdown: string }
  /** Status lines from the page itself (upstream "system" and "error" messages). */
  | {
      readonly kind: 'notice'
      readonly id: number
      readonly tone: NoticeTone
      readonly text: string
      /** The port's explanation, shown under upstream's text. */
      readonly detail: string | null
    }
  /** A function call answered from the log. */
  | {
      readonly kind: 'tool'
      readonly id: number
      readonly callId: string
      readonly name: string
      readonly arguments: string
      readonly activity: ToolActivity
    }

export interface Transcript {
  readonly entries: readonly ChatEntry[]
  readonly nextId: number
}

export type TranscriptAction =
  | { readonly type: 'user'; readonly text: string }
  | { readonly type: 'notice'; readonly notice: Notice }
  | { readonly type: 'text'; readonly messageId: string; readonly delta: string }
  | { readonly type: 'tool-started'; readonly call: RequestedToolCall }
  | { readonly type: 'tool-finished'; readonly callId: string; readonly result: ToolResult }
  | { readonly type: 'clear' }

export const EMPTY_TRANSCRIPT: Transcript = { entries: [], nextId: 1 }

function append(state: Transcript, entry: ChatEntry): Transcript {
  return { entries: [...state.entries, entry], nextId: state.nextId + 1 }
}

function activityOf(result: ToolResult): ToolActivity {
  return result.status === 'data' ? { status: 'done', summary: result.summary } : { status: 'failed', message: result.message }
}

export function transcriptReducer(state: Transcript, action: TranscriptAction): Transcript {
  switch (action.type) {
    case 'user':
      return append(state, { kind: 'user', id: state.nextId, text: action.text })
    case 'notice':
      return append(state, { kind: 'notice', id: state.nextId, ...action.notice })
    case 'text': {
      // Deltas extend the latest entry of the same message; anything in between starts a new bubble.
      const last = state.entries.at(-1)
      if (last?.kind === 'assistant' && last.messageId === action.messageId) {
        return { ...state, entries: [...state.entries.slice(0, -1), { ...last, markdown: last.markdown + action.delta }] }
      }
      return append(state, { kind: 'assistant', id: state.nextId, messageId: action.messageId, markdown: action.delta })
    }
    case 'tool-started':
      return append(state, {
        kind: 'tool',
        id: state.nextId,
        callId: action.call.id,
        name: action.call.name,
        arguments: action.call.arguments,
        activity: { status: 'running' }
      })
    case 'tool-finished':
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === 'tool' && e.callId === action.callId ? { ...e, activity: activityOf(action.result) } : e
        )
      }
    case 'clear':
      return { entries: [], nextId: state.nextId }
  }
}

/**
 * Whether to show the "thinking" indicator: the assistant is busy and has not started writing a
 * reply after the latest user message (upstream showed it until text or an image arrived).
 */
export function isThinking(state: Transcript, busy: boolean): boolean {
  return busy && state.entries.at(-1)?.kind !== 'assistant'
}
