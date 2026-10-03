/**
 * {@link AssistantBackend} on the OpenAI Assistants API, as upstream logAnalyzer.js used it.
 *
 * Status: the installed `openai` SDK (v7) still ships `client.beta.assistants`/`threads` but marks
 * them `@deprecated` in favour of the Responses API. This file is the only place that knows about
 * assistants, threads and runs; a Responses API backend can replace it behind the same interface.
 *
 * The API key is passed straight to the SDK client, which sends it only to api.openai.com. It is
 * never stored (no localStorage) or logged.
 */
import OpenAI, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from 'openai'
import type { AssistantStreamEvent, AssistantTool } from 'openai/resources/beta/assistants'
import type { MessageCreateParams } from 'openai/resources/beta/threads/messages'
import type { RunSubmitToolOutputsParams } from 'openai/resources/beta/threads/runs/runs'
import { OUTPUT_FILE_NAME } from '../analysis/tool-calls.js'
import { ASSISTANT_TOOLS } from '../analysis/tool-definitions.js'
import { BackendError, type AssistantBackend, type BackendErrorKind, type BackendEvent, type ToolOutput } from './backend.js'
import instructions from './instructions.txt?raw'
import {
  MESSAGE_FAILED_TEXT,
  REQUEST_FAILED_TEXT,
  SESSION_TEXT,
  imageFailedText,
  streamFailedText,
  updateFailedText,
  upstreamMessage
} from './upstream-text.js'

/** Upstream `TARGET_ASSISTANT_NAME`: an existing assistant with this name is reused. */
export const ASSISTANT_NAME = 'Log Analyzer'
/** Upstream `TARGET_ASSISTANT_MODEL`. */
export const ASSISTANT_MODEL = 'gpt-4o'

/** Tools sent when creating the assistant; `satisfies` checks the ported table against the SDK. */
const TOOLS: AssistantTool[] = [...(ASSISTANT_TOOLS satisfies readonly AssistantTool[])]

export interface AssistantConfig {
  readonly name: string
  readonly model: string
  readonly instructions: string
  readonly tools: AssistantTool[]
}

export const ASSISTANT_CONFIG: AssistantConfig = {
  name: ASSISTANT_NAME,
  model: ASSISTANT_MODEL,
  instructions,
  tools: TOOLS
}

/**
 * The OpenAI calls the backend makes, narrowed to what it needs. Production code adapts the SDK
 * client with {@link openAiAssistantsApi}; tests pass a fake.
 */
export interface AssistantsApi {
  listAssistants(): Promise<readonly { readonly id: string; readonly name: string | null }[]>
  createAssistant(config: AssistantConfig): Promise<{ readonly id: string }>
  deleteAssistant(id: string): Promise<void>
  createThread(): Promise<{ readonly id: string }>
  createMessage(threadId: string, message: MessageCreateParams): Promise<void>
  streamRun(threadId: string, assistantId: string): Promise<AsyncIterable<AssistantStreamEvent>>
  submitToolOutputs(
    threadId: string,
    runId: string,
    outputs: RunSubmitToolOutputsParams.ToolOutput[]
  ): Promise<AsyncIterable<AssistantStreamEvent>>
  cancelRun(threadId: string, runId: string): Promise<void>
  listFiles(): Promise<readonly { readonly id: string; readonly filename: string }[]>
  deleteFile(id: string): Promise<void>
  uploadFile(file: File): Promise<{ readonly id: string }>
  fileContent(id: string): Promise<Blob>
}

/**
 * Adapt the OpenAI SDK, using the same browser opt-in upstream used. `fetch` is only for tests,
 * which must never reach the real API.
 */
