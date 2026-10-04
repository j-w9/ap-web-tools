// Oracle: upstream Widgets/SandBox.html's script run in node:vm against a fake document, and the
// port's runtime and page drawing against the same fake, fed the same messages; the resulting
// documents (and whether each message threw) must be identical.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { UPSTREAM_DIR } from '../test-support/upstream-mavlink.js'
import { createSandboxPage, type PageStyle } from './page.js'
import { SandboxRuntime } from './runtime.js'

class FakeText {
  constructor(public nodeValue: string | null) {}
}

function blankStyle(): PageStyle {
  return {
    position: '',
    top: '',
    left: '',
    bottom: '',
    right: '',
    margin: '',
    border: '',
    borderRadius: '',
    borderColor: '',
    backgroundColor: '',
    padding: '',
    overflow: '',
    color: ''
  }
}

class FakeElement {
  readonly style = blankStyle()
  readonly children: (FakeElement | FakeText)[] = []
  innerHTML = ''
  constructor(readonly tag: string) {}
  append(...nodes: (FakeElement | FakeText)[]): void {
    this.children.push(...nodes)
  }
  appendChild(node: FakeElement | FakeText): void {
    this.children.push(node)
  }
}

type FakeNode = FakeElement | FakeText

class FakeDocument {
  readonly body = {
    children: [] as FakeElement[],
    replaceChildren: (...nodes: FakeElement[]): void => {
      this.body.children = nodes
    }
  }
  createElement(tag: 'div' | 'p' | 'span' | 'br'): FakeElement {
    return new FakeElement(tag)
  }
  createTextNode(text: string): FakeText {
    return new FakeText(text)
  }
}

/** The document as data; style values as the browser stores them (strings). */
function serialise(node: FakeNode): unknown {
  if (node instanceof FakeText) return { text: node.nodeValue }
  const style = Object.fromEntries(
    Object.entries(node.style)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => [k, String(v)])
  )
  return { tag: node.tag, style, html: node.innerHTML, children: node.children.map(serialise) }
}

/** Every text node's value in a serialised body, in document order. */
function texts(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(texts)
  if (typeof node !== 'object' || node === null) return []
  if ('text' in node) return [node.text]
  return 'children' in node ? texts(node.children) : []
}

/** The border colour of each top-level widget area in a serialised body. */
function borderColors(body: unknown): unknown[] {
  return Array.isArray(body)
    ? body.map((div: unknown) =>
        typeof div === 'object' && div !== null && 'style' in div ? Reflect.get(Object(div.style), 'borderColor') : undefined
      )
    : []
}

type Step = { readonly frame: unknown } | { readonly broadcast: unknown }

interface Run {
  readonly body: unknown
  readonly threw: readonly boolean[]
}

const quiet = { log: () => undefined }

function runUpstream(steps: readonly Step[]): Run {
  const html = readFileSync(resolve(UPSTREAM_DIR, 'TelemetryDashboard/Widgets/SandBox.html'), 'utf8')
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (script === undefined) throw new Error('no module script in SandBox.html')
  const doc = new FakeDocument()
  let onFrame: ((e: { data: unknown }) => void) | undefined
  let channel: { onmessage?: ((e: { data: unknown }) => void) | undefined } | undefined
  const context: Record<string, unknown> = {
    document: doc,
    console: quiet,
    BroadcastChannel: class {
      onmessage: ((e: { data: unknown }) => void) | undefined = undefined
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- the script sets onmessage on this instance
        channel = this
      }
    }
  }
  context.window = {
    addEventListener: (_type: string, listener: (e: { data: unknown }) => void) => {
      onFrame = listener
    },
    clearInterval: () => undefined
  }
  // A module script is strict code; in the browser its stack frames name the page.
  runInContext(`'use strict';\n${script}`, createContext(context), {
    filename: 'http://localhost/TelemetryDashboard/Widgets/SandBox.html'
  })
  const threw = steps.map((step) => {
    try {
      if ('frame' in step) onFrame?.({ data: step.frame })
      else channel?.onmessage?.({ data: step.broadcast })
      return false
    } catch {
      return true
    }
  })
  return { body: doc.body.children.map(serialise), threw }
}

function runPort(steps: readonly Step[]): Run {
  const doc = new FakeDocument()
  // User scripts read the frame's `document` global.
  Reflect.set(globalThis, 'document', doc)
  const log = console.log
  console.log = quiet.log
  try {
    const runtime = new SandboxRuntime(createSandboxPage<FakeNode, FakeElement, FakeText>(doc, () => undefined))
    const threw = steps.map((step) => {
      try {
        if ('frame' in step) runtime.handleFrameMessage(step.frame)
        else runtime.handleBroadcast(step.broadcast)
        return false
      } catch {
        return true
      }
    })
    return { body: doc.body.children.map(serialise), threw }
  } finally {
    console.log = log
  }
}

const USER_GLOBALS = ['handle_msg', 'handle_options', 'message_report', 'document']
afterEach(() => {
  for (const name of USER_GLOBALS) Reflect.deleteProperty(globalThis, name)
})

function expectSame(steps: readonly Step[]): void {
  const theirs = runUpstream(steps)
  for (const name of USER_GLOBALS) Reflect.deleteProperty(globalThis, name)
  const ours = runPort(steps)
  expect(ours).toEqual(theirs)
}

const DEFAULT_SCRIPT = `// Initialization
div.appendChild(document.createTextNode("Widget Example:"))
div.appendChild(document.createElement("br"))

message_report = document.createTextNode("No Data")
div.appendChild(message_report)

// Runtime function
handle_msg = function (msg) {
    message_report.nodeValue = "Got: " + msg._name
}
`

