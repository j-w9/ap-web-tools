import { Eraser } from 'lucide-react'
import { OUTPUT_ELEMENT_ID, clearOutput } from './console.js'

/** Console-style panel holding upstream's `output` text area (written by Python and the page). */
export function ConsolePanel() {
  return (
    <textarea
      id={OUTPUT_ELEMENT_ID}
      className="sysid-console"
      aria-label="Python output"
      placeholder="Python's progress and results appear here. Loading Python takes a while the first time."
      readOnly
      defaultValue=""
      spellCheck={false}
    />
  )
}

/** Empties the output panel. */
export function ClearOutputButton() {
  return (
    <button type="button" className="apwt-btn apwt-btn--ghost" onClick={clearOutput}>
      <Eraser />
      Clear output
    </button>
  )
}