/* eslint-disable @typescript-eslint/no-deprecated -- the Assistants API is deprecated but still served; this adapter is the one place that calls it (see file header). */
export function openAiAssistantsApi(apiKey: string, fetch?: typeof globalThis.fetch): AssistantsApi {
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, ...(fetch && { fetch }) })
  const { assistants, threads } = client.beta
  return {
    listAssistants: async () => (await assistants.list({ order: 'desc', limit: 100 })).data,
    createAssistant: (config) => assistants.create({ ...config }),
    deleteAssistant: async (id) => {
      await assistants.delete(id)
    },
    createThread: () => threads.create(),
    createMessage: async (threadId, message) => {
      await threads.messages.create(threadId, message)
    },
    streamRun: (threadId, assistantId) => threads.runs.create(threadId, { assistant_id: assistantId, stream: true }),
    submitToolOutputs: (threadId, runId, outputs) =>
      threads.runs.submitToolOutputs(runId, { thread_id: threadId, tool_outputs: outputs, stream: true }),
    cancelRun: async (threadId, runId) => {
      await threads.runs.cancel(runId, { thread_id: threadId })
    },
    listFiles: async () => (await client.files.list()).data,
    deleteFile: async (id) => {
      await client.files.delete(id)
    },
    uploadFile: (file) => client.files.create({ file, purpose: 'assistants' }),
    fileContent: async (id) => (await client.files.content(id)).blob()
  }
}
/* eslint-enable @typescript-eslint/no-deprecated */

// ------------------------------------------------------------------------------------- errors

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>)[key] : undefined
}

/** Upstream `isUnauthorizedError`, check for check. */
export function isUnauthorizedError(error: unknown): boolean {
  const message = field(error, 'message')
  const text = String(error)
  return (
    field(error, 'status') === 401 ||
    field(field(error, 'response'), 'status') === 401 ||
    field(error, 'code') === 401 ||
    (field(field(error, 'error'), 'type') === 'invalid_request_error' &&
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- upstream's RegExp.test converts any value this way
      /unauthorized|invalid api key/i.test(message ? String(message) : '')) ||
    (/401/.test(text) && /unauthorized|invalid api key/i.test(text))
  )
}

/** The port's explanation of an SDK error, shown under upstream's message. Never includes the key. */
export function classifyError(error: unknown): { readonly kind: BackendErrorKind; readonly detail: string | null } {
  if (error instanceof BackendError) return { kind: error.kind, detail: error.detail }
  if (error instanceof AuthenticationError) {
    return { kind: 'auth', detail: 'OpenAI rejected the API key (401). Check that it is correct and active, then connect again.' }
  }
  if (error instanceof RateLimitError) {
    return error.code === 'insufficient_quota'
      ? {
          kind: 'quota',
          detail: 'Your OpenAI account has no quota left (429). Check your plan and billing on platform.openai.com.'
        }
      : { kind: 'rate-limit', detail: 'OpenAI rate limit reached (429). Wait a moment, then try again.' }
  }
  if (error instanceof APIConnectionError) {
    return { kind: 'network', detail: 'Could not reach OpenAI. Check your internet connection, then try again.' }
  }
  if (error instanceof APIError) return { kind: 'api', detail: null }
  return { kind: 'unknown', detail: null }
}

/** A {@link BackendError} with `message`, classified from the original `error`. */
function failure(error: unknown, message: string): BackendError {
  const { kind, detail } = classifyError(error)
  return new BackendError(kind, message, { detail, promptForKey: error instanceof BackendError && error.promptForKey })
}

/** Any thrown value as a {@link BackendError}; its message is upstream's `error.message`. */
export function toBackendError(error: unknown): BackendError {
  return error instanceof BackendError ? error : failure(error, upstreamMessage(error))
}

/** The port's explanation of a `thread.run.failed` event (upstream showed only its fixed text). */
export function runFailureDetail(lastError: { readonly code: string; readonly message: string } | null): {
  readonly kind: BackendErrorKind
  readonly detail: string
} {
  if (lastError === null) return { kind: 'api', detail: 'The assistant could not finish this request.' }
  if (lastError.code === 'rate_limit_exceeded') {
    return /quota/i.test(lastError.message)
      ? { kind: 'quota', detail: `Your OpenAI account has no quota left: ${lastError.message}` }
      : { kind: 'rate-limit', detail: `OpenAI rate limit reached: ${lastError.message}` }
  }
  return { kind: 'api', detail: `The assistant could not finish this request: ${lastError.message}` }
}

