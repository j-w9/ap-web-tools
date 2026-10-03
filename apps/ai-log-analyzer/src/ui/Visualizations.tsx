import { useEffect, useRef, useState } from 'react'

/** A chart produced by the assistant's code interpreter, as an object URL owned by the app. */
export interface Visualization {
  readonly id: number
  readonly url: string
  /** Local time it arrived, for the caption. */
  readonly time: string
}

export interface VisualizationsProps {
  images: readonly Visualization[]
  /** Show upstream's "Log File Ready" summary above the charts. */
  showLogReady: boolean
}

/** Charts from the assistant (upstream: the "Visualizations" pane); click one to see it full size. */
export function Visualizations({ images, showLogReady }: VisualizationsProps) {
  const [enlarged, setEnlarged] = useState<Visualization | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (enlarged && !el.open) el.showModal()
    if (!enlarged && el.open) el.close()
  }, [enlarged])

  return (
    <>
      {showLogReady && (
        <div className="ala-summary">
          <h3>Summary</h3>
          <p>Log file ready</p>
          <h3>Findings</h3>
          <p>Ask questions in the chat to analyze the log and generate visualizations.</p>
        </div>
      )}
      {images.length === 0 && !showLogReady && (
        <div className="apwt-empty">Charts and graphs will appear here when analyzing log data.</div>
      )}
      {images.length > 0 && (
        <div className="ala-gallery">
          {images.map((v) => (
            <figure key={v.id} className="ala-figure">
              <button type="button" onClick={() => setEnlarged(v)} aria-label="Show full size">
                <img src={v.url} alt={`Chart from the assistant at ${v.time}`} />
              </button>
              <figcaption>{v.time}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <dialog ref={dialog} className="ala-lightbox" onClose={() => setEnlarged(null)} onClick={() => setEnlarged(null)}>
        {enlarged && <img src={enlarged.url} alt={`Chart from the assistant at ${enlarged.time}, full size`} />}
      </dialog>
    </>
  )
}
