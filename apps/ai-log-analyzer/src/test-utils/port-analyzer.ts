/**
 * The port's side of the chat-flow oracle tests: `connectAssistant`, `runTurn` and
 * `updateAssistant` on the real v7 SDK adapter over a fake fetch, driven the way App.tsx drives
 * them, with the same surface as {@link UpstreamAnalyzer}.
 */
import { DataflashLog } from '@apwt/dataflash'
import { OpenAiAssistantBackend, openAiAssistantsApi } from '../assistant/openai-backend.js'
import { connectAssistant, updateAssistant } from '../chat/session.js'
import { runTurn, type TurnEvent } from '../chat/turn.js'
import type { FakeOpenAiServer } from './fake-openai.js'
import type { ChatLine } from './upstream-analyzer.js'

export interface Side {
  submitKey(key: string): Promise<void>
  loadLog(buffer: ArrayBuffer): Promise<void>
  send(text: string): Promise<void>
  updateAssistant(): Promise<void>
  chat(): ChatLine[]
  readonly prompts: number
  readonly clients: readonly string[]
  readonly updateLabel: string
}

/** The port, driven the way App.tsx drives it. */
export class PortAnalyzer implements Side {
  readonly clients: string[] = []
  prompts = 1
  updateLabel = 'Update Assistant'
  private readonly lines: ChatLine[] = []
  private backend: OpenAiAssistantBackend | null = null
  private log: DataflashLog | null = null
  private lastMessage: string | null = null

  constructor(private readonly server: FakeOpenAiServer) {}

  private readonly emit = (event: TurnEvent) => {
    switch (event.type) {
      case 'notice':
        this.lines.push({ kind: 'notice', tone: event.notice.tone, text: event.notice.text })
        this.lastMessage = null
        break
      case 'text': {
        const last = this.lines.at(-1)
        if (last?.kind === 'assistant' && this.lastMessage === event.messageId) {
          this.lines[this.lines.length - 1] = { kind: 'assistant', text: last.text + event.delta }
        } else {
          this.lines.push({ kind: 'assistant', text: event.delta })
        }
        this.lastMessage = event.messageId
        break
      }
      case 'prompt-key':
        this.prompts++
        break
      case 'image':
      case 'tool-started':
      case 'tool-finished':
        break
    }
  }

  async submitKey(key: string): Promise<void> {
    this.clients.push(key)
    const api = openAiAssistantsApi(key, this.server.fetch)
    this.backend ??= new OpenAiAssistantBackend(api)
    this.backend.switchApi(api)
    await connectAssistant(this.backend, this.emit)
  }

  loadLog(buffer: ArrayBuffer): Promise<void> {
    this.log = DataflashLog.parse(buffer)
    return Promise.resolve()
  }

  async send(text: string): Promise<void> {
    if (!this.backend) throw new Error('no key')
    this.lines.push({ kind: 'user', text })
    this.lastMessage = null
    await runTurn(this.backend, text, () => this.log, this.emit)
  }

  async updateAssistant(): Promise<void> {
    if (!this.backend) throw new Error('no key')
    const outcome = await updateAssistant(this.backend, this.emit)
    if (outcome !== 'skipped') this.updateLabel = outcome === 'updated' ? 'Updated' : 'Update Failed'
  }

  chat(): ChatLine[] {
    return this.lines
  }
}

/** Upstream appends every assistant delta to the last assistant bubble; compare the joined text. */
export function merged(lines: readonly ChatLine[]): ChatLine[] {
  const out: ChatLine[] = []
  for (const line of lines) {
    const last = out.at(-1)
    if (line.kind === 'assistant' && last?.kind === 'assistant')
      out[out.length - 1] = { kind: 'assistant', text: last.text + line.text }
    else out.push(line)
  }
  return out
}
