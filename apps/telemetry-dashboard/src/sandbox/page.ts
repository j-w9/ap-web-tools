/**
 * The sandbox page's drawing (upstream Widgets/SandBox.html `replace_div` and `user_error`), over a
 * minimal document interface so the output can be compared with upstream's (see `page.test.ts`).
 */
import { concatString, errorLocation, type SandboxPage } from './runtime.js'

/** The style properties the page sets. */
export interface PageStyle {
  position: string
  top: string
  left: string
  bottom: string
  right: string
  margin: string
  border: string
  borderRadius: string
  borderColor: string
  backgroundColor: string
  padding: string
  overflow: string
  color: string
}

export interface PageText {
  nodeValue: string | null
}

/** An element whose children are nodes of type `N`. */
export interface PageElement<N> {
  readonly style: PageStyle
  innerHTML: string
  append(...nodes: N[]): void
}

export interface PageDocument<N, E extends PageElement<N> & N, T extends PageText & N> {
  createElement(tag: 'div' | 'p' | 'span' | 'br'): E
  createTextNode(text: string): T
  readonly body: { replaceChildren(...nodes: N[]): void }
}

export function createSandboxPage<N, E extends PageElement<N> & N, T extends PageText & N>(
  doc: PageDocument<N, E, T>,
  clearInterval: (id: number) => void
): SandboxPage<E> {
  /** A fresh widget area: inset, rounded grey border, white background (upstream `replace_div`). */
  const replaceDiv = (): E => {
    const div = doc.createElement('div')
    div.style.position = 'absolute'
    div.style.top = '0'
    div.style.left = '0'
    div.style.bottom = '0'
    div.style.right = '0'
    div.style.margin = '10px'
    div.style.border = '5px solid'
    div.style.borderRadius = '10px'
    div.style.borderColor = '#c8c8c8'
    div.style.backgroundColor = '#ffffff'
    div.style.padding = '5px'
    doc.body.replaceChildren(div)
    return div
  }

  /** Upstream `user_error`: the error, the offending line in red with one line either side. */
  const showError = (error: unknown, script: string): void => {
    const div = replaceDiv()
    div.style.overflow = 'auto'
    const text = doc.createTextNode('')
    div.append(text)

    // Upstream's `err.stack` threw for a thrown null or undefined, and `extra + err` for a Symbol, so
    // the report stopped here and the script stayed loaded (proven bug #160). Both now get a text.
    const location = errorLocation(error)
    console.log(error)
    const message = typeof error === 'symbol' ? String(error) : concatString(error)
    text.nodeValue = (location === null ? '' : `${location.line}:${location.column} `) + message

    const lines = script.split('\n')
    const lineOk = (i: number): boolean => lines[i] !== undefined
    // Upstream started from `null - 1` when no location was found, which is never a valid line.
    const line = location === null ? -1 : location.line - 1
    if (lineOk(line)) {
      div.append(doc.createElement('br'))
      const para = doc.createElement('p')
      para.style.margin = '5px'
      para.style.border = 'solid'
      para.style.padding = '5px'
      div.append(para)
      if (lineOk(line - 1)) para.append(doc.createTextNode(`${line}|${lines[line - 1]}`), doc.createElement('br'))
      const errorLine = doc.createElement('span')
      errorLine.style.color = 'red'
      // As upstream: the line is inserted as HTML (inside this sandboxed frame).
      errorLine.innerHTML = `${line + 1}|${lines[line]}`
      para.append(errorLine, doc.createElement('br'))
      if (lineOk(line + 1)) para.append(doc.createTextNode(`${line + 2}|${lines[line + 1]}`), doc.createElement('br'))
    }
    div.style.borderColor = 'red'
  }

  return {
    replaceDiv,
    showError,
    clearIntervals: () => {
      for (let i = 0; i < 100; i++) clearInterval(i)
    }
  }
}
