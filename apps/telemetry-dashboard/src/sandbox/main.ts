/**
 * Entry of `sandbox.html`, the document each sandbox widget runs in (upstream
 * Widgets/SandBox.html). It defines the `mavlink20` global user scripts may use, then routes
 * `postMessage` options/scripts and BroadcastChannel MAVLink messages to the user script.
 */
import { installLegacyMavlink20 } from '../mavlink/legacy-namespace.js'
import { MAVLINK_CHANNEL } from './protocol.js'
import { errorLocation, SandboxRuntime, type SandboxPage } from './runtime.js'

installLegacyMavlink20()

/** A fresh widget area: inset, rounded grey border, white background (upstream `replace_div`). */
function replaceDiv(): HTMLDivElement {
  const div = document.createElement('div')
  Object.assign(div.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    bottom: '0',
    right: '0',
    margin: '10px',
    border: '5px solid',
    borderRadius: '10px',
    borderColor: '#c8c8c8',
    backgroundColor: '#ffffff',
    padding: '5px'
  })
  document.body.replaceChildren(div)
  return div
}

/** Upstream `user_error`: the error, the offending line in red with one line either side. */
function showError(error: unknown, script: string): void {
  const div = replaceDiv()
  div.style.overflow = 'auto'
  const text = document.createTextNode('')
  div.append(text)

  const location = errorLocation(error)
  console.log(error)
  text.nodeValue = (location === null ? '' : `${location.line}:${location.column} `) + String(error)

  const lines = script.split('\n')
  const lineOk = (i: number): boolean => lines[i] !== undefined
  // Upstream started from `null - 1` when no location was found, which is never a valid line.
  const line = location === null ? -1 : location.line - 1
  if (lineOk(line)) {
    div.append(document.createElement('br'))
    const para = document.createElement('p')
    para.style.margin = '5px'
    para.style.border = 'solid'
    para.style.padding = '5px'
    div.append(para)
    if (lineOk(line - 1)) {
      para.append(document.createTextNode(`${line}|${lines[line - 1]}`), document.createElement('br'))
    }
    const errorLine = document.createElement('span')
    errorLine.style.color = 'red'
    // As upstream: the line is inserted as HTML (inside this sandboxed frame).
    errorLine.innerHTML = `${line + 1}|${lines[line]}`
    para.append(errorLine, document.createElement('br'))
    if (lineOk(line + 1)) {
      para.append(document.createTextNode(`${line + 2}|${lines[line + 1]}`), document.createElement('br'))
    }
  }
  div.style.borderColor = 'red'
}

const page: SandboxPage<HTMLDivElement> = {
  replaceDiv,
  showError,
  clearIntervals: () => {
    for (let i = 0; i < 100; i++) window.clearInterval(i)
  }
}

const runtime = new SandboxRuntime(page)

window.addEventListener('message', (event: MessageEvent<unknown>) => runtime.handleFrameMessage(event.data))

const broadcast = new BroadcastChannel(MAVLINK_CHANNEL)
broadcast.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data
  if (typeof data === 'object' && data !== null && 'MAVLink' in data && data.MAVLink !== null && data.MAVLink !== undefined) {
    runtime.handleMavlink(data.MAVLink)
  }
}
