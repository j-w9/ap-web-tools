/**
 * @apwt/tool-shell — the frame every tool shares, styled after ArduPilot CustomBuild:
 * page layout, cards, controls, log input, busy overlay, theme, error reporting and the
 * "Open in" hand-off between tools.
 */
export {
  ToolPage,
  Section,
  ControlGroup,
  RailCard,
  type ToolPageProps,
  type SectionProps,
  type ControlGroupProps
} from './ToolPage.js'
export { LogInput, type LogInputProps, type LogFact } from './LogStrip.js'
export { ErrorBanner } from './ErrorBanner.js'
export { ThemeToggle } from './ThemeToggle.js'
export { useTheme } from './useTheme.js'
export { initialTheme, applyTheme, chooseTheme, currentTheme, onThemeChange, cssVar, type Theme } from './theme.js'
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
export { useLatest } from './useLatest.js'
export { Chip, RadioChips, CheckChips, ChipLabel, type ChipProps, type RadioChipsProps, type CheckChipsProps } from './Chips.js'
