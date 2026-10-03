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

export type TurnEvent =
  | { readonly type: 'text'; readonly messageId: string; readonly delta: string }
  | { readonly type: 'image'; readonly fileId: string; readonly image: Blob }
  | { readonly type: 'tool-started'; readonly call: RequestedToolCall }
  | { readonly type: 'tool-finished'; readonly callId: string; readonly result: ToolResult }
  | { readonly type: 'error'; readonly error: BackendError }

/**
 * Run one turn. Never throws: failures are reported as `error` events.
 *
 * @param getLog Read when a call is answered, so a log opened mid-turn is used, as upstream did.
 */
export async function runTurn(
  backend: AssistantBackend,
  text: string,
  getLog: () => DataflashLog | null,
  emit: (event: TurnEvent) => void
): Promise<void> {
  try {
    let stream: AsyncIterable<BackendEvent> = backend.sendMessage(text)
    for (;;) {
      let pending: { runId: string; calls: readonly RequestedToolCall[] } | null = null
      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            emit({ type: 'text', messageId: event.messageId, delta: event.delta })
            break
          case 'image':
            emit({ type: 'image', fileId: event.fileId, image: event.image })
            break
          case 'image-error':
            emit({ type: 'error', error: new BackendError('api', event.message) })
            break
          case 'tool-calls':
            pending = { runId: event.runId, calls: event.calls }
            break
          case 'failed':
            emit({ type: 'error', error: event.error })
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
    emit({
      type: 'error',
      error:
        error instanceof BackendError
          ? error
          : new BackendError('unknown', error instanceof Error ? error.message : String(error))
    })
  }
}
