/**
 * @apwt/tool-shell — the chrome every tool shares: page layout, loading overlay,
 * error reporting, log file input and the "Open in" hand-off between tools.
 */
export { ToolPage, SectionTitle, type ToolPageProps, type SectionTitleProps } from './ToolPage.js'
export { LoadingProvider, useLoading } from './loading.js'
export { installGlobalErrorReporter } from './errors.js'
export { readFileAsArrayBuffer, isDataflashFileName } from './file.js'
export {
  OPEN_IN_DESTINATIONS,
  openInDestinations,
  sendLogTo,
  onIncomingLog,
  type OpenInDestination,
  type IncomingLog
} from './open-in.js'
export { OpenInButton, type OpenInButtonProps } from './OpenInButton.js'
export { useLogFile, type LogFileState } from './useLogFile.js'
