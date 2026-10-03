/**
 * Page start-up (upstream index.html script): the `mavlink20` global and Formio components, the
 * widget editor, the palette, the initial layout and the unsaved-changes prompt.
 */
import { Dashboard } from './dashboard/dashboard.js'
import { WidgetEditor } from './dashboard/editor.js'
import { installPalette } from './dashboard/palette.js'
import { setupFormio } from './forms/formio-setup.js'
import { installLegacyMavlink20 } from './mavlink/legacy-namespace.js'
import { createMavlinkPublisher } from './sandbox/protocol.js'
import { installFormioStyles } from './ui/formio-styles.js'

let started: Dashboard | null = null

/** Starts the dashboard in `element` once per page. */
export function startDashboard(element: HTMLElement): Dashboard {
  if (started !== null) return started
  // Saved Formio forms (the "MAVLink field" data script) read the global.
  installFormioStyles()
  const mavlink20 = installLegacyMavlink20()
  setupFormio(mavlink20)
  const editor = new WidgetEditor()
  const dashboard = new Dashboard({
    element,
    publish: createMavlinkPublisher(),
    editor,
    pageUrl: () => window.location.href,
    hash: window.location.hash
  })
  element.style.backgroundColor = '#ffffff'
  started = dashboard
  void editor.init(dashboard)
  installPalette(dashboard)
  void dashboard.loadInitialGrid()
  window.addEventListener('beforeunload', (event) => dashboard.handleUnload(event))
  return dashboard
}