/** Errors the port reports where upstream threw inside its unawaited tool handler. */
function toolFlowFailure(error: unknown): BackendError {
  return failure(error, `The assistant's function call could not be handled: ${upstreamMessage(error)}`)
}

// ------------------------------------------------------------------------------------- stream

/**
 * Turn the Assistants event stream into {@link BackendEvent}s (upstream `handleRunStream`).
 * Images from the code interpreter are downloaded with `fetchImage` as they arrive.
 */
export async function* mapRunStream(
  events: AsyncIterable<AssistantStreamEvent>,
  fetchImage: (fileId: string) => Promise<Blob>
): AsyncGenerator<BackendEvent> {
  for await (const event of events) {
    switch (event.event) {
      case 'thread.message.delta':
        for (const item of event.data.delta.content ?? []) {
          if (item.type === 'text') {
            const delta = item.text?.value
            if (delta !== undefined && delta !== '') yield { type: 'text', messageId: event.data.id, delta }
          } else if (item.type === 'image_file' && item.image_file) {
            // Upstream requested `files.content(file_id)` even when the id was missing.
            const fileId = String(item.image_file.file_id)
            try {
              yield { type: 'image', fileId, image: await fetchImage(fileId) }
            } catch (error) {
              yield { type: 'image-error', error: failure(error, imageFailedText(upstreamMessage(error))) }
            }
          }
        }
        break
      case 'thread.run.requires_action': {
        const calls = event.data.required_action?.submit_tool_outputs.tool_calls
        if (calls === undefined) {
          // Upstream threw "passed event does not require action" in its unawaited tool handler.
          yield { type: 'failed', error: new BackendError('api', 'passed event does not require action') }
          break
        }
        yield {
          type: 'tool-calls',
          runId: event.data.id,
          calls: calls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }))
        }
        break
      }
      case 'thread.run.failed': {
        const { kind, detail } = runFailureDetail(event.data.last_error)
        yield { type: 'failed', error: new BackendError(kind, REQUEST_FAILED_TEXT, { detail }) }
        break
      }
      case 'thread.run.expired':
        // Upstream ignored this event; the port says why the reply stopped.
        yield {
          type: 'failed',
          error: new BackendError('api', 'The assistant took too long and the request expired. Please try again.')
        }
        break
      case 'error':
        // The SDK throws an APIError for `error` events before they reach here; throw the same message.
        throw new Error(event.data.message)
      default:
        // Progress events (created, queued, steps, completed, …) carry nothing to show.
        break
    }
  }
}

// ------------------------------------------------------------------------------------ backend

/**
 * Upstream's global `fileId`: `null` before any upload, the id of the last `output.json`
 * uploaded, or `undefined` after a no-data failure assigned the tool's result to it.
 */
type RememberedFile =
  { readonly state: 'none' } | { readonly state: 'uploaded'; readonly id: string } | { readonly state: 'cleared' }

function attachment(fileId: string): MessageCreateParams.Attachment {
  return { file_id: fileId, tools: [{ type: 'code_interpreter' }] }
}

/** Upstream `attachments: fileId && [...]`: null, omitted (undefined) or the file. */
function userAttachments(file: RememberedFile): Pick<MessageCreateParams, 'attachments'> {
  switch (file.state) {
    case 'none':
      return { attachments: null }
    case 'cleared':
      return {}
    case 'uploaded':
      return { attachments: [attachment(file.id)] }
  }
}

