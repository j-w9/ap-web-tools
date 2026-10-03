import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import { downloadText, useLatest } from '@apwt/tool-shell'
import { ParamDefinitions, type ParamDefinition } from '../params/definitions.js'
import {
  BITMASK_ERROR,
  bitChecked,
  clientStatus,
  defaultText,
  importHeading,
  importPlan,
  MAX_FILE_BYTES,
  metaStatusText,
  PAGE_SIZE,
  pageView,
  rowBits,
  rowDescription,
  rowHints,
  rowLabel,
  rowOptions,
  savedMessage,
  saveFileName,
  saveSelection,
  selectedOption,
  skippedText,
  toggleBit
} from '../params/editor.js'
import { errorMessage, type MavParam, type ParamChange } from '../params/model.js'
import { formatParamValue, parseParamText, saveParamText, type Param, type ParamVehicle } from '../params/packed.js'

const sharedDefinitions = new ParamDefinitions()

export interface ParameterEditorProps {
  readonly client: MavParam | null
  readonly vehicle: ParamVehicle
  /** Whether the client was ever cleared (upstream's message after `setClient(null)`). */
  readonly everDisconnected: boolean
  readonly open: boolean
  readonly onClose: () => void
  readonly definitions?: ParamDefinitions
}

interface Status {
  readonly text: string
  readonly error: boolean
}

interface ImportPreview {
  readonly fileName: string
  readonly values: Map<string, number>
  readonly changes: readonly ParamChange[]
  readonly skipped: readonly string[]
}

/** Re-renders whenever the model emits (it is mutable, so a counter stands for its version). */
function useModelVersion(client: MavParam | null): number {
  const version = useRef(0)
  const subscribe = useCallback(
    (notify: () => void) =>
      client === null
        ? () => {}
        : client.subscribe(() => {
            version.current++
            notify()
          }),
    [client]
  )
  return useSyncExternalStore(subscribe, () => version.current)
}

/**
 * Parameter editor (upstream `modules/MAVLink/mavparam-ui.js`, class `MAVParamUI`): fetch values
 * and defaults, search, edit, reset, save to and load from a file, with descriptions from
 * ArduPilot's parameter definitions. Like upstream's single dialog, it lives across clients: a
 * new client (upstream `setClient`) clears drafts, the import preview and the page and sets the
 * status message, while the search, the non-default filter, the save scope and the descriptions
 * status are kept. Decisions and texts come from `params/editor.ts`.
 */
