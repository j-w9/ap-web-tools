import type { RefObject } from 'react'
import { X } from 'lucide-react'

export interface EditorOverlayRefs {
  overlay: RefObject<HTMLDivElement | null>
  testGrid: RefObject<HTMLDivElement | null>
  textEditor: RefObject<HTMLDivElement | null>
  formEditor: RefObject<HTMLDivElement | null>
  scriptTab: RefObject<HTMLButtonElement | null>
  formTab: RefObject<HTMLButtonElement | null>
  close: RefObject<HTMLButtonElement | null>
}

/**
 * Markup of the widget editor (upstream `#edit_overlay`): a test grid with a live copy of the widget
 * beside the script editor and the form builder. `WidgetEditor` drives it.
 */
export function EditorOverlay({ overlay, testGrid, textEditor, formEditor, scriptTab, formTab, close }: EditorOverlayRefs) {
  return (
    <div ref={overlay} className="vo-editor">
      <div className="apwt-card vo-editor__panel">
        <div className="vo-editor__head">
          <span className="apwt-section__title">Widget editor</span>
          <button ref={close} type="button" className="apwt-icon-btn" aria-label="Close editor" title="Close">
            <X />
          </button>
        </div>
        <div className="vo-editor__body">
          <div className="vo-editor__column">
            <span className="apwt-label">Preview</span>
            <div ref={testGrid} className="vo-editor__test vo-bs" />
          </div>
          <div className="vo-editor__column">
            <div className="vo-editor__tabs">
              <button ref={scriptTab} type="button" className="apwt-btn">
                Script
              </button>
              <button ref={formTab} type="button" className="apwt-btn">
                Form
              </button>
            </div>
            <div ref={textEditor} className="vo-editor__text" />
            <div ref={formEditor} className="vo-editor__form vo-bs" style={{ display: 'none' }} />
          </div>
        </div>
      </div>
    </div>
  )
}
