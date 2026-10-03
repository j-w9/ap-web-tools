/**
 * The public contract between the dashboard and widget iframes (documented in `WIDGETS.md`).
 * User widgets depend on it, so it is exactly upstream's:
 *
 * - Page to iframe, `postMessage(data, '*')`: `{ script, options }` when a sandbox widget loads or
 *   its script is edited, `{ options }` when its form changes (custom HTML widgets only ever get
 *   `{ options }`). Receivers test `"options" in data` and `"script" in data`, in that order.
 * - MAVLink: every decoded message is posted as `{ MAVLink: message }` on the BroadcastChannel
 *   named `MAVLinkMSG`, which any same-origin document (iframe or other tab) can listen to.
 */
import type { JsonObject } from '../layout/json.js'
import type { LegacyMessage } from '../mavlink/legacy-message.js'

/** BroadcastChannel carrying decoded messages. */
export const MAVLINK_CHANNEL = 'MAVLinkMSG'

/** One BroadcastChannel post. */
export interface MavlinkBroadcast {
  readonly MAVLink: LegacyMessage
}

/** Sandbox widget start-up or script edit. */
export interface ScriptMessage {
  readonly script: string
  readonly options: JsonObject
}

/** Form contents changed. */
export interface OptionsMessage {
  readonly options: JsonObject
}

/** Anything the page posts to a widget iframe. */
export type FrameMessage = ScriptMessage | OptionsMessage

/** Posts to a widget iframe as upstream did (any origin: the frame may be `srcdoc`). */
export function postToFrame(frame: HTMLIFrameElement, message: FrameMessage): void {
  frame.contentWindow?.postMessage(message, '*')
}

/** Iframe sandbox flags: scripts, and same origin so the frame can join the BroadcastChannel. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin'

/** Publishes decoded messages to every widget (upstream: `broadcast.postMessage({ MAVLink: m })`). */
export function createMavlinkPublisher(
  channel: BroadcastChannel = new BroadcastChannel(MAVLINK_CHANNEL)
): (message: LegacyMessage) => void {
  return (message) => {
    const post: MavlinkBroadcast = { MAVLink: message }
    channel.postMessage(post)
  }
}
