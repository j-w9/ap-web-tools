/**
 * Which chosen files the page reads. Upstream offered `.bin` and `.log` files ("Click to upload
 * .bin/.log files for analysis") but read only names ending in `.bin`, and still showed "Log File
 * Ready" for the others: a proven bug (docs/bug-proofs/ai-log-analyzer.md #137). The port reads the
 * same files and reports the others as not read instead of ready.
 */

/** Upstream `handleFileUpload`'s test: `file.name.toLowerCase().endsWith(".bin")`. A log handed over by another tool (no name) is read. */
export function readsLogFile(name: string | null): boolean {
  return name === null || name.toLowerCase().endsWith('.bin')
}

/** Shown instead of "Log File Ready" for a chosen file the page does not read. */
export const logNotReadText = (name: string): string => `${name} was not read: only .bin logs can be analysed.`
