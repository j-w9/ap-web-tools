// Proofs for the sandbox page rows: a script returning a primitive (#159) and a script throwing
// null or a Symbol (#160). The original Widgets/SandBox.html module script runs in node:vm over a
// fake document; messages are what Widgets/SandBox.js posts.
import { describe, expect, it } from 'vitest'
import { loadSandboxPage, sandboxText, type SandboxElement } from './_harness.js'

function text(body: readonly SandboxElement[]): string {
  return body.map(sandboxText).join('|')
}

describe('#159 a sandbox script that returns a primitive can no longer be edited', () => {
  it('every later {script, options} post throws before the edited script is read', () => {
    const page = loadSandboxPage()
    // WidgetSandBox.init / set_edited_text post the script and the options together (SandBox.js:65-70, 99-104).
    expect(page.frame({ script: 'div.appendChild(document.createTextNode("old"))\nreturn 0', options: {} })).toBe(false)
    expect(text(page.body())).toBe('old')

    expect(page.frame({ script: 'div.appendChild(document.createTextNode("new"))', options: {} })).toBe(true)
    expect(text(page.body())).toBe('old')

    // A MAVLink message reports `user_class.handle_msg is not a function` and clears the class...
    expect(page.broadcast({ MAVLink: { _name: 'HEARTBEAT' } })).toBe(false)
    expect(text(page.body())).toContain('handle_msg is not a function')

    // ...but the next edit re-runs the old script first (SandBox.html:145-149) and throws again.
    expect(page.frame({ script: 'div.appendChild(document.createTextNode("new"))', options: {} })).toBe(true)
    expect(text(page.body())).toBe('old')
  })
})

describe('#160 a sandbox script that throws null keeps running and keeps failing', () => {
  it('throw null: the error area is drawn empty, the report throws and the script stays loaded', () => {
    const page = loadSandboxPage()
    expect(page.frame({ script: 'handle_msg = function () { throw null }', options: {} })).toBe(false)
    expect(page.broadcast({ MAVLink: { _name: 'A' } })).toBe(true)
    const [area] = page.body()
    expect(area?.children.map((c) => sandboxText(c))).toEqual([''])
    expect(area?.style.borderColor).toBe('#c8c8c8')
    expect(page.broadcast({ MAVLink: { _name: 'B' } })).toBe(true)
  })

  it('throw Symbol: the report throws at the string concatenation', () => {
    const page = loadSandboxPage()
    expect(page.frame({ script: 'handle_msg = function () { throw Symbol("s") }', options: {} })).toBe(false)
    expect(page.broadcast({ MAVLink: { _name: 'A' } })).toBe(true)
    expect(page.broadcast({ MAVLink: { _name: 'B' } })).toBe(true)
  })

  it('control: a thrown Error is drawn in a red-bordered area and the script is stopped', () => {
    const page = loadSandboxPage()
    expect(page.frame({ script: 'handle_msg = function () { throw new Error("x") }', options: {} })).toBe(false)
    expect(page.broadcast({ MAVLink: { _name: 'A' } })).toBe(false)
    expect(text(page.body())).toContain('Error: x')
    expect(page.body()[0]?.style.borderColor).toBe('red')
    expect(page.broadcast({ MAVLink: { _name: 'B' } })).toBe(false)
  })
})
