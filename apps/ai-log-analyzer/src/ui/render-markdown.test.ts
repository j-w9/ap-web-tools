import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './render-markdown.js'

// DOMPurify needs a DOM, so only the Markdown step runs under Node; renderMarkdown sanitises in the browser.
describe('markdownToHtml', () => {
  it('renders the Markdown the assistant writes', () => {
    expect(markdownToHtml('**Vibe** is `high`')).toBe('<p><strong>Vibe</strong> is <code>high</code></p>\n')
    expect(markdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<table>')
    expect(markdownToHtml('- one\n- two')).toContain('<li>one</li>')
  })

  it('renders partial text while streaming', () => {
    expect(markdownToHtml('Partial **bo')).toBe('<p>Partial **bo</p>\n')
  })
})
