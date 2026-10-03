import { useMemo } from 'react'
import { renderMarkdown } from './render-markdown.js'

/** Sanitised Markdown block. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return <div className="ala-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
