/**
 * {@link AssistantBackend} on the OpenAI Assistants API, as upstream logAnalyzer.js used it.
 *
 * Status: the installed `openai` SDK (v7) still ships `client.beta.assistants`/`threads` but marks
 * them `@deprecated` in favour of the Responses API. This file is the only place that knows about
 * assistants, threads and runs; a Responses API backend can replace it behind the same interface.
 *
 * The API key is passed straight to the SDK client, which sends it only to api.openai.com. It is
 * never stored (no localStorage), logged, or put in an error message.
 */
import OpenAI, { APIConnectionError, APIError, AuthenticationError, RateLimitError } from 'openai'
import type { AssistantStreamEvent, AssistantTool } from 'openai/resources/beta/assistants'
import type { MessageCreateParams } from 'openai/resources/beta/threads/messages'
import type { RunSubmitToolOutputsParams } from 'openai/resources/beta/threads/runs/runs'
import { OUTPUT_FILE_NAME } from '../analysis/tool-calls.js'
import { ASSISTANT_TOOLS } from '../analysis/tool-definitions.js'
import { BackendError, type AssistantBackend, type BackendEvent, type ToolOutput } from './backend.js'
import instructions from './instructions.txt?raw'

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

/** Classify anything the SDK throws into the kinds the UI explains. */
export function toBackendError(error: unknown): BackendError {
  if (error instanceof BackendError) return error
  if (error instanceof AuthenticationError) {
    // The SDK's message echoes part of the key, so it is replaced, not shown.
    return new BackendError('auth', 'OpenAI rejected the API key (401). Check that it is correct and active, then connect again.')
  }
  if (error instanceof RateLimitError) {
    return error.code === 'insufficient_quota'
      ? new BackendError(
          'quota',
          'Your OpenAI account has no quota left (429). Check your plan and billing on platform.openai.com.'
        )
      : new BackendError('rate-limit', 'OpenAI rate limit reached (429). Wait a moment, then try again.')
  }
  if (error instanceof APIConnectionError) {
    return new BackendError('network', 'Could not reach OpenAI. Check your internet connection, then try again.')
  }
  if (error instanceof APIError) {
    return new BackendError(
      'api',
      `OpenAI returned an error${error.status === undefined ? '' : ` (${error.status})`}: ${error.message}`
    )
  }
  return new BackendError('unknown', error instanceof Error ? error.message : String(error))
}

/** Error for a run that failed on OpenAI's side (`thread.run.failed`). */
export function runFailure(lastError: { readonly code: string; readonly message: string } | null): BackendError {
  // Upstream showed only "Sorry, there was an error processing your request. Please try again."
  if (lastError === null) return new BackendError('api', 'The assistant could not finish this request. Please try again.')
  if (lastError.code === 'rate_limit_exceeded') {
    return /quota/i.test(lastError.message)
      ? new BackendError('quota', `Your OpenAI account has no quota left: ${lastError.message}`)
      : new BackendError('rate-limit', `OpenAI rate limit reached: ${lastError.message}`)
  }
  return new BackendError('api', `The assistant could not finish this request: ${lastError.message}`)
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
          } else if (item.type === 'image_file') {
            const fileId = item.image_file?.file_id
            if (fileId === undefined) continue
            try {
              yield { type: 'image', fileId, image: await fetchImage(fileId) }
            } catch (error) {
              yield { type: 'image-error', message: `Failed to load a graph for visualization. ${toBackendError(error).message}` }
            }
          }
        }
        break
      case 'thread.run.requires_action': {
        const calls = event.data.required_action?.submit_tool_outputs.tool_calls
        if (calls === undefined) {
          // Upstream threw "passed event does not require action" here.
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
      case 'thread.run.failed':
        yield { type: 'failed', error: runFailure(event.data.last_error) }
        break
      case 'thread.run.expired':
        yield {
          type: 'failed',
          error: new BackendError('api', 'The assistant took too long and the request expired. Please try again.')
        }
        break
      case 'error':
        yield { type: 'failed', error: new BackendError('api', `OpenAI stream error: ${event.data.message}`) }
        break
      default:
        // Progress events (created, queued, steps, completed, …) carry nothing to show.
        break
    }
  }
}

// ------------------------------------------------------------------------------------ backend

function attachment(fileId: string): MessageCreateParams.Attachment {
  return { file_id: fileId, tools: [{ type: 'code_interpreter' }] }
}

export class OpenAiAssistantBackend implements AssistantBackend {
  private assistantId: string | null = null
  private threadId: string | null = null
  /**
   * Upstream's global `fileId`: the last `output.json` uploaded, attached to every later user
   * message. It survives new conversations and assistant updates, as upstream's did.
   */
  private fileId: string | null = null

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

