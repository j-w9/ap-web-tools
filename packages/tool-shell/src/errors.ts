/**
 * Show uncaught errors in an in-page panel. Upstream used `alert()`, which freezes the page
 * until dismissed; a panel keeps the page usable and lets the user copy the details.
 */
export function installGlobalErrorReporter(): void {
  const w = window as Window & { __apwtErrorReporter?: boolean }
  if (w.__apwtErrorReporter === true) return
  w.__apwtErrorReporter = true

  window.addEventListener('error', (event) => {
    showErrorPanel(event.message, `${event.filename}:${String(event.lineno)}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    showErrorPanel('Unhandled promise rejection', reason instanceof Error ? (reason.stack ?? reason.message) : String(reason))
  })
}

function showErrorPanel(message: string, detail: string): void {
  const panel = document.createElement('div')
  panel.className = 'apwt-card apwt-error-panel'
  panel.setAttribute('role', 'alert')

  const title = document.createElement('strong')
  title.textContent = 'Something went wrong'
  const body = document.createElement('p')
  body.textContent =
    'Try a hard reload to clear the cache. If it happens again, open an issue on GitHub with the log and the details below.'
  const pre = document.createElement('pre')
  pre.textContent = `${message}\n${detail}`
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'apwt-btn'
  close.textContent = 'Dismiss'
  close.addEventListener('click', () => panel.remove())

  panel.append(title, body, pre, close)
  document.body.append(panel)
}
