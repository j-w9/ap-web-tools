import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { openInDestinations, sendLogTo } from './open-in.js'

export interface OpenInButtonProps {
  /** The currently loaded log file, or null when nothing is loaded. */
  file: File | null
  /** Message types present in the log; destinations that cannot use them are disabled. */
  messageTypes: readonly string[] | null
}

/** Header button listing the other tools this log can be opened in. */
export function OpenInButton({ file, messageTypes }: OpenInButtonProps) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const destinations = useMemo(openInDestinations, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div ref={wrapper} style={{ position: 'relative' }}>
      <button
        type="button"
        className="apwt-btn"
        disabled={file == null}
        aria-expanded={open}
        aria-haspopup="menu"
        title={file == null ? 'Open a log first' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <ExternalLink />
        Open in
        <ChevronDown />
      </button>
      {open && file && (
        <div className="apwt-popover" role="menu">
          {destinations.map((d) => (
            <button
              key={d.name}
              type="button"
              role="menuitem"
              disabled={messageTypes != null && !d.accepts(messageTypes)}
              onClick={() => {
                setOpen(false)
                sendLogTo(d, file)
              }}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
