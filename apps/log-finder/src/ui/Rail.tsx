import { useState } from 'react'
import { FileStack, FolderOpen, RotateCw, UploadCloud, X } from 'lucide-react'
import { CheckChips, Chip, ControlGroup, RailCard, type LogFact } from '@apwt/tool-shell'
import { PARAM_IGNORE_RULES, type ParamIgnoreKey } from '../analysis/param-diff.js'
import type { VehicleFilterKey } from '../analysis/table.js'
import { VEHICLE_NAMES } from './LogTable.js'
import { canPickDirectory, sourceFromDrop, sourceFromInput, type LogSource } from './sources.js'

/** Filter controls as the user typed them; dates stay `YYYY-MM-DD` strings until filtering. */
export interface FilterInputs {
  readonly text: string
  readonly hiddenVehicles: ReadonlySet<VehicleFilterKey>
  readonly warningsOnly: boolean
  readonly flownOnly: boolean
  readonly from: string
  readonly to: string
}

export const EMPTY_FILTER_INPUTS: FilterInputs = {
  text: '',
  hiddenVehicles: new Set(),
  warningsOnly: false,
  flownOnly: false,
  from: '',
  to: ''
}

/** Scan state shown in the rail. */
export type ScanStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'listing' }
  | { readonly kind: 'scanning'; readonly done: number; readonly total: number }

export interface RailProps {
  facts: readonly LogFact[] | null
  status: ScanStatus
  canReload: boolean
  onSource: (source: LogSource) => void
  onPickDirectory: () => void
  onReload: () => void
  onStop: () => void
  /** Vehicles present in the scanned logs. */
  vehicles: readonly VehicleFilterKey[]
  filter: FilterInputs
  onFilterChange: (filter: FilterInputs) => void
  ignored: ReadonlySet<ParamIgnoreKey>
  onIgnoredChange: (ignored: ReadonlySet<ParamIgnoreKey>) => void
}

/** The drop zone styles every svg as a large yellow icon; buttons inside it keep button icons. */
const BUTTON_ICON = { width: 16, height: 16, color: 'currentColor' } as const

const vehicleLabel = (v: VehicleFilterKey) => (v === 'unknown' ? 'Unknown' : VEHICLE_NAMES[v])

/** Folder and file pickers with a drop zone. */
function SourcePicker({ onSource, onPickDirectory }: Pick<RailProps, 'onSource' | 'onPickDirectory'>) {
  const [over, setOver] = useState(false)
  const folderInput = (
    <input
      type="file"
      multiple
      className="apwt-sr-only"
      ref={(el) => {
        if (el) el.webkitdirectory = true
      }}
      onChange={(e) => {
        const source = e.target.files ? sourceFromInput(e.target.files) : null
        if (source) onSource(source)
        e.target.value = ''
      }}
    />
  )
  return (
    <div
      className={`apwt-drop${over ? ' apwt-drop--over' : ''}`}
      style={{ cursor: 'default' }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const source = sourceFromDrop(e.dataTransfer)
        if (source) onSource(source)
      }}
    >
      <UploadCloud />
      <span className="apwt-drop__title">Find logs</span>
      <span className="apwt-drop__hint">
        Drop a folder or <code>.bin</code> files here, or choose one. Subfolders are searched too.
      </span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
        {canPickDirectory() ? (
          <button type="button" className="apwt-btn apwt-btn--primary" onClick={onPickDirectory}>
            <FolderOpen style={BUTTON_ICON} />
            Choose folder
          </button>
        ) : (
          <label className="apwt-btn apwt-btn--primary">
            {folderInput}
            <FolderOpen style={BUTTON_ICON} />
            Choose folder
          </label>
        )}
        <label className="apwt-btn">
          <input
            type="file"
            multiple
            accept=".bin,.BIN"
            className="apwt-sr-only"
            onChange={(e) => {
              const source = e.target.files ? sourceFromInput(e.target.files) : null
              if (source) onSource(source)
              e.target.value = ''
            }}
          />
          <FileStack style={BUTTON_ICON} />
          Choose files
        </label>
      </div>
    </div>
  )
}