/** `${fileId}` in upstream's template literal. */
function fileIdText(file: RememberedFile): string {
  switch (file.state) {
    case 'none':
      return 'null'
    case 'cleared':
      return 'undefined'
    case 'uploaded':
      return file.id
  }
}

interface Session {
  readonly assistantId: string
  readonly threadId: string
  /** A thread was created by this call (upstream then said "Connected to AI assistant!"). */
  readonly threadCreated: boolean
}

export class OpenAiAssistantBackend implements AssistantBackend {
  private assistantId: string | null = null
  private threadId: string | null = null
  /** Attached to every later user message. It survives new conversations, assistant updates and key changes. */
  private file: RememberedFile = { state: 'none' }

  constructor(private api: AssistantsApi) {}

  /**
   * Switch to a client with a new API key (upstream: entering a key after a 401 creates a new
   * client). The session starts over; the remembered file is kept, as upstream's global was.
   */
  switchApi(api: AssistantsApi): void {
    this.api = api
    this.assistantId = null
    this.threadId = null
  }

  async connect(): Promise<boolean> {
    return (await this.session()).threadCreated
  }

  /**
   * Upstream `connectIfNeeded`: reuse the named assistant or create it, then open a thread. Throws
   * upstream's error texts; a 401 forgets the session and asks for the key (`handleInvalidApiKey`).
   */
  private async session(): Promise<Session> {
    if (this.assistantId === null) {
      try {
        const existing = (await this.api.listAssistants()).find((a) => a.name === ASSISTANT_NAME)
        this.assistantId = existing ? existing.id : (await this.api.createAssistant(ASSISTANT_CONFIG)).id
      } catch (error) {
        throw this.sessionFailure(error, SESSION_TEXT.assistant)
      }
    }
    let threadCreated = false
    if (this.threadId === null) {
      try {
        this.threadId = (await this.api.createThread()).id
        threadCreated = true
      } catch (error) {
        throw this.sessionFailure(error, SESSION_TEXT.thread)
      }
    }
    return { assistantId: this.assistantId, threadId: this.threadId, threadCreated }
  }

  private sessionFailure(error: unknown, message: string): BackendError {
    const { kind, detail } = classifyError(error)
    if (!isUnauthorizedError(error)) return new BackendError(kind, message, { detail })
    this.assistantId = null
    this.threadId = null
    return new BackendError(kind, SESSION_TEXT.invalidKey, { detail, promptForKey: true })
  }

  /** The ids the tool flow uses, as upstream read its globals. */
  private current(): { assistantId: string; threadId: string } {
    if (this.assistantId === null || this.threadId === null) {
      throw new BackendError('unknown', 'The conversation was reset while the assistant was waiting for data.')
    }
    return { assistantId: this.assistantId, threadId: this.threadId }
  }

  /**
   * Stream a run. `openFailure` names errors from starting the run; errors while reading it are
   * upstream's "Error receiving response from assistant: …".
   */
  private async *stream(
    open: () => Promise<AsyncIterable<AssistantStreamEvent>>,
    openFailure: (error: unknown) => BackendError
  ): AsyncGenerator<BackendEvent> {
    let events: AsyncIterable<AssistantStreamEvent>
    try {
      events = await open()
    } catch (error) {
      throw openFailure(error)
    }
    try {
      yield* mapRunStream(events, (id) => this.api.fileContent(id))
    } catch (error) {
      throw failure(error, streamFailedText(upstreamMessage(error)))
    }
  }

  /** Upstream `processUserMessage`. */
  async *sendMessage(text: string): AsyncGenerator<BackendEvent> {
    let session: Session
    try {
      session = await this.session()
    } catch (error) {
      throw failure(error, MESSAGE_FAILED_TEXT)
    }
    if (session.threadCreated) yield { type: 'connected' }
    const { assistantId, threadId } = session
    try {
      await this.api.createMessage(threadId, { role: 'user', content: text, ...userAttachments(this.file) })
    } catch (error) {
      throw failure(error, MESSAGE_FAILED_TEXT)
    }
    // Upstream's `runs.stream` reports a failed request while the stream is read.
    yield* this.stream(
      () => this.api.streamRun(threadId, assistantId),
      (error) => failure(error, streamFailedText(upstreamMessage(error)))
    )
  }

