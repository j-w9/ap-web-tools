/**
 * The WebSocket as the session sees it. Handlers are bound once at creation and can be detached,
 * matching upstream's `oldSocket.onopen = oldSocket.onclose = ... = null` before closing.
 */
export interface SocketHandlers {
  open(): void
  error(): void
  close(code: number, reason: string): void
  message(data: Uint8Array): void
}

export interface LinkSocket {
  /** `readyState === WebSocket.OPEN`. */
  readonly isOpen: boolean
  /** May throw (e.g. while connecting). */
  send(bytes: Uint8Array): void
  /** May throw for invalid close codes. */
  close(code: number, reason: string): void
  /** Stops delivering events to the handlers. */
  detach(): void
}

/** Opens a socket; throws as the `WebSocket` constructor does (bad URL, blocked by the browser). */
export type SocketFactory = (url: string, handlers: SocketHandlers) => LinkSocket

export const browserSocket: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  let attached = true
  ws.onopen = () => {
    if (attached) handlers.open()
  }
  ws.onerror = () => {
    if (attached) handlers.error()
  }
  ws.onclose = (event) => {
    if (attached) handlers.close(event.code, event.reason)
  }
  ws.onmessage = (event: MessageEvent<unknown>) => {
    if (attached && event.data instanceof ArrayBuffer) handlers.message(new Uint8Array(event.data))
  }
  return {
    get isOpen() {
      return ws.readyState === WebSocket.OPEN
    },
    send: (bytes) => ws.send(Uint8Array.from(bytes)),
    close: (code, reason) => ws.close(code, reason),
    detach() {
      attached = false
    }
  }
}
