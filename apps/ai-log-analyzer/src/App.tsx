import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import { DataflashLog } from '@apwt/dataflash'
import {
  ControlGroup,
  ErrorBanner,
  LogInput,
  OpenInButton,
  RailCard,
  Section,
  ToolPage,
  useLatest,
  useLoading,
  useLogFile,
  type LogFact
} from '@apwt/tool-shell'
import { summarizeLog } from './analysis/log-summary.js'
import type { AssistantBackend } from './assistant/backend.js'
import { OpenAiAssistantBackend, openAiAssistantsApi } from './assistant/openai-backend.js'
import { INVALID_KEY_TEXT, LOG_UPLOADED_TEXT, processingText } from './assistant/upstream-text.js'
import { logNotReadText, readsLogFile } from './analysis/log-file.js'
import { connectAssistant, updateAssistant as runUpdate } from './chat/session.js'
import { EMPTY_TRANSCRIPT, isThinking, transcriptReducer } from './chat/transcript.js'
import { runTurn, type Notice, type TurnEvent } from './chat/turn.js'
import { ApiKeyPanel, type ConnectionView, type UpdateState } from './ui/ApiKeyPanel.js'
import { ChatPanel } from './ui/ChatPanel.js'
import { Visualizations, type Visualization } from './ui/Visualizations.js'
import './ai-log-analyzer.css'

/**
 * `ready`: a key was given (upstream's `apiKey` and client exist). Upstream kept the key when the
 * first connection failed for any reason other than a 401 and connected again on the next message,
 * so the port stays ready then too.
 */
type Connection =
  | { readonly status: 'disconnected'; readonly error: string | null }
  | { readonly status: 'connecting' }
  | { readonly status: 'ready'; readonly backend: AssistantBackend }

interface LoadedLog {
  readonly log: DataflashLog
  readonly fileName: string | null
}

const UPDATE_RESET_MS = 3000

