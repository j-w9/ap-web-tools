import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, Send, Wrench } from 'lucide-react'
import type { ChatEntry, ToolActivity } from '../chat/transcript.js'
import { Markdown } from './Markdown.js'

export interface ChatPanelProps {
  entries: readonly ChatEntry[]
  thinking: boolean
  /** Why the composer is disabled, or null when the user can type. */
  blockedReason: string | null
  onSend: (text: string) => void
}

function ToolLine({ name, args, activity }: { name: string; args: string; activity: ToolActivity }) {
  const icon =
    activity.status === 'running' ? (
      <Loader2 className="ala-spin" />
    ) : activity.status === 'done' ? (
      <CheckCircle2 />
    ) : (
      <AlertTriangle />
    )
  const detail =
    activity.status === 'running' ? 'Reading the log…' : activity.status === 'done' ? activity.summary : activity.message
  return (
    <div className={`ala-tool ala-tool--${activity.status}`}>
      <Wrench />
      <code>
        {name}({args})
      </code>
      {icon}
      <span>{detail}</span>
    </div>
  )
}

function Entry({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case 'user':
      return <div className="ala-msg ala-msg--user">{entry.text}</div>
    case 'assistant':
      return (
        <div className="ala-msg ala-msg--assistant">
          <Markdown text={entry.markdown} />
        </div>
      )
    case 'notice':
      return (
        <div className={`ala-notice ala-notice--${entry.tone}`} role={entry.tone === 'error' ? 'alert' : undefined}>
          {entry.tone === 'error' ? <AlertTriangle /> : <Info />}
          {entry.text}
        </div>
      )
    case 'tool':
      return <ToolLine name={entry.name} args={entry.arguments} activity={entry.activity} />
  }
}

/** Transcript with streaming replies and tool activity, and the message box. */
export function ChatPanel({ entries, thinking, blockedReason, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  // Keep the newest message in view while a reply streams in.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, thinking])

  const submit = () => {
    const text = draft.trim()
    if (text === '' || blockedReason !== null) return
    setDraft('')
    onSend(text)
  }

  return (
    <div className="ala-chat">
      <div ref={scroller} className="ala-transcript" aria-live="polite">
        {entries.length === 0 && (
          <div className="apwt-empty">
            <p>
              Hello! Upload a <code>.bin</code> log file to analyze your flight data, and connect your OpenAI key to start
              chatting.
            </p>
          </div>
        )}
        {entries.map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
        {thinking && (
          <div className="ala-thinking" aria-label="Assistant is working">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      <form
        className="ala-composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          className="apwt-input"
          rows={2}
          placeholder={blockedReason ?? 'Ask about your flight data…'}
          disabled={blockedReason !== null}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button type="submit" className="apwt-btn apwt-btn--primary" disabled={blockedReason !== null || draft.trim() === ''}>
          <Send />
          Send
        </button>
      </form>
    </div>
  )
}
