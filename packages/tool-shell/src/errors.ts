/**
 * Report uncaught errors to the user. Upstream shows an alert asking for a hard reload
 * and a GitHub issue; we keep that behaviour but make the install idempotent.
 */
export function installGlobalErrorReporter(): void {
  const w = window as Window & { __apwtErrorReporter?: boolean }
  if (w.__apwtErrorReporter) return
  w.__apwtErrorReporter = true

  const report = (message: string, detail: string): void => {
    window.alert(
      'Sorry, something went wrong.\n\n' +
        'Please try a hard reload of this page to clear its cache.\n\n' +
        'If the error persists open an issue on the GitHub repo.\n' +
        'Include a copy of the log and the following error message:\n\n' +
        `${message}\n${detail}`
    )
  }

  window.addEventListener('error', (event) => {
    report(event.message, `URL: ${event.filename}\nLine Number: ${event.lineno}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    report('Unhandled promise rejection', detail)
  })
}
