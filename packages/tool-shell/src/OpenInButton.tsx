import { useEffect, useMemo, useRef, useState } from 'react'
import { openInDestinations, sendLogTo } from './open-in.js'

export interface OpenInButtonProps {
  /** The currently loaded log file, or null when nothing is loaded. */
  file: File | null
  /** Base message types present in the log; destinations that cannot use them are disabled. */
  messageTypes: readonly string[] | null
}

/** "Open In" button that pops up one button per destination tool. */
export function OpenInButton({ file, messageTypes }: OpenInButtonProps) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLSpanElement>(null)
  const destinations = useMemo(openInDestinations, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <span ref={wrapper} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" disabled={file == null} onClick={() => setOpen((o) => !o)}>
        Open In
      </button>
      {open && file && (
        <div className="apwt-popover" style={{ right: '100%', top: 0 }}>
          {destinations.map((d) => (
            <button
              key={d.name}
              type="button"
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
    </span>
  )
}