  /**
   * Upstream `handleToolCall`, call by call in order: each data result is uploaded as
   * `output.json` (after deleting every existing file of that name) and becomes the remembered
   * file; a `no-data` failure clears it. If any call failed, all outputs are submitted, with no
   * `output` for the calls that succeeded. Otherwise the run is cancelled and a new run starts with
   * the file attached to a fixed user message. A `crash` result stops here, as upstream's throw did.
   */
  async *submitToolOutputs(runId: string, outputs: readonly ToolOutput[]): AsyncGenerator<BackendEvent> {
    const { assistantId, threadId } = this.current()
    const toolOutputs: RunSubmitToolOutputsParams.ToolOutput[] = []
    let failed = false
    try {
      for (const { callId, result } of outputs) {
        switch (result.status) {
          case 'data':
            this.file = { state: 'uploaded', id: await this.uploadOutput(result.json) }
            toolOutputs.push({ tool_call_id: callId })
            break
          case 'failure':
            failed = true
            if (result.reason === 'no-data') this.file = { state: 'cleared' }
            toolOutputs.push({ tool_call_id: callId, output: result.message })
            break
          case 'crash':
            throw new BackendError('unknown', `The assistant's function call could not be handled: ${result.message}`)
        }
      }
    } catch (error) {
      throw error instanceof BackendError ? error : toolFlowFailure(error)
    }
    if (failed) {
      yield* this.stream(() => this.api.submitToolOutputs(threadId, runId, toolOutputs), toolFlowFailure)
      return
    }
    const file = this.file
    try {
      // Upstream waits for the cancel request, not for the run to finish cancelling (see the audit file).
      await this.api.cancelRun(threadId, runId)
      await this.api.createMessage(threadId, {
        role: 'user',
        content: `The data for the requested message has been extracted. Continue processing using the ${OUTPUT_FILE_NAME} file with id: ${fileIdText(file)}`,
        // Upstream sends `file_id: null` when nothing was ever uploaded; the SDK type cannot carry
        // null, so the key is left out (only reachable with an empty tool_calls list).
        attachments: [file.state === 'uploaded' ? attachment(file.id) : { tools: [{ type: 'code_interpreter' }] }]
      })
    } catch (error) {
      throw toolFlowFailure(error)
    }
    yield* this.stream(() => this.api.streamRun(threadId, assistantId), toolFlowFailure)
  }

  /**
   * Upstream `window.get`'s upload. The deletions are started in order and not awaited, as
   * upstream's `forEach(... && openai.files.del(id))` did; a failed deletion is only logged.
   */
  private async uploadOutput(json: string): Promise<string> {
    const files = await this.api.listFiles()
    for (const f of files) {
      if (f.filename === OUTPUT_FILE_NAME) {
        this.api.deleteFile(f.id).catch((error: unknown) => {
          console.error(error)
        })
      }
    }
    const file = new File([json], OUTPUT_FILE_NAME, { type: 'application/json' })
    return (await this.api.uploadFile(file)).id
  }

  newConversation(): Promise<void> {
    this.threadId = null
    return Promise.resolve()
  }

  /** Upstream `updateAssistant`: delete the named assistant and create it again. */
  async recreateAssistant(): Promise<boolean> {
    const assistantId = this.assistantId
    if (assistantId === null) return false
    try {
      await this.api.deleteAssistant(assistantId)
    } catch (error) {
      throw failure(error, updateFailedText(upstreamMessage(error)))
    }
    this.assistantId = null
    this.threadId = null
    try {
      await this.session()
    } catch (error) {
      throw failure(error, updateFailedText(upstreamMessage(error)))
    }
    return true
  }
}