export function ParameterEditor({
  client,
  vehicle,
  everDisconnected,
  open,
  onClose,
  definitions = sharedDefinitions
}: ParameterEditorProps) {
  useModelVersion(client)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ text: clientStatus(client !== null, everDisconnected), error: false })
  const [metaStatus, setMetaStatus] = useState('Descriptions not loaded.')
  const [loadingDefinitions, setLoadingDefinitions] = useState(false)
  const loadingRef = useRef(false)
  const [search, setSearch] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [saveScope, setSaveScope] = useState<'all' | 'changed'>('all')
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map())
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [shownClient, setShownClient] = useState(client)
  const [shownCleared, setShownCleared] = useState(everDisconnected)
  const [generation, setGeneration] = useState(0)
  const clientRef = useLatest(client)
  const openRef = useLatest(open)

  // Upstream `setClient`: a different client, or the first clearing (every connect starts with
  // one), resets the per-vehicle state. Later clearings while there is no client change nothing.
  if (shownClient !== client || shownCleared !== everDisconnected) {
    setShownClient(client)
    setShownCleared(everDisconnected)
    setGeneration(generation + 1)
    setDrafts(new Map())
    setPreview(null)
    setPage(0)
    setStatus({ text: clientStatus(client !== null, true), error: false })
  }

  const message = (text: string, error = false): void => setStatus({ text, error })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const setDraft = (name: string, value: string | null): void =>
    setDrafts((d) => {
      const next = new Map(d)
      if (value === null) next.delete(name)
      else next.set(name, value)
      return next
    })

  // Messages from an operation are dropped once the client has changed (upstream `run`).
  const run = async (text: string, action: () => Promise<unknown>, success: string): Promise<void> => {
    const owner = client
    if (owner === null || owner.busy) return
    message(text)
    try {
      await action()
      if (clientRef.current === owner) message(success)
    } catch (e) {
      if (clientRef.current === owner) message(errorMessage(e), true)
    }
  }

  const refresh = (): Promise<void> =>
    run('Fetching parameters and defaults…', () => client?.refresh() ?? Promise.resolve(), 'Parameters refreshed.')

  const loadDefinitions = async (force = false): Promise<void> => {
    const owner = client
    if (owner === null || loadingRef.current) return
    loadingRef.current = true
    setLoadingDefinitions(true)
    setMetaStatus(`Loading ${vehicle} descriptions…`)
    try {
      const result = await definitions.load(vehicle, { refresh: force })
      if (clientRef.current !== owner) return
      owner.setDefinitions(result.definitions)
      setMetaStatus(metaStatusText(vehicle, result))
    } catch {
      if (clientRef.current === owner) setMetaStatus('Descriptions unavailable. Parameter values can still be edited.')
    } finally {
      loadingRef.current = false
      setLoadingDefinitions(false)
      // A client that arrived during the load gets its own descriptions.
      if (clientRef.current !== null && clientRef.current !== owner && openRef.current) void actions.current.loadDefinitions()
    }
  }

  // Opening (or a new client while open) fetches parameters once and loads descriptions.
  const actions = useLatest({ refresh, loadDefinitions })
  useEffect(() => {
    if (!open || client === null) return
    if (!client.params.size && !client.busy) void actions.current.refresh()
    void actions.current.loadDefinitions()
  }, [open, client, actions])

  const busy = client === null || client.busy || !client.connected
  const params = client?.search(search, changedOnly) ?? []
  const total = client?.params.size ?? 0
  const view = pageView(page, params.length, total)
  // Upstream stores the clamped page, so it stays clamped when matches grow again.
  if (view.page !== page) setPage(view.page)
  const { start } = view

  const save = (): void => {
    if (client === null) return
    const list = saveSelection(client.params.values(), saveScope)
    downloadText(saveFileName(vehicle, saveScope), saveParamText(list))
    message(savedMessage(list.length))
  }

  const loadFile = async (): Promise<void> => {
    const input = fileRef.current
    const file = input?.files?.[0]
    if (input !== null) input.value = ''
    if (file === undefined || client === null) return
    const owner = client
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Parameter file exceeds 4 MiB')
      const values = parseParamText(await file.text())
      if (clientRef.current !== owner) return
      const { changes, skipped } = importPlan(owner, values)
      setPreview({ fileName: file.name, values, changes, skipped })
    } catch (e) {
      setPreview(null)
      message(errorMessage(e), true)
    }
  }

  return (
    <dialog ref={dialogRef} className="gcs-params" aria-label="Parameters" onClose={onClose}>
      <header className="gcs-params__head">
        <h2>Parameters</h2>
        <button type="button" className="apwt-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <div className={`gcs-params__status${status.error ? ' gcs-params__status--error' : ''}`} role="status">
        {status.text}
      </div>
      <div className="gcs-params__meta">
        <span>{metaStatus}</span>
        <button type="button" className="apwt-btn" disabled={loadingDefinitions} onClick={() => void loadDefinitions(true)}>
          Refresh descriptions
        </button>
      </div>
      <div className="gcs-params__toolbar">
        <button type="button" className="apwt-btn" disabled={busy} onClick={() => void refresh()}>
          Fetch parameters
        </button>
        <select
          className="apwt-input"
          aria-label="Parameters to save"
          value={saveScope}
          onChange={(e) => setSaveScope(e.target.value === 'changed' ? 'changed' : 'all')}
        >
          <option value="all">Save all parameters</option>
          <option value="changed">Save non-default parameters</option>
        </select>
        <button type="button" className="apwt-btn" disabled={!total} onClick={save}>
          Save to file
        </button>
        <button type="button" className="apwt-btn" disabled={busy || !total} onClick={() => fileRef.current?.click()}>
          Load from file
        </button>
        <input ref={fileRef} type="file" accept=".parm,.param,.params,.txt" hidden onChange={() => void loadFile()} />
      </div>
      <div className="gcs-params__filters">
        <input
          type="search"
          className="apwt-input"
          placeholder="Search parameter names and descriptions"
          aria-label="Search parameters"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
        />
        <label className="apwt-chip">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(e) => {
              setChangedOnly(e.target.checked)
              setPage(0)
            }}
          />
          Non-default only
        </label>
      </div>
      {preview !== null && (
        <section className="gcs-params__import">
          <h3>{importHeading(preview.fileName, preview.changes.length)}</h3>
          {preview.skipped.length > 0 && <p>{skippedText(preview.skipped)}</p>}
          <div className="gcs-params__preview">
            {preview.changes.map((p) => (
              <div key={p.name}>
                {p.name}: {formatParamValue(p, p.previousValue)} → {formatParamValue(p)}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="apwt-btn apwt-btn--primary"
            disabled={busy || !preview.changes.length}
            onClick={() =>
              void run(
                'Uploading parameter file and verifying values…',
                async () => {
                  await client?.apply(preview.values)
                  setPreview(null)
                  setDrafts(new Map())
                },
                'Parameter file uploaded and verified.'
              )
            }
          >
            Upload changes
          </button>
          <button type="button" className="apwt-btn" onClick={() => setPreview(null)}>
            Cancel import
          </button>
        </section>
      )}
      <div className="gcs-params__list">
        {params.length === 0 ? (
          <p className="apwt-empty">{total ? 'No parameters match this search.' : 'No parameters loaded.'}</p>
        ) : (
          params.slice(start, start + PAGE_SIZE).map((p) => (
            <ParamRow
              key={`${generation}:${p.name}`}
              param={p}
              definition={client?.definitions.get(p.name)}
              busy={busy}
              draft={drafts.get(p.name)}
              onDraft={(v) => setDraft(p.name, v)}
              onMessage={message}
              onApply={(text, d) =>
                void run(
                  `Writing ${p.name}…`,
                  async () => {
                    await client?.apply(parseParamText(`${p.name} ${text}`))
                    setDraft(p.name, null)
                  },
                  `${p.name} saved and verified.${d?.rebootRequired === true ? ' Reboot required for this setting.' : ''}`
                )
              }
              onReset={() =>
                void run(
                  `Resetting ${p.name}…`,
                  async () => {
                    await client?.reset(p.name)
                    setDraft(p.name, null)
                  },
                  `${p.name} reset and verified.`
                )
              }
            />
          ))
        )}
      </div>
      <footer className="gcs-params__foot">
        <span>{view.countText}</span>
        <button type="button" className="apwt-btn" disabled={view.page === 0} onClick={() => setPage(view.page - 1)}>
          Previous
        </button>
        <button type="button" className="apwt-btn" disabled={view.page + 1 >= view.pages} onClick={() => setPage(view.page + 1)}>
          Next
        </button>
      </footer>
    </dialog>
  )
}

interface ParamRowProps {
  readonly param: Param
  readonly definition: ParamDefinition | undefined
  readonly busy: boolean
  readonly draft: string | undefined
  readonly onDraft: (value: string) => void
  readonly onMessage: (text: string, error: boolean) => void
  readonly onApply: (text: string, definition: ParamDefinition | undefined) => void
  readonly onReset: () => void
}

/** One parameter (upstream `MAVParamUI.row`). */
function ParamRow({ param: p, definition: d, busy, draft, onDraft, onMessage, onApply, onReset }: ParamRowProps) {
  const changed = p.defaultValue !== undefined && p.value !== p.defaultValue
  const readOnly = d?.readOnly === true
  const value = draft ?? formatParamValue(p)
  const label = rowLabel(d)
  const options = rowOptions(d)
  const bits = rowBits(d)
  const submit = (e: SyntheticEvent): void => {
    e.preventDefault()
    onApply(value, d)
  }

  return (
    <article className={`gcs-param${changed ? ' gcs-param--changed' : ''}`} data-parameter={p.name}>
      <div>
        <strong>{p.name}</strong>
        {label !== null && <div className="gcs-param__label">{label}</div>}
        {readOnly && <small>Read-only</small>}
      </div>
      <form className="gcs-param__value" onSubmit={submit}>
        <label className="apwt-field">
          <span className="apwt-label">Value</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${p.name} value`}
            value={value}
            disabled={busy || readOnly}
            onChange={(e) => onDraft(e.target.value)}
          />
        </label>
        <button type="submit" className="apwt-btn" disabled={busy || readOnly}>
          Apply
        </button>
        {options.length > 0 && (
          <select
            className="apwt-input"
            aria-label={`${p.name} options`}
            disabled={busy || readOnly}
            defaultValue={selectedOption(d, p)}
            onChange={(e) => {
              if (e.target.value !== '') onDraft(e.target.value)
            }}
          >
            <option value="">Choose an option</option>
            {options.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </select>
        )}
        {bits.length > 0 && (
          <details>
            <summary>Bitmask options</summary>
            {bits.map(([bit, text]) => (
              <label key={bit} className="gcs-param__bit">
                <input
                  type="checkbox"
                  checked={bitChecked(value, bit)}
                  disabled={busy || readOnly}
                  onChange={(e) => {
                    try {
                      onDraft(toggleBit(value, bit, e.target.checked, p.type))
                    } catch {
                      onMessage(BITMASK_ERROR, true)
                    }
                  }}
                />{' '}
                {text}
              </label>
            ))}
          </details>
        )}
      </form>
      <div className="gcs-param__default">
        <span>{defaultText(p, formatParamValue)}</span>
        {changed && (
          <button
            type="button"
            className="apwt-btn"
            disabled={busy || readOnly}
            aria-label={`Reset ${p.name} to default`}
            onClick={onReset}
          >
            Reset to default
          </button>
        )}
      </div>
      <div className="gcs-param__help">
        <p>{rowDescription(d)}</p>
        <small>{rowHints(d)}</small>
      </div>
    </article>
  )
}
