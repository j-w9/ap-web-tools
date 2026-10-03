import type { LogEntry } from '../dfu/session.js'

/** The flash log: messages in order, with a progress bar for each run of progress updates. */
export function FlashLog({ entries }: { entries: readonly LogEntry[] }) {
  return (
    <div className="dfu-log" aria-live="polite">
      {entries.map((entry, i) =>
        entry.kind === 'progress' ? (
          <progress key={i} className="dfu-log__progress" value={entry.value} max={entry.max ?? undefined} />
        ) : (
          <p key={i} className={`dfu-log__line dfu-log__line--${entry.kind}`}>
            {entry.text}
          </p>
        )
      )}
    </div>
  )
}
