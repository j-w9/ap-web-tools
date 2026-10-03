/**
 * One user turn: send the message, stream the response, answer the assistant's function calls
 * locally and keep streaming until it is done (upstream `processUserMessage`, `handleRunStream`
 * and `handleToolCall`). Framework-free; the UI turns the events into state.
 */
import type { DataflashLog } from '@apwt/dataflash'
import { executeToolCall, type ToolResult } from '../analysis/tool-calls.js'
import {
  BackendError,
  type AssistantBackend,
  type BackendEvent,
  type RequestedToolCall,
  type ToolOutput
} from '../assistant/backend.js'
import { CONNECTED_TEXT, INVALID_KEY_TEXT } from '../assistant/upstream-text.js'

export type NoticeTone = 'info' | 'error'

/** A status line in the chat (upstream `addChatMessage(..., 'system' | 'error')`). */
export interface Notice {
  readonly tone: NoticeTone
  readonly text: string
  /** The port's explanation, shown under upstream's text. */
  readonly detail: string | null
}

export type TurnEvent =
  | { readonly type: 'text'; readonly messageId: string; readonly delta: string }
  | { readonly type: 'image'; readonly fileId: string; readonly image: Blob }
  | { readonly type: 'tool-started'; readonly call: RequestedToolCall }
  | { readonly type: 'tool-finished'; readonly callId: string; readonly result: ToolResult }
  | { readonly type: 'notice'; readonly notice: Notice }
  /** The key was rejected while connecting; ask for a new one (upstream `showApiKeyPrompt`). */
  | { readonly type: 'prompt-key' }

/**
 * What upstream showed for an error, in order: `handleInvalidApiKey`'s line when the key was
 * rejected while connecting, then the error's own text.
 */
export function errorEvents(error: BackendError): TurnEvent[] {
  const own: TurnEvent = { type: 'notice', notice: { tone: 'error', text: error.message, detail: error.detail } }
  if (!error.promptForKey) return [own]
  return [{ type: 'notice', notice: { tone: 'error', text: INVALID_KEY_TEXT, detail: null } }, { type: 'prompt-key' }, own]
}

export const connectedNotice: Notice = { tone: 'info', text: CONNECTED_TEXT, detail: null }

/**
 * Run one turn. Never throws: failures are reported as notices.
 *
 * @param getLog Read when a call is answered, so a log opened mid-turn is used, as upstream did.
 */
export async function runTurn(
  backend: AssistantBackend,
  text: string,
  getLog: () => DataflashLog | null,
  emit: (event: TurnEvent) => void
): Promise<void> {
  const report = (error: BackendError) => errorEvents(error).forEach(emit)
  try {
    let stream: AsyncIterable<BackendEvent> = backend.sendMessage(text)
    for (;;) {
      let pending: { runId: string; calls: readonly RequestedToolCall[] } | null = null
      for await (const event of stream) {
        switch (event.type) {
          case 'connected':
            emit({ type: 'notice', notice: connectedNotice })
            break
          case 'text':
            emit({ type: 'text', messageId: event.messageId, delta: event.delta })
            break
          case 'image':
            emit({ type: 'image', fileId: event.fileId, image: event.image })
            break
          case 'image-error':
          case 'failed':
            report(event.error)
            break
          case 'tool-calls':
            pending = { runId: event.runId, calls: event.calls }
            break
        }
      }
      if (pending === null) return
      const outputs: ToolOutput[] = pending.calls.map((call) => {
        emit({ type: 'tool-started', call })
        const result = executeToolCall(call.name, call.arguments, getLog())
        emit({ type: 'tool-finished', callId: call.id, result })
        return { callId: call.id, result }
      })
      stream = backend.submitToolOutputs(pending.runId, outputs)
    }
  } catch (error) {
    report(
      error instanceof BackendError ? error : new BackendError('unknown', error instanceof Error ? error.message : String(error))
    )
  }
}
