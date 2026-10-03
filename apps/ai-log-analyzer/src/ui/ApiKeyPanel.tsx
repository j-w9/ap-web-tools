import { useState } from 'react'
import { KeyRound, LogOut, RefreshCw } from 'lucide-react'
import { ErrorBanner } from '@apwt/tool-shell'
import { ASSISTANT_MODEL, ASSISTANT_NAME } from '../assistant/openai-backend.js'
import { UPDATE_LABELS } from '../assistant/upstream-text.js'

/** Progress of upstream's "Update Assistant" button. */
export type UpdateState = 'idle' | 'updating' | 'updated' | 'failed'

export type ConnectionView =
  | { readonly status: 'disconnected'; readonly error: string | null }
  | { readonly status: 'connecting' }
  | { readonly status: 'connected' }

export interface ApiKeyPanelProps {
  connection: ConnectionView
  /** Called with the trimmed key; the panel forgets it right away. */
  onConnect: (apiKey: string) => void
  onDisconnect: () => void
  update: UpdateState
  onUpdateAssistant: () => void
  /** A reply is streaming; assistant changes wait until it ends. */
  busy: boolean
}

const UPDATE_LABEL: Readonly<Record<UpdateState, string>> = UPDATE_LABELS

/** OpenAI key entry and assistant controls (upstream: API key modal and "Update Assistant"). */
export function ApiKeyPanel({ connection, onConnect, onDisconnect, update, onUpdateAssistant, busy }: ApiKeyPanelProps) {
  const [draft, setDraft] = useState('')

  const privacy = (
    <p className="ala-note">
      Your key is kept only in this tab’s memory and is sent only to OpenAI, directly from this browser. It is never saved;
      reloading the page forgets it. Usage is billed to your OpenAI account.
    </p>
  )

  if (connection.status === 'connected') {
    return (
      <div className="ala-key">
        <p className="ala-status">
          <span className="apwt-badge apwt-badge--green">Connected</span>
          <span className="ala-status__detail">
            {ASSISTANT_NAME} · {ASSISTANT_MODEL}
          </span>
        </p>
        <button
          type="button"
          className="apwt-btn apwt-btn--block"
          disabled={busy || update !== 'idle'}
          title="Delete the assistant on your OpenAI account and create it again with this page's instructions and tools"
          onClick={onUpdateAssistant}
        >
          <RefreshCw />
          {UPDATE_LABEL[update]}
        </button>
        <button type="button" className="apwt-btn apwt-btn--block apwt-btn--ghost" disabled={busy} onClick={onDisconnect}>
          <LogOut />
          Forget key
        </button>
        {privacy}
      </div>
    )
  }

  const connecting = connection.status === 'connecting'
  return (
    <form
      className="ala-key"
      onSubmit={(e) => {
        e.preventDefault()
        const key = draft.trim()
        if (key === '') return
        setDraft('')
        onConnect(key)
      }}
    >
      <label className="ala-key__field">
        <span>OpenAI API key</span>
        <input
          type="password"
          className="apwt-input"
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          disabled={connecting}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button type="submit" className="apwt-btn apwt-btn--primary apwt-btn--block" disabled={connecting || draft.trim() === ''}>
        <KeyRound />
        {connecting ? 'Connecting…' : 'Connect'}
      </button>
      {connection.status === 'disconnected' && <ErrorBanner message={connection.error} />}
      {privacy}
    </form>
  )
}
