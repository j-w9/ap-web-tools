import { useEffect, useRef } from 'react'

/** The STATUSTEXT log, scrolled to the newest line (upstream `StatusLog.renderIfOpen`). */
export function MessagesLog({ lines }: { readonly lines: readonly string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const box = ref.current
    if (box !== null) box.scrollTop = box.scrollHeight
  }, [lines])
  return (
    <pre ref={ref} className="gcs-log">
      {lines.length ? lines.join('\n') : 'No messages yet.'}
    </pre>
  )
}
