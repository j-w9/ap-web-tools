import { useId, useState, type ReactNode } from 'react'
import { FileText, UploadCloud } from 'lucide-react'

export interface LogFact {
  label: string
  value: ReactNode
}

export interface LogInputProps {
  /** Facts about the loaded log; null before a log is loaded. */
  facts: readonly LogFact[] | null
  onFile: (file: File) => void
  /** Accepted extensions, e.g. ".bin". */
  accept?: string
  /** Drop-zone title before a log is loaded. */
  title?: string
  /** Drop-zone hint, e.g. which messages the log needs. */
  hint?: ReactNode
}

/** "a .bin file" or "a .bin or .tlog file" from an `accept` attribute. */
function describeAccept(accept: string) {
  const types = accept
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
  return (
    <>
      a{' '}
      {types.map((t, i) => (
        <span key={t}>
          {i > 0 && (i === types.length - 1 ? ' or ' : ', ')}
          <code>{t}</code>
        </span>
      ))}{' '}
      file
    </>
  )
}

/**
 * Log input for the rail, modelled on CustomBuild's config drop zone. Before a log is
 * loaded it is a dashed drop target; afterwards it lists facts about the log and stays a
 * drop target for opening another one.
 */
export function LogInput({ facts, onFile, accept = '.bin', title = 'Open a log', hint }: LogInputProps) {
  const id = useId()
  const [over, setOver] = useState(false)

  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const f = e.dataTransfer.files[0]
      if (f) onFile(f)
    }
  }

  const input = (
    <input
      id={id}
      type="file"
      accept={accept}
      className="apwt-sr-only"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onFile(f)
        e.target.value = ''
      }}
    />
  )

  if (!facts) {
    return (
      <label htmlFor={id} className={`apwt-drop${over ? ' apwt-drop--over' : ''}`} {...handlers}>
        {input}
        <UploadCloud />
        <span className="apwt-drop__title">{title}</span>
        <span className="apwt-drop__hint">Drag and drop or click to choose {describeAccept(accept)}</span>
        {hint && <span className="apwt-drop__hint">{hint}</span>}
      </label>
    )
  }

  return (
    <div {...handlers} className={over ? 'apwt-drop apwt-drop--over' : undefined}>
      <dl className="apwt-facts">
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <label htmlFor={id} className="apwt-btn apwt-btn--block" style={{ marginTop: 14 }}>
        {input}
        <FileText />
        Open another log
      </label>
    </div>
  )
}
