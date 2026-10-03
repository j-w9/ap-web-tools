/**
 * "Open in" hand-off between tools. A tool opens another tool in a new window and posts
 * either the `File` (same origin: the receiver gets the file name and can hand it on again)
 * or the raw `ArrayBuffer` (cross origin, e.g. UAV Log Viewer).
 */

export interface OpenInDestination {
  name: string
  /** Absolute or relative URL of the destination tool. */
  path: string
  /** Same-origin tool that accepts a `File` via `postMessage` after load. */
  sameOrigin: boolean
  /** Whether the destination can do anything useful with a log containing these message types. */
  accepts: (messageTypes: readonly string[]) => boolean
}

const any = (wanted: readonly string[]) => (types: readonly string[]) => wanted.some((t) => types.includes(t))

export const OPEN_IN_DESTINATIONS: readonly OpenInDestination[] = [
  { name: 'UAV Log Viewer', path: 'https://plotbeta.ardupilot.org/#', sameOrigin: false, accepts: () => true },
  { name: 'Hardware Report', path: '../hardware-report/', sameOrigin: true, accepts: any(['PARM']) },
  { name: 'Filter Review', path: '../filter-review/', sameOrigin: true, accepts: any(['GYR', 'ISBD']) },
  { name: 'MAGFit', path: '../magfit/', sameOrigin: true, accepts: any(['MAG']) },
  {
    name: 'PID Review',
    path: '../pid-review/',
    sameOrigin: true,
    accepts: any(['RATE', 'PIDR', 'PIDP', 'PIDY', 'PIQR', 'PIQP', 'PIQY', 'PIDS', 'PIDA'])
  }
]

/** Destinations other than the current tool (identified by the last path segment). */
export function openInDestinations(): readonly OpenInDestination[] {
  const segments = window.location.pathname.split('/').filter(Boolean)
  const own = segments[segments.length - 1] ?? ''
  return OPEN_IN_DESTINATIONS.filter((d) => !d.path.includes(`/${own}/`))
}

export type IncomingLog = { kind: 'file'; file: File } | { kind: 'buffer'; buffer: ArrayBuffer }

/** Open `destination` in a new window and hand it the log. */
export function sendLogTo(destination: OpenInDestination, file: File): void {
  if (destination.sameOrigin) {
    const target = window.open(destination.path)
    target?.addEventListener('load', () => target.postMessage({ type: 'file', data: file }, '*'))
    return
  }
  void file.arrayBuffer().then((buffer) => {
    const target = window.open(destination.path)
    // Cannot observe load cross-origin; give the viewer time to start up.
    setTimeout(() => target?.postMessage({ type: 'arrayBuffer', data: buffer }, '*'), 2000)
  })
}

/** Listen for logs posted by another tool. Returns an unsubscribe function. */
export function onIncomingLog(handler: (log: IncomingLog) => void): () => void {
  const listener = (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; data?: unknown } | null
    if (!data || typeof data !== 'object') return
    if (data.type === 'file' && data.data instanceof File) handler({ kind: 'file', file: data.data })
    else if (data.type === 'arrayBuffer' && data.data instanceof ArrayBuffer) handler({ kind: 'buffer', buffer: data.data })
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
