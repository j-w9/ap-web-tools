import { Eraser } from 'lucide-react'
import { OUTPUT_ELEMENT_ID, clearOutput } from './console.js'

/** Console-style panel holding upstream's `output` text area (written by Python and the page). */
export function ConsolePanel() {
  return (
    <div className="sysid-console">
      <textarea id={OUTPUT_ELEMENT_ID} className="sysid-console__text" readOnly defaultValue="" spellCheck={false} />
      <button type="button" className="apwt-btn apwt-btn--ghost sysid-console__clear" onClick={clearOutput}>
        <Eraser />
        Clear
      </button>
    </div>
  )
}