describe('sandbox page against upstream SandBox.html', () => {
  it('runs the default script and routes messages to it', () => {
    expectSame([{ frame: { script: DEFAULT_SCRIPT, options: {} } }, { broadcast: { MAVLink: { _name: 'ATTITUDE' } } }])
  })

  it('ignores falsy MAVLink posts and other channel traffic', () => {
    expectSame([
      { frame: { script: DEFAULT_SCRIPT, options: {} } },
      { broadcast: { MAVLink: 0 } },
      { broadcast: { other: 1 } },
      { broadcast: null },
      { broadcast: { MAVLink: { _name: 'X' } } }
    ])
  })

  it('draws a load error with the line and its neighbours', () => {
    expectSame([{ frame: { script: 'const a = 1\nconst b = a.c.d\nconst e = 3', options: {} } }])
  })

  it('draws a syntax error', () => {
    expectSame([{ frame: { script: 'const a = (\n', options: {} } }])
  })

  it('draws a handler error, then retries the script when new options arrive', () => {
    const script = 'handle_msg = function (msg) {\n  if (!(options.field in msg)) throw new Error("No field " + options.field)\n}'
    expectSame([
      { frame: { script, options: { field: 'roll' } } },
      { broadcast: { MAVLink: { pitch: 1 } } },
      { broadcast: { MAVLink: { roll: 1 } } },
      { frame: { options: { field: 'pitch' } } },
      { broadcast: { MAVLink: { pitch: 1 } } }
    ])
  })

  it('passes options to handle_options', () => {
    expectSame([
      { frame: { script: 'handle_options = function (o) { div.appendChild(document.createTextNode(o.n)) }', options: {} } },
      { frame: { options: { n: '7' } } }
    ])
  })

  it('proven bug #159: a script that returns a primitive can still be edited', () => {
    const steps = (end: string): Step[] => [
      { frame: { script: `div.appendChild(document.createTextNode("old"))${end}`, options: {} } },
      { frame: { options: {} } },
      {
        frame: {
          script:
            'div.appendChild(document.createTextNode("new"))\nhandle_msg = function (msg) { div.appendChild(document.createTextNode(msg._name)) }',
          options: {}
        }
      },
      { broadcast: { MAVLink: { _name: 'A' } } }
    ]
    // Upstream: every options message throws at `"handle_options" in 0` and the edit never loads;
    // the old script (whose instance is 0) then fails on the message.
    const theirs = runUpstream(steps('\nreturn 0'))
    expect(theirs.threw).toEqual([false, true, true, false])
    expect(texts(theirs.body)).toEqual(['TypeError: user_class.handle_msg is not a function'])
    // Port: the edit loads, exactly as upstream loads it for a script that returns nothing.
    for (const name of USER_GLOBALS) Reflect.deleteProperty(globalThis, name)
    const ours = runPort(steps('\nreturn 0'))
    expect(ours.threw).toEqual([false, false, false, false])
    expect(texts(ours.body)).toEqual(['new', 'A'])
    for (const name of USER_GLOBALS) Reflect.deleteProperty(globalThis, name)
    expect(ours).toEqual(runUpstream(steps('')))
  })

  it('proven bug #160: a script that throws null, undefined or a Symbol is reported and stopped', () => {
    const cases: [thrown: string, sameAs: string][] = [
      ['null', '"null"'],
      ['undefined', '"undefined"'],
      ['Symbol("s")', '"Symbol(s)"']
    ]
    for (const [thrown, sameAs] of cases) {
      const steps = (value: string): Step[] => [
        { frame: { script: `handle_msg = function () { throw ${value} }`, options: {} } },
        { broadcast: { MAVLink: { _name: 'A' } } },
        { broadcast: { MAVLink: { _name: 'B' } } }
      ]
      // Upstream: the report itself throws, the border stays grey and every message throws again.
      const theirs = runUpstream(steps(thrown))
      expect(theirs.threw, thrown).toEqual([false, true, true])
      expect(borderColors(theirs.body), thrown).toEqual(['#c8c8c8'])
      // Port: reported (red border, the value as text) and stopped, exactly as upstream reports the
      // same text thrown as a string.
      for (const name of USER_GLOBALS) Reflect.deleteProperty(globalThis, name)
      const ours = runPort(steps(thrown))
      expect(ours.threw, thrown).toEqual([false, false, false])
      expect(borderColors(ours.body), thrown).toEqual(['red'])
      for (const name of USER_GLOBALS) Reflect.deleteProperty(globalThis, name)
      expect(ours, thrown).toEqual(runUpstream(steps(sameAs)))
    }
  })

  it('reports thrown non-errors and missing handlers as upstream', () => {
    expectSame([{ frame: { script: 'throw "plain"', options: {} } }])
    expectSame([{ frame: { script: 'div.x = 1', options: {} } }, { broadcast: { MAVLink: { _name: 'A' } } }])
    expectSame([{ frame: { script: 7, options: {} } }])
  })

  it('ignores posts that are not objects, as upstream (whose `in` threw)', () => {
    const steps: Step[] = [{ frame: 'text' }, { frame: { script: DEFAULT_SCRIPT, options: {} } }]
    const theirs = runUpstream(steps)
    const ours = runPort(steps)
    expect(ours.body).toEqual(theirs.body)
    expect(theirs.threw).toEqual([true, false])
  })
})
