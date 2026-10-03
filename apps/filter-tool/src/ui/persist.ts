/**
 * Where the page state comes from and goes to: a share link's query string first, else the
 * state saved in this browser, else upstream's defaults. Upstream used cookies for the same job.
 */
import { DEFAULT_STATE, stateFromQuery, stateToQuery, type ToolState } from '../analysis/settings.js'

const STORAGE_KEY = 'apwt.filter-tool.state'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function initialState(): ToolState {
  const search = window.location.search
  if (search.length > 1) return stateFromQuery(search)
  const stored = readStored()
  return stored === null ? DEFAULT_STATE : stateFromQuery(stored, DEFAULT_STATE, 'stored')
}

export function saveState(state: ToolState): void {
  try {
    localStorage.setItem(STORAGE_KEY, stateToQuery(state))
  } catch {
    // Storage blocked (private mode): the page still works, it just forgets.
  }
}

/** Absolute link that reopens the page with `state`. */
export function shareLink(state: ToolState): string {
  const url = new URL(window.location.href)
  url.search = stateToQuery(state)
  return url.toString()
}
