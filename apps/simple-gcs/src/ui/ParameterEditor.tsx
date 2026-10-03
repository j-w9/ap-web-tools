import { useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import { downloadText, useLatest } from '@apwt/tool-shell'
import { ParamDefinitions, type ParamDefinition } from '../params/definitions.js'
import { errorMessage, type MavParam, type ParamChange } from '../params/model.js'
import { formatParamValue, parseParamText, saveParamText, type Param, type ParamVehicle } from '../params/packed.js'

const PAGE_SIZE = 50
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
  return useSyncExternalStore(
    (notify) =>
      client === null
        ? () => {}
        : client.subscribe(() => {
            version.current++
            notify()
          }),
    () => version.current
  )
}

/** A JSON value as string interpolation shows it. */
function displayValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (v === undefined || v === null) return String(v)
  return Array.isArray(v) ? v.map(displayValue).join(',') : Object.prototype.toString.call(v)
}

function describeRange(range: unknown): string {
  if (typeof range === 'object' && range !== null) {
    const r = range as Record<string, unknown>
    return `${displayValue(r.low)} to ${displayValue(r.high)}`
  }
  return displayValue(range)
}

/**
 * Parameter editor (upstream `modules/MAVLink/mavparam-ui.js`, class `MAVParamUI`): fetch values
 * and defaults, search, edit, reset, save to and load from a file, with descriptions from
 * ArduPilot's parameter definitions. The parent remounts it (via `key`) when the client changes.
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
  const [status, setStatus] = useState<Status>({
    text:
      client !== null
        ? 'Fetch parameters to begin.'
        : everDisconnected
          ? 'Disconnected. Reconnect to fetch current parameters.'
          : 'Connect to a vehicle to fetch parameters.',
    error: false
  })
  const [metaStatus, setMetaStatus] = useState('Descriptions not loaded.')
  const [loadingDefinitions, setLoadingDefinitions] = useState(false)
  const loadingRef = useRef(false)
  const [search, setSearch] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [saveScope, setSaveScope] = useState<'all' | 'changed'>('all')
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map())
  const [preview, setPreview] = useState<ImportPreview | null>(null)

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

  const run = async (text: string, action: () => Promise<unknown>, success: string): Promise<void> => {
    if (client === null || client.busy) return
    message(text)
    try {
      await action()
      message(success)
    } catch (e) {
      message(errorMessage(e), true)
    }
  }

  const refresh = (): Promise<void> =>
    run('Fetching parameters and defaults…', () => client?.refresh() ?? Promise.resolve(), 'Parameters refreshed.')

  const loadDefinitions = async (force = false): Promise<void> => {
    if (client === null || loadingRef.current) return
    loadingRef.current = true
    setLoadingDefinitions(true)
    setMetaStatus(`Loading ${vehicle} descriptions…`)
    try {
      const result = await definitions.load(vehicle, { refresh: force })
      client.setDefinitions(result.definitions)
      setMetaStatus(`${vehicle} descriptions${result.stale ? ' (offline cached copy)' : result.cached ? ' (cached)' : ''}.`)
    } catch {
      setMetaStatus('Descriptions unavailable. Parameter values can still be edited.')
    } finally {
      loadingRef.current = false
      setLoadingDefinitions(false)
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
  const pages = Math.max(1, Math.ceil(params.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const start = current * PAGE_SIZE
  const total = client?.params.size ?? 0

  const save = (): void => {
    if (client === null) return
    const list = [...client.params.values()].filter(
      (p) => saveScope === 'all' || (p.defaultValue !== undefined && p.value !== p.defaultValue)
    )
    downloadText(`${vehicle.toLowerCase()}-${saveScope}.parm`, saveParamText(list))
    message(`Saved ${list.length} parameters. Search does not limit file exports.`)
  }

  const loadFile = async (): Promise<void> => {
    const input = fileRef.current
    const file = input?.files?.[0]
    if (input !== null) input.value = ''
    if (file === undefined || client === null) return
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Parameter file exceeds 4 MiB')
      const values = parseParamText(await file.text())
      const skipped: string[] = []
      for (const name of [...values.keys()]) {
        if (client.params.has(name) && client.definitions.get(name)?.readOnly === true) {
          skipped.push(name)
          values.delete(name)
        }
      }
      setPreview({ fileName: file.name, values, changes: client.changes(values), skipped })
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
          <h3>
            {preview.fileName}: {preview.changes.length} changes
          </h3>
          {preview.skipped.length > 0 && <p>Skipped read-only parameters: {preview.skipped.join(', ')}</p>}
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
              key={p.name}
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
        <span>
          {params.length ? start + 1 : 0}–{Math.min(start + PAGE_SIZE, params.length)} of {params.length} matches · {total}{' '}
          parameters
        </span>
        <button type="button" className="apwt-btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
          Previous
        </button>
        <button type="button" className="apwt-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
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
  const values = Object.entries(d?.values ?? {})
  const bits = Object.entries(d?.bitmask ?? {}).filter(([bit]) => /^\d+$/.test(bit) && Number(bit) <= 31)
  const hints: string[] = []
  if (d?.units) hints.push(`Units: ${d.units}`)
  if (d?.range) hints.push(`Range: ${describeRange(d.range)}`)
  if (d?.increment) hints.push(`Increment: ${displayValue(d.increment)}`)
  if (d?.rebootRequired === true) hints.push('Reboot required')
  const submit = (e: SyntheticEvent): void => {
    e.preventDefault()
    onApply(value, d)
  }
  const bitSet = (bit: string): boolean =>
    Number.isFinite(Number(value)) && (BigInt(Math.trunc(Number(value))) & (1n << BigInt(bit))) !== 0n

  return (
    <article className={`gcs-param${changed ? ' gcs-param--changed' : ''}`} data-parameter={p.name}>
      <div>
        <strong>{p.name}</strong>
        {d?.label && <div className="gcs-param__label">{d.label}</div>}
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
        {values.length > 0 && (
          <select
            className="apwt-input"
            aria-label={`${p.name} options`}
            disabled={busy || readOnly}
            defaultValue={Object.hasOwn(d?.values ?? {}, String(p.value)) ? String(p.value) : ''}
            onChange={(e) => {
              if (e.target.value !== '') onDraft(e.target.value)
            }}
          >
            <option value="">Choose an option</option>
            {values.map(([v, text]) => (
              <option key={v} value={v}>
                {v}: {displayValue(text)}
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
                  checked={bitSet(bit)}
                  disabled={busy || readOnly}
                  onChange={(e) => {
                    try {
                      let v = BigInt(value)
                      const mask = 1n << BigInt(bit)
                      v = e.target.checked ? v | mask : v & ~mask
                      // Packed int32 bitmasks retain bit 31 without float rounding.
                      if (p.type === 3) v = BigInt.asIntN(32, v)
                      onDraft(String(v))
                    } catch {
                      onMessage('Enter an integer before changing bitmask options.', true)
                    }
                  }}
                />{' '}
                {bit}: {displayValue(text)}
              </label>
            ))}
          </details>
        )}
      </form>
      <div className="gcs-param__default">
        <span>Default: {p.defaultValue === undefined ? 'unavailable' : formatParamValue(p, p.defaultValue)}</span>
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
        <p>{d?.description || 'No description available.'}</p>
        <small>{hints.join(' · ')}</small>
      </div>
    </article>
  )
}
