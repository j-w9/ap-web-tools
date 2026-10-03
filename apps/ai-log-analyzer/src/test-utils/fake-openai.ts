/**
 * A local stand-in for the OpenAI REST API, shared by the upstream harness (through a fake of the
 * v4 SDK calls logAnalyzer.js makes) and the port (through the real v7 SDK over a fake `fetch`).
 * Both sides therefore produce the same request log when they make the same calls. No request
 * leaves the process.
 */
import { APIError } from 'openai'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** One HTTP request as the API would see it; multipart uploads are reduced to their fields. */
export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'DELETE'
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  readonly body: Json
}

/** A stream event as sent over SSE (`event:` name and `data:` JSON). */
export interface StreamEvent {
  readonly event: string
  readonly data: Json
}

export type ApiResponse =
  | { readonly kind: 'json'; readonly status: number; readonly body: Json }
  | { readonly kind: 'sse'; readonly events: readonly StreamEvent[] }
  | { readonly kind: 'binary'; readonly bytes: string }

export interface ScriptedFailure {
  readonly method: ApiRequest['method']
  readonly path: RegExp
  readonly status: number
  readonly message: string
  /** How many matching requests fail (default: all). */
  times?: number
}

export class FakeOpenAiServer {
  readonly log: ApiRequest[] = []
  assistants: { id: string; name: string | null }[] = []
  files: { id: string; filename: string }[] = []
  /** One event list per run started (create, stream or submit_tool_outputs), in order. */
  runs: StreamEvent[][] = []
  failures: ScriptedFailure[] = []
  private counters = { asst: 0, thread: 0, msg: 0, file: 0 }

  handle(request: ApiRequest): ApiResponse {
    this.log.push(request)
    const failure = this.failures.find((f) => f.method === request.method && f.path.test(request.path) && (f.times ?? 1) > 0)
    if (failure) {
      if (failure.times !== undefined) failure.times--
      return {
        kind: 'json',
        status: failure.status,
        body: { error: { message: failure.message, type: 'invalid_request_error', code: null, param: null } }
      }
    }
    const { method, path } = request
    const ok = (body: Json): ApiResponse => ({ kind: 'json', status: 200, body })
    const nextRun = (): ApiResponse => ({ kind: 'sse', events: this.runs.shift() ?? [] })
    let m: RegExpExecArray | null
    if (method === 'GET' && path === '/assistants') return ok({ object: 'list', data: this.assistants, has_more: false })
    if (method === 'POST' && path === '/assistants') {
      const id = `asst_${++this.counters.asst}`
      const body = request.body
      const name =
        typeof body === 'object' && body !== null && !Array.isArray(body) && typeof body['name'] === 'string'
          ? body['name']
          : null
      this.assistants.push({ id, name })
      return ok({ id, object: 'assistant', name })
    }
    if (method === 'DELETE' && (m = /^\/assistants\/([^/]+)$/.exec(path))) {
      const id = m[1] ?? ''
      this.assistants = this.assistants.filter((a) => a.id !== id)
      return ok({ id, object: 'assistant.deleted', deleted: true })
    }
    if (method === 'POST' && path === '/threads') return ok({ id: `thread_${++this.counters.thread}`, object: 'thread' })
    if (method === 'POST' && /^\/threads\/[^/]+\/messages$/.test(path)) {
      return ok({ id: `msg_${++this.counters.msg}`, object: 'thread.message' })
    }
    if (method === 'POST' && /^\/threads\/[^/]+\/runs$/.test(path)) return nextRun()
    if (method === 'POST' && /^\/threads\/[^/]+\/runs\/[^/]+\/submit_tool_outputs$/.test(path)) return nextRun()
    if (method === 'POST' && (m = /^\/threads\/[^/]+\/runs\/([^/]+)\/cancel$/.exec(path))) {
      return ok({ id: m[1] ?? '', object: 'thread.run', status: 'cancelling' })
    }
    if (method === 'GET' && path === '/files') return ok({ object: 'list', data: this.files, has_more: false })
    if (method === 'DELETE' && (m = /^\/files\/([^/]+)$/.exec(path))) {
      const id = m[1] ?? ''
      this.files = this.files.filter((f) => f.id !== id)
      return ok({ id, object: 'file', deleted: true })
    }
    if (method === 'POST' && path === '/files') {
      const id = `file_${++this.counters.file}`
      this.files.push({ id, filename: 'output.json' })
      return ok({ id, object: 'file', filename: 'output.json', purpose: 'assistants' })
    }
    if (method === 'GET' && (m = /^\/files\/([^/]+)\/content$/.exec(path))) return { kind: 'binary', bytes: `png:${m[1] ?? ''}` }
    return {
      kind: 'json',
      status: 404,
      body: { error: { message: `No route ${method} ${path}`, type: 'invalid_request_error' } }
    }
  }

  /** A `fetch` for the real SDK (the port), answering from this server. */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    // The SDK checks FormData support once with `fetch('data:,')`; a browser answers that locally.
    if (url.protocol === 'data:') return new Response('')
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') throw new Error(`Unexpected method ${method}`)
    const body = init?.body
    let json: Json = null
    if (typeof body === 'string') json = JSON.parse(body) as Json
    else if (body instanceof FormData) json = await formFields(body)
    const response = this.handle({
      method,
      path: url.pathname.replace(/^\/v1/, ''),
      query: Object.fromEntries(url.searchParams),
      body: json
    })
    switch (response.kind) {
      case 'json':
        return Response.json(response.body, { status: response.status })
      case 'sse':
        return new Response(
          response.events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('') +
            'event: done\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } }
        )
      case 'binary':
        return new Response(response.bytes, { headers: { 'content-type': 'application/binary' } })
    }
  }
}

async function formFields(form: FormData): Promise<Json> {
  const out: Record<string, Json> = {}
  for (const [key, value] of form) {
    out[key] = typeof value === 'string' ? value : { name: value.name, type: value.type, text: await value.text() }
  }
  return out
}

/** The error the SDK (v4 and v7 alike) throws for an error response: `APIError.generate` on the parsed body. */
export function apiErrorFor(response: Extract<ApiResponse, { kind: 'json' }>): APIError {
  const body = response.body
  return APIError.generate(
    response.status,
    typeof body === 'object' && body !== null ? body : undefined,
    undefined,
    new Headers()
  )
}

/** A JSON round trip, which is what the SDK sends for a request body. */
export function asJson(value: unknown): Json {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json)
}
