import { AlertTriangle, Download, ExternalLink } from 'lucide-react'
import { compareParamNames, paramFileText, paramToString } from '@apwt/ardupilot'
import { downloadText, openInDestinations, sendLogTo } from '@apwt/tool-shell'
import { paramDiffCount, type ParamDiff } from '../analysis/param-diff.js'
import { paramFileName } from '../analysis/param-format.js'
import { logWarnings, warningLevel, type LogSummary, type LogWarning } from '../analysis/summary.js'
import { PopoverButton } from './Popover.js'

const LINK_BUTTON = 'apwt-btn apwt-btn--ghost'
const COMPACT = { padding: '4px 8px', fontSize: 13 } as const
const POPOVER_TEXT = { padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 } as const

function DiffList({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null
  return (
    <details open style={{ marginBottom: 6 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{title}</summary>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </details>
  )
}

const sortedNames = (map: ReadonlyMap<string, unknown>) => [...map.keys()].sort(compareParamNames)

/** Count of parameter changes, opening the full list (upstream `param_diff_format`). */
export function ParamDiffCell({ diff }: { diff: ParamDiff | null }) {
  if (diff === null) return <>-</>
  const count = paramDiffCount(diff)
  return (
    <PopoverButton label={count} title={`${count} parameter changes`} className={LINK_BUTTON} style={COMPACT} width={340}>
      {() =>
        count === 0 ? (
          <div style={POPOVER_TEXT}>No change</div>
        ) : (
          <div style={POPOVER_TEXT}>
            <DiffList title="New:" lines={sortedNames(diff.added).map((n) => `${n}: ${paramToString(diff.added.get(n) ?? 0)}`)} />
            <DiffList
              title="Missing:"
              lines={sortedNames(diff.missing).map((n) => `${n}: ${paramToString(diff.missing.get(n) ?? 0)}`)}
            />
            <DiffList
              title="Changed:"
              lines={sortedNames(diff.changed).map((n) => {
                const c = diff.changed.get(n)
                return c ? `${n}: ${paramToString(c.from)} => ${paramToString(c.to)}` : n
              })}
            />
          </div>
        )
      }
    </PopoverButton>
  )
}

function warningText(w: LogWarning) {
  switch (w.kind) {
    case 'crash-dump':
    case 'watchdog':
      return (
        <p key={w.kind} style={{ margin: '4px 0' }}>
          {w.kind === 'crash-dump' ? 'Crash Dump file detected.' : 'Watchdog reboot detected.'}
          <br />
          For more information see ArduPilot{' '}
          <a href={w.docsUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--red-text)' }}>
            documentation
          </a>
          .
        </p>
      )
    case 'arming-checks-disabled':
      return (
        <p key={w.kind} style={{ margin: '4px 0' }}>
          Arming checks disabled.
        </p>
      )
  }
}

/** Warning icon with details, red for crash dumps and watchdogs, yellow for arming checks off. */
export function WarningsButton({ summary }: { summary: LogSummary }) {
  const warnings = logWarnings(summary)
  const level = warningLevel(warnings)
  if (level === 'none') return null
  const color = level === 'error' ? 'var(--red-text)' : 'var(--yellow-text)'
  return (
    <PopoverButton
      label={<AlertTriangle style={{ color }} />}
      title={level === 'error' ? 'Warnings: reboot or crash' : 'Warning: arming checks disabled'}
      className={LINK_BUTTON}
      style={COMPACT}
      width={300}
    >
      {() => <div style={{ ...POPOVER_TEXT, fontFamily: 'var(--font)', fontSize: 13 }}>{warnings.map(warningText)}</div>}
    </PopoverButton>
  )
}

/** Download the log's parameters as a `.param` file (upstream "Parameters" button). */
export function ParamDownloadButton({ name, params }: { name: string; params: ReadonlyMap<string, number> }) {
  return (
    <button
      type="button"
      className="apwt-btn"
      style={COMPACT}
      disabled={params.size === 0}
      title={params.size === 0 ? 'No parameters in this log' : 'Save parameters as a .param file'}
      aria-label="Save parameters"
      onClick={() => downloadText(paramFileName(name), paramFileText(params))}
    >
      <Download />
    </button>
  )
}

/** Per-row "Open in" menu handing the file to another tool. */
export function OpenInMenu({ file, messageTypes }: { file: File; messageTypes: readonly string[] }) {
  return (
    <PopoverButton
      label={
        <>
          <ExternalLink />
          Open in
        </>
      }
      title={`Open ${file.name} in another tool`}
      className="apwt-btn"
      style={COMPACT}
      role="menu"
    >
      {(close) =>
        openInDestinations().map((d) => (
          <button
            key={d.name}
            type="button"
            role="menuitem"
            disabled={!d.accepts(messageTypes)}
            onClick={() => {
              close()
              sendLogTo(d, file)
            }}
          >
            {d.name}
          </button>
        ))
      }
    </PopoverButton>
  )
}
