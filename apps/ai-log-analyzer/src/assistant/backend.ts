/**
 * Provider-neutral contract between the chat and an AI assistant service.
 *
 * Upstream talked to the OpenAI Assistants API directly from its UI code. The calls are isolated
 * here so the page does not depend on that API's shape: the OpenAI SDK marks the Assistants API as
 * deprecated in favour of the Responses API, and another backend can implement this interface
 * without touching the chat or the tool handlers.
 */
import type { ToolResult } from '../analysis/tool-calls.js'

/** A function call the assistant wants answered before it can continue. */
export interface RequestedToolCall {
  /** Provider id used to match the output to the call. */
  readonly id: string
  readonly name: string
  /** Arguments as the raw JSON text the model produced; validated by the tool handlers. */
  readonly arguments: string
}

/** Something the assistant produced while answering. */
export type BackendEvent =
  /** A new conversation was opened for this message (upstream announced every new thread). */
  | { readonly type: 'connected' }
  /** Streamed text; deltas with the same `messageId` belong to one assistant message. */
  | { readonly type: 'text'; readonly messageId: string; readonly delta: string }
  /** An image the assistant generated (a code interpreter plot). */
  | { readonly type: 'image'; readonly fileId: string; readonly image: Blob }
  /** An image was announced but could not be downloaded. */
  | { readonly type: 'image-error'; readonly error: BackendError }
  /** The assistant paused for function calls; answer them with `submitToolOutputs`. */
  | { readonly type: 'tool-calls'; readonly runId: string; readonly calls: readonly RequestedToolCall[] }
  /** The assistant gave up on this request. */
  | { readonly type: 'failed'; readonly error: BackendError }

/** The answer to one requested call. */
export interface ToolOutput {
  readonly callId: string
  readonly result: ToolResult
}

/** Closed set of failure kinds the UI explains differently. */
export type BackendErrorKind = 'auth' | 'rate-limit' | 'quota' | 'network' | 'api' | 'unknown'

export interface BackendErrorOptions {
  /** The port's explanation of the cause, shown under the message (upstream showed only the message). */
  readonly detail?: string | null
  /**
   * Upstream `handleInvalidApiKey` ran: the key was rejected while connecting, the session was
   * reset and the key is asked for again ("Invalid OpenAI API key (401). Please enter a valid key.").
   */
  readonly promptForKey?: boolean
}

/**
 * An error from the assistant service. `message` is the text upstream showed at the point the
 * error happened (or, where upstream showed nothing, the port's text).
 */
export class BackendError extends Error {
  override readonly name = 'BackendError'
  readonly detail: string | null
  readonly promptForKey: boolean
  constructor(
    readonly kind: BackendErrorKind,
    message: string,
    options: BackendErrorOptions = {}
  ) {
    super(message)
    this.detail = options.detail ?? null
    this.promptForKey = options.promptForKey ?? false
  }
}

export interface AssistantBackend {
  /**
   * Find or create the assistant and start a conversation (upstream `connectIfNeeded`). Resolves to
   * whether a new conversation was opened.
   */
  connect(): Promise<boolean>
  /** Post a user message and stream the assistant's response. */
  sendMessage(text: string): AsyncIterable<BackendEvent>
  /** Answer the calls of a `tool-calls` event and stream the rest of the response. */
  submitToolOutputs(runId: string, outputs: readonly ToolOutput[]): AsyncIterable<BackendEvent>
  /** Forget the conversation so the next message starts a new one. */
  newConversation(): Promise<void>
  /**
   * Recreate the assistant from the current instructions and tools, then start a new conversation.
   * Resolves to false, doing nothing, when no assistant has been found or created yet (upstream's
   * Update Assistant button did nothing then).
   */
  recreateAssistant(): Promise<boolean>
}

/** Anything thrown as a {@link BackendError}; backends throw these already, so this only wraps surprises. */
export function asBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error
  return new BackendError('unknown', error instanceof Error ? error.message : String(error))
}
