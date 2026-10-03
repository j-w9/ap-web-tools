// Widget message routing inside the sandbox page, and from the dashboard to it.
import { afterEach, describe, expect, it } from 'vitest'
import { errorLocation, SandboxRuntime, type SandboxPage } from './runtime.js'
import { ATTITUDE, encodeFrame, MavlinkParser } from '@apwt/mavlink'
import { toLegacyMessage } from '../mavlink/legacy-message.js'
import { createMavlinkPublisher, MAVLINK_CHANNEL } from './protocol.js'

interface FakeDiv {
  readonly id: number
  text: string
}

function setup() {
  const divs: FakeDiv[] = []
  const errors: { error: unknown; script: string }[] = []
  let intervalsCleared = 0
  const page: SandboxPage<FakeDiv> = {
    replaceDiv: () => {
      const div = { id: divs.length, text: '' }
      divs.push(div)
      return div
    },
    showError: (error, script) => errors.push({ error, script }),
    clearIntervals: () => {
      intervalsCleared++
    }
  }
  return { runtime: new SandboxRuntime(page), divs, errors, intervalsCleared: () => intervalsCleared }
}

// User scripts assign globals (`handle_msg = ...`), as they do in the frame.
const globals = globalThis as Record<string, unknown>
afterEach(() => {
  delete globals.handle_msg
  delete globals.handle_options
  delete globals.received
})

describe('sandbox runtime', () => {
  it('runs the script with its div and options, then routes messages to handle_msg', () => {
    const t = setup()
    t.runtime.handleFrameMessage({
      script: 'div.text = options.label\nreceived = []\nhandle_msg = function (msg) { received.push(msg._name) }',
      options: { label: 'Speed' }
    })
    expect(t.divs).toHaveLength(1)
    expect(t.divs[0]!.text).toBe('Speed')
    expect(t.intervalsCleared()).toBe(1)
    t.runtime.handleMavlink({ _name: 'ATTITUDE' })
    t.runtime.handleMavlink({ _name: 'VFR_HUD' })
    expect(globals.received).toEqual(['ATTITUDE', 'VFR_HUD'])
  })

  it('applies options before the script when both arrive together', () => {
    const t = setup()
    t.runtime.handleFrameMessage({ script: 'div.text = String(options.n)', options: { n: 3 } })
    expect(t.divs[0]!.text).toBe('3')
  })

  it('passes later options to handle_options when the script defines it', () => {
    const t = setup()
    t.runtime.handleFrameMessage({ script: 'received = []\nhandle_options = function (o) { received.push(o.n) }', options: {} })
    t.runtime.handleFrameMessage({ options: { n: 7 } })
    expect(globals.received).toEqual([7])
  })

  it('calls handlers as methods of the script instance', () => {
    const t = setup()
    t.runtime.handleFrameMessage({ script: 'handle_msg = function () { this.received = this === globalThis }', options: {} })
    t.runtime.handleMavlink({})
    expect(globals.received).toBe(true)
  })

  it('shows load errors with the script and stops routing', () => {
    const t = setup()
    t.runtime.handleFrameMessage({ script: 'handle_msg = function () {}\nnot valid (', options: {} })
    expect(t.errors).toHaveLength(1)
    expect(t.errors[0]!.script).toBe('handle_msg = function () {}\nnot valid (\n return this')
    expect(t.runtime.running).toBe(false)
  })

  it('shows handler errors, then retries the script when new options arrive', () => {
    const t = setup()
    t.runtime.handleFrameMessage({
      script: 'handle_msg = function (msg) { if (!(options.field in msg)) throw new Error("No field " + options.field) }',
      options: { field: 'roll' }
    })
    t.runtime.handleMavlink({ pitch: 1 })
    expect(String(t.errors[0]!.error)).toBe('Error: No field roll')
    expect(t.runtime.running).toBe(false)
    t.runtime.handleMavlink({ roll: 1 })
    expect(t.errors).toHaveLength(1)
    t.runtime.handleFrameMessage({ options: { field: 'pitch' } })
    expect(t.runtime.running).toBe(true)
    expect(t.divs).toHaveLength(2)
  })

  it('reports a missing handle_msg as an error, like calling undefined did upstream', () => {
    const t = setup()
    t.runtime.handleFrameMessage({ script: 'div.text = "static"', options: {} })
    t.runtime.handleMavlink({})
    expect(String(t.errors[0]!.error)).toContain('handle_msg is not a function')
  })

  it('ignores messages before a script is loaded and non-object posts', () => {
    const t = setup()
    t.runtime.handleMavlink({})
    t.runtime.handleFrameMessage('hello')
    t.runtime.handleFrameMessage({ options: {} })
    expect(t.divs).toHaveLength(0)
    expect(t.errors).toHaveLength(0)
  })

  it('locates errors in the user script', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- reproduces how the sandbox compiles user scripts
    const fn = new Function('div', 'options', 'const a = 1\nnull.x\n return this') as () => void
    let error: unknown
    try {
      fn()
    } catch (e) {
      error = e
    }
    expect(errorLocation(error)?.line).toBe(2)
    expect(errorLocation(new Error('no stack info'))).toBeNull()
  })
})

describe('MAVLink broadcast', () => {
  it('delivers { MAVLink: message } posts on the MAVLinkMSG channel, structured-cloned', async () => {
    const receiver = new BroadcastChannel(MAVLINK_CHANNEL)
    const received = new Promise<unknown>((resolve) => {
      receiver.onmessage = (event: MessageEvent<unknown>) => resolve(event.data)
    })
    const frame = encodeFrame(
      ATTITUDE,
      { timeBootMs: 5, roll: 0.5, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      { systemId: 1, componentId: 1, sequence: 0 }
    )
    const [parsed] = new MavlinkParser({ messages: [ATTITUDE] }).push(frame)
    const message = toLegacyMessage(parsed!, 77)
    const sender = new BroadcastChannel(MAVLINK_CHANNEL)
    createMavlinkPublisher(sender)(message)
    expect(await received).toEqual({ MAVLink: message })
    sender.close()
    receiver.close()
  })
})