  async connect(): Promise<void> {
    await this.session()
  }

  /** Upstream `connectIfNeeded`: reuse the named assistant or create it, then open a thread. */
  private async session(): Promise<{ assistantId: string; threadId: string }> {
    try {
      if (this.assistantId === null) {
        const existing = (await this.api.listAssistants()).find((a) => a.name === ASSISTANT_NAME)
        this.assistantId = existing ? existing.id : (await this.api.createAssistant(ASSISTANT_CONFIG)).id
      }
      this.threadId ??= (await this.api.createThread()).id
      return { assistantId: this.assistantId, threadId: this.threadId }
    } catch (error) {
      const failure = toBackendError(error)
      // Upstream `handleInvalidApiKey`: forget the session so the next attempt starts over.
      if (failure.kind === 'auth') {
        this.assistantId = null
        this.threadId = null
      }
      throw failure
    }
  }

  private async *stream(open: () => Promise<AsyncIterable<AssistantStreamEvent>>): AsyncGenerator<BackendEvent> {
    try {
      yield* mapRunStream(await open(), (id) => this.api.fileContent(id))
    } catch (error) {
      throw toBackendError(error)
    }
  }

  async *sendMessage(text: string): AsyncGenerator<BackendEvent> {
    const { assistantId, threadId } = await this.session()
    const fileId = this.fileId
    try {
      await this.api.createMessage(threadId, {
        role: 'user',
        content: text,
        attachments: fileId === null ? null : [attachment(fileId)]
      })
    } catch (error) {
      throw toBackendError(error)
    }
    yield* this.stream(() => this.api.streamRun(threadId, assistantId))
  }

  /**
   * Upstream `handleToolCall`, call by call in order: each data result is uploaded as
   * `output.json` (after deleting every existing file of that name) and becomes the remembered
   * file; a `no-data` failure clears it. If any call failed, all outputs are submitted, with no
   * `output` for the calls that succeeded. Otherwise the run is cancelled and a new run starts with
   * the file attached to a fixed user message. A `crash` result stops here, as upstream's throw did.
   */
  async *submitToolOutputs(runId: string, outputs: readonly ToolOutput[]): AsyncGenerator<BackendEvent> {
    const { assistantId, threadId } = await this.session()
    const toolOutputs: RunSubmitToolOutputsParams.ToolOutput[] = []
    let failed = false
    try {
      for (const { callId, result } of outputs) {
        switch (result.status) {
          case 'data':
            this.fileId = await this.uploadOutput(result.json)
            toolOutputs.push({ tool_call_id: callId })
            break
          case 'failure':
            failed = true
            if (result.reason === 'no-data') this.fileId = null
            toolOutputs.push({ tool_call_id: callId, output: result.message })
            break
          case 'crash':
            throw new BackendError('unknown', `The assistant's function call could not be handled: ${result.message}`)
        }
      }
      if (failed) {
        yield* this.stream(() => this.api.submitToolOutputs(threadId, runId, toolOutputs))
        return
      }
      // Upstream does not wait for the cancellation to finish before posting (see the audit file).
      await this.api.cancelRun(threadId, runId)
      const fileId = this.fileId
      await this.api.createMessage(threadId, {
        role: 'user',
        content: `The data for the requested message has been extracted. Continue processing using the ${OUTPUT_FILE_NAME} file with id: ${String(fileId)}`,
        ...(fileId !== null && { attachments: [attachment(fileId)] })
      })
    } catch (error) {
      throw toBackendError(error)
    }
    yield* this.stream(() => this.api.streamRun(threadId, assistantId))
  }

  private async uploadOutput(json: string): Promise<string> {
    const previous = (await this.api.listFiles()).filter((f) => f.filename === OUTPUT_FILE_NAME)
    // Upstream fired the deletions without waiting; a failed deletion does not stop the upload.
    await Promise.allSettled(previous.map((f) => this.api.deleteFile(f.id)))
    const file = new File([json], OUTPUT_FILE_NAME, { type: 'application/json' })
    return (await this.api.uploadFile(file)).id
  }

  newConversation(): Promise<void> {
    this.threadId = null
    return Promise.resolve()
  }

  /** Upstream `updateAssistant`: delete the named assistant and create it again. */
  async recreateAssistant(): Promise<void> {
    const { assistantId } = await this.session()
    try {
      await this.api.deleteAssistant(assistantId)
    } catch (error) {
      throw toBackendError(error)
    }
    this.assistantId = null
    this.threadId = null
    await this.session()
  }
}
