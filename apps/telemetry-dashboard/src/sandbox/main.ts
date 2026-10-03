/**
 * Entry of `sandbox.html`, the document each sandbox widget runs in (upstream
 * Widgets/SandBox.html). It defines the `mavlink20` global user scripts may use, then routes
 * `postMessage` options/scripts and BroadcastChannel MAVLink messages to the user script.
 */
import { installLegacyMavlink20 } from '../mavlink/legacy-namespace.js'
import { createSandboxPage } from './page.js'
import { MAVLINK_CHANNEL } from './protocol.js'
import { SandboxRuntime } from './runtime.js'

installLegacyMavlink20()

const runtime = new SandboxRuntime(createSandboxPage<Node, HTMLElement, Text>(document, (id) => window.clearInterval(id)))

window.addEventListener('message', (event: MessageEvent<unknown>) => runtime.handleFrameMessage(event.data))

const broadcast = new BroadcastChannel(MAVLINK_CHANNEL)
broadcast.onmessage = (event: MessageEvent<unknown>) => runtime.handleBroadcast(event.data)
