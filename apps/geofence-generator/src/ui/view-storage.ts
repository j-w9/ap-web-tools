import { DEFAULT_VIEW, parseStoredView, type MapView } from '../analysis/view.js'

const STORAGE_KEY = 'apwt-geofence-view'

/** The remembered map view, else upstream's default (upstream uses leaflet.restoreview for this). */
export function loadView(): MapView {
  try {
    return parseStoredView(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

/** Remember the map view for the next visit; silently skipped when storage is blocked. */
export function saveView(view: MapView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(view))
  } catch {
    // Storage unavailable: the view is simply not remembered.
  }
}
