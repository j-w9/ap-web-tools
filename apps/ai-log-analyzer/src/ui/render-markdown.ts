/**
 * Markdown for assistant replies (upstream: marked + DOMPurify from a CDN). The HTML from marked
 * is always sanitised before it reaches the DOM, because the text comes from the model.
 */
import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** Markdown to unsanitised HTML; never insert the result without {@link renderMarkdown}. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true })
}

let hooksInstalled = false

function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  // Links in replies open in a new tab and cannot reach back into this page.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

/** Markdown to sanitised HTML, safe for `dangerouslySetInnerHTML`. Browser only. */
export function renderMarkdown(markdown: string): string {
  installHooks()
  return DOMPurify.sanitize(markdownToHtml(markdown))
}
