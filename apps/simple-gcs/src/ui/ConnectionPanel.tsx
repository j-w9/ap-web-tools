import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { ControlGroup } from '@apwt/tool-shell'
import type { GcsSession, SessionSnapshot } from '../session.js'

export interface ConnectionPanelProps {
  readonly session: GcsSession
  readonly snap: SessionSnapshot
}

/**
 * Connect button and the connection settings form (upstream toolbar Connect button and the
 * `connection_tip_template` popover). Edits are a draft: reconnects keep using the submitted
 * settings until Connect is pressed.
 */
export function ConnectionPanel({ session, snap }: ConnectionPanelProps) {
  const [showPassphrase, setShowPassphrase] = useState(false)
  const draft = snap.draft
  const close = (): void => {
    setShowPassphrase(false)
    session.closeDialog()
  }
  return (
    <ControlGroup label="Connection">
      <div className="gcs-row">
        <button
          type="button"
          id="connectBtn"
          className={`apwt-btn gcs-connect gcs-connect--${snap.connectTone}`}
          disabled={snap.starting}
          aria-expanded={snap.dialogOpen}
          onClick={() => (snap.dialogOpen ? close() : session.openDialog())}
        >
          {snap.connectLabel}
        </button>
      </div>
      {snap.dialogOpen && (
        <form
          noValidate
          className="gcs-connection"
          aria-label="Connection settings"
          onSubmit={(e) => {
            e.preventDefault()
            void session.submit().then((r) => r.kind === 'connected' && setShowPassphrase(false))
          }}
        >
          <label className="apwt-field">
            <span className="apwt-label">Server address</span>
            <input
              id="target_url"
              type="url"
              placeholder="ws://127.0.0.1:56781"
              required
              pattern="^(ws|wss)://.*"
              value={draft.url}
              onChange={(e) => session.editDraft({ url: e.target.value })}
            />
          </label>
          <div className="gcs-row">
            <label className="apwt-field">
              <span className="apwt-label">System ID</span>
              <input
                id="system_id"
                type="number"
                min={1}
                max={255}
                step={1}
                value={draft.systemId}
                onChange={(e) => session.editDraft({ systemId: e.target.value })}
              />
            </label>
            <label className="apwt-field">
              <span className="apwt-label">Component ID</span>
              <input
                id="component_id"
                type="number"
                min={1}
                max={255}
                step={1}
                value={draft.componentId}
                onChange={(e) => session.editDraft({ componentId: e.target.value })}
              />
            </label>
          </div>
          <label className="apwt-chip">
            <input
              id="send_heartbeat"
              type="checkbox"
              checked={draft.sendHeartbeat}
              onChange={(e) => session.editDraft({ sendHeartbeat: e.target.checked })}
            />
            Send 1 Hz heartbeat
          </label>
          <div className="apwt-field">
            <label className="apwt-label" htmlFor="signing_passphrase">
              Signing passphrase
            </label>
            <span className="gcs-row gcs-row--tight">
              <input
                id="signing_passphrase"
                type={showPassphrase ? 'text' : 'password'}
                placeholder="Enter passphrase"
                value={draft.passphrase}
                onChange={(e) => session.editDraft({ passphrase: e.target.value })}
              />
              <button
                type="button"
                className="apwt-btn gcs-icon-toggle"
                aria-label={showPassphrase ? 'Hide signing passphrase' : 'Show signing passphrase'}
                aria-controls="signing_passphrase"
                aria-pressed={showPassphrase}
                title={showPassphrase ? 'Hide signing passphrase' : 'Show signing passphrase'}
                onClick={() => setShowPassphrase(!showPassphrase)}
              >
                {showPassphrase ? <Eye /> : <EyeOff />}
              </button>
            </span>
          </div>
          <div className="gcs-row">
            <button type="submit" className="apwt-btn apwt-btn--primary" disabled={snap.submitting}>
              Connect
            </button>
            <button type="button" className="apwt-btn" onClick={() => session.requestDisconnect()}>
              Disconnect
            </button>
            <button type="button" className="apwt-btn apwt-btn--ghost" onClick={close}>
              Close
            </button>
          </div>
        </form>
      )}
    </ControlGroup>
  )
}
