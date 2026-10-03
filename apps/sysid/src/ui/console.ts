/**
 * The output console. Upstream's Python redirects `sys.stdout` to the element with id `output`
 * (`capture_output.py`) and writes to its value directly, so the console is a DOM element
 * addressed by that id rather than React state; TypeScript appends to it the same way.
 */
export const OUTPUT_ELEMENT_ID = 'output'

function element(): HTMLTextAreaElement | null {
  const el = document.getElementById(OUTPUT_ELEMENT_ID)
  return el instanceof HTMLTextAreaElement ? el : null
}

/** Upstream `addToOutput`: append a line. */
export function appendOutput(message: string): void {
  const el = element()
  if (!el) return
  el.value += message + '\n'
  el.scrollTop = el.scrollHeight
}

export function clearOutput(): void {
  const el = element()
  if (el) el.value = ''
}