export function App() {
  const { run } = useLoading()

  const [loaded, setLoaded] = useState<LoadedLog | null>(null)
  const [logError, setLogError] = useState<string | null>(null)
  const [connection, setConnection] = useState<Connection>({ status: 'disconnected', error: null })
  const [transcript, dispatch] = useReducer(transcriptReducer, EMPTY_TRANSCRIPT)
  const [busy, setBusy] = useState(false)
  const [update, setUpdate] = useState<UpdateState>('idle')
  const [images, setImages] = useState<readonly Visualization[]>([])
  /**
   * Number of charts when a file was last chosen, or null before any. Upstream then showed a "Log
   * File Ready" summary, removed by the first chart only if there were no charts yet.
   */
  const [chartsAtLogReady, setChartsAtLogReady] = useState<number | null>(null)
  const showLogReady = chartsAtLogReady !== null && (chartsAtLogReady > 0 || images.length === 0)
  const nextImageId = useRef(1)
  /** One backend for the page, so the remembered output.json survives a key change (upstream global). */
  const backendRef = useRef<OpenAiAssistantBackend | null>(null)

  // Tool calls read the log at the moment they are answered, as upstream's global did.
  const logRef = useLatest(loaded?.log ?? null)
  // Object URLs for charts are released when the page goes away.
  const imagesRef = useLatest(images)
  useEffect(() => () => imagesRef.current.forEach((v) => URL.revokeObjectURL(v.url)), [imagesRef])

  const { file, openFile } = useLogFile(async (buffer, name) => {
    dispatch({ type: 'notice', notice: { tone: 'info', text: processingText(name ?? 'log'), detail: null } })
    // Upstream offered .bin and .log files but only parsed .bin, and still reported any file ready
    // (proven bug #137). A file that is not read leaves the log as it was and is reported as not read.
    if (!readsLogFile(name)) {
      dispatch({ type: 'notice', notice: { tone: 'error', text: logNotReadText(name ?? 'log'), detail: null } })
      return
    }
    dispatch({ type: 'notice', notice: { tone: 'info', text: LOG_UPLOADED_TEXT, detail: null } })
    await run(() => {
      try {
        setLoaded({ log: DataflashLog.parse(buffer), fileName: name })
        setLogError(null)
        document.title = name ? `AI Log Analyzer: ${name}` : 'AI Log Analyzer'
      } catch (e) {
        // Upstream threw here and kept a half-parsed log; no log is used instead.
        const message = `Could not read this log: ${e instanceof Error ? e.message : String(e)}. Check that it is an ArduPilot .bin file.`
        setLoaded(null)
        setLogError(message)
        dispatch({ type: 'notice', notice: { tone: 'error', text: message, detail: null } })
      }
    }, 'Reading log')
    setChartsAtLogReady(images.length)
  })

  const disconnect = useCallback((error: string | null) => {
    setConnection({ status: 'disconnected', error })
    setUpdate('idle')
  }, [])

  const notice = (n: Notice) => dispatch({ type: 'notice', notice: n })

  /** Upstream `connectIfNeeded` after the key form was submitted. */
  const connect = async (apiKey: string) => {
    setConnection({ status: 'connecting' })
    let backend: OpenAiAssistantBackend
    try {
      const api = openAiAssistantsApi(apiKey)
      backend = backendRef.current ?? new OpenAiAssistantBackend(api)
      backend.switchApi(api)
      backendRef.current = backend
    } catch {
      disconnect('Could not connect to OpenAI')
      return
    }
    if ((await connectAssistant(backend, onTurnEvent)) === 'ready') setConnection({ status: 'ready', backend })
  }

  const onTurnEvent = (event: TurnEvent) => {
    switch (event.type) {
      case 'text':
        dispatch({ type: 'text', messageId: event.messageId, delta: event.delta })
        break
      case 'tool-started':
        dispatch({ type: 'tool-started', call: event.call })
        break
      case 'tool-finished':
        dispatch({ type: 'tool-finished', callId: event.callId, result: event.result })
        break
      case 'image': {
        const image: Visualization = {
          id: nextImageId.current++,
          url: URL.createObjectURL(event.image),
          time: new Date().toLocaleTimeString()
        }
        setImages((list) => [...list, image])
        break
      }
      case 'notice':
        notice(event.notice)
        break
      case 'prompt-key':
        disconnect(INVALID_KEY_TEXT)
        break
    }
  }

  const send = async (text: string) => {
    if (connection.status !== 'ready' || busy) return
    dispatch({ type: 'user', text })
    setBusy(true)
    try {
      await runTurn(connection.backend, text, () => logRef.current, onTurnEvent)
    } finally {
      setBusy(false)
    }
  }

  const clearConversation = async () => {
    if (busy) return
    dispatch({ type: 'clear' })
    images.forEach((v) => URL.revokeObjectURL(v.url))
    setImages([])
    if (connection.status === 'ready') await connection.backend.newConversation()
  }

  /** Upstream `updateAssistant`. */
  const updateAssistant = async () => {
    if (connection.status !== 'ready') return
    setUpdate('updating')
    const outcome = await runUpdate(connection.backend, onTurnEvent)
    if (outcome === 'skipped') {
      // No assistant yet: upstream's button did nothing.
      setUpdate('idle')
      return
    }
    setUpdate((u) => (u === 'updating' ? outcome : u))
    setTimeout(() => setUpdate((u) => (u === 'updated' || u === 'failed' ? 'idle' : u)), UPDATE_RESET_MS)
  }

  const summary = loaded ? summarizeLog(loaded.log) : null
  const facts: LogFact[] | null =
    loaded && summary
      ? [
          { label: 'File', value: loaded.fileName ?? 'From another tool' },
          { label: 'Vehicle', value: summary.vehicle },
          { label: 'Message types', value: String(summary.messageTypes.length) },
          { label: 'Size', value: `${(summary.bytes / 1e6).toFixed(1)} MB` }
        ]
      : null

  const connectionView: ConnectionView = connection.status === 'ready' ? { status: 'connected' } : connection
  const blockedReason =
    connection.status !== 'ready' ? 'Connect with your OpenAI API key to start chatting' : busy ? 'Assistant is working…' : null

  return (
    <ToolPage
      title="AI Log Analyzer"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/AILogAnalyzer/Readme.md"
      intro={
        <>
          Chat with an OpenAI assistant about a <code>.bin</code> log. The assistant asks this page for the messages it needs,
          which are read from the log in your browser, then explains them and draws charts. Bring your own OpenAI API key.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={summary?.messageTypes ?? null} />}
      rail={
        <RailCard>
          <ControlGroup label="Log">
            <LogInput facts={facts} onFile={openFile} accept=".bin,.log" hint="Only .bin logs are read" />
          </ControlGroup>
          <ControlGroup label="OpenAI">
            <ApiKeyPanel
              connection={connectionView}
              onConnect={(key) => void connect(key)}
              onDisconnect={() => disconnect(null)}
              update={update}
              onUpdateAssistant={() => void updateAssistant()}
              busy={busy}
            />
          </ControlGroup>
          <ControlGroup label="Conversation">
            <button
              type="button"
              className="apwt-btn apwt-btn--block"
              disabled={busy || (transcript.entries.length === 0 && images.length === 0)}
              onClick={() => void clearConversation()}
            >
              <Eraser />
              Clear conversation
            </button>
          </ControlGroup>
        </RailCard>
      }
    >
      <ErrorBanner message={logError} />

      <Section
        title="Chat"
        help="Ask about message meanings or what happened in the flight. Enter sends, Shift+Enter adds a line."
      >
        <ChatPanel
          entries={transcript.entries}
          thinking={isThinking(transcript, busy)}
          blockedReason={blockedReason}
          onSend={(text) => void send(text)}
        />
      </Section>

      <Section title="Visualizations" help="Charts the assistant's code interpreter produced. Click one to see it full size.">
        <Visualizations images={images} showLogReady={showLogReady} />
      </Section>
    </ToolPage>
  )
}