function Progress({ status }: { status: ScanStatus }) {
  switch (status.kind) {
    case 'idle':
      return null
    case 'listing':
      return (
        <div style={{ marginTop: 14 }}>
          <div className="apwt-field">Listing files…</div>
          <div className="apwt-progress" />
        </div>
      )
    case 'scanning': {
      const fraction = status.total === 0 ? 1 : status.done / status.total
      return (
        <div
          style={{ marginTop: 14 }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={status.total}
          aria-valuenow={status.done}
        >
          <div className="apwt-field">
            <span>Reading logs</span>
            <span>
              {status.done} / {status.total}
            </span>
          </div>
          <div className="apwt-progress">
            <div style={{ width: `${(fraction * 100).toFixed(1)}%`, height: '100%', background: 'var(--yellow)' }} />
          </div>
        </div>
      )
    }
  }
}

/** The control rail: log source, scan progress, filters and parameter compare options. */
export function Rail(p: RailProps) {
  const busy = p.status.kind === 'listing' || p.status.kind === 'scanning'
  const f = p.filter
  const set = (patch: Partial<FilterInputs>) => p.onFilterChange({ ...f, ...patch })
  const filtered = f.text !== '' || f.hiddenVehicles.size > 0 || f.warningsOnly || f.flownOnly || f.from !== '' || f.to !== ''

  return (
    <RailCard>
      <ControlGroup label="Logs">
        <SourcePicker onSource={p.onSource} onPickDirectory={p.onPickDirectory} />
        <Progress status={p.status} />
        {p.facts && (
          <dl className="apwt-facts" style={{ marginTop: 14 }}>
            {p.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {busy ? (
            <button type="button" className="apwt-btn apwt-btn--block" onClick={p.onStop}>
              <X />
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="apwt-btn apwt-btn--block"
              disabled={!p.canReload}
              title="Search the same folder or files again"
              onClick={p.onReload}
            >
              <RotateCw />
              Reload
            </button>
          )}
        </div>
      </ControlGroup>

      <ControlGroup label="Filter">
        <label className="apwt-field">
          <span>Search</span>
          <input
            type="text"
            placeholder="Name, firmware, board"
            style={{ width: 200 }}
            value={f.text}
            onChange={(e) => set({ text: e.target.value })}
          />
        </label>
        <label className="apwt-field">
          <span>From</span>
          <input
            type="date"
            className="apwt-input"
            style={{ width: 200 }}
            value={f.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label className="apwt-field">
          <span>To</span>
          <input
            type="date"
            className="apwt-input"
            style={{ width: 200 }}
            value={f.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
        {p.vehicles.length > 1 && (
          <CheckChips
            label="Vehicles"
            options={p.vehicles.map((v) => ({ value: v, label: vehicleLabel(v) }))}
            value={new Set(p.vehicles.filter((v) => !f.hiddenVehicles.has(v)))}
            onChange={(shown) => set({ hiddenVehicles: new Set(p.vehicles.filter((v) => !shown.has(v))) })}
          />
        )}
        <div className="apwt-chips" style={{ marginTop: 8 }}>
          <Chip
            type="checkbox"
            checked={f.flownOnly}
            onChange={(on) => set({ flownOnly: on })}
            title="Hide logs with no recorded flight time"
          >
            Flown only
          </Chip>
          <Chip
            type="checkbox"
            checked={f.warningsOnly}
            onChange={(on) => set({ warningsOnly: on })}
            title="Only logs with a crash dump, watchdog reboot or arming checks disabled"
          >
            With warnings
          </Chip>
        </div>
        {filtered && (
          <button
            type="button"
            className="apwt-btn apwt-btn--ghost apwt-btn--block"
            style={{ marginTop: 8 }}
            onClick={() => p.onFilterChange(EMPTY_FILTER_INPUTS)}
          >
            Clear filters
          </button>
        )}
      </ControlGroup>

      <ControlGroup label="Ignore parameter changes">
        <p className="apwt-section__help" style={{ fontSize: 13, marginTop: 0 }}>
          Leave these out when comparing each log's parameters with the one above. They are expected to change on every boot.
        </p>
        <CheckChips
          options={PARAM_IGNORE_RULES.map((r) => ({ value: r.key, label: r.label }))}
          value={p.ignored}
          onChange={p.onIgnoredChange}
        />
      </ControlGroup>
    </RailCard>
  )
}
