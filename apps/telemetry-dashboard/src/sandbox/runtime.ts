/**
 * The sandbox page's logic (upstream Widgets/SandBox.html): runs the widget's user script and
 * routes options and MAVLink messages to it.
 *
 * The user script is the body of `function (div, options) { ...; return this }`, called without a
 * receiver in sloppy mode, so `this` is the frame's `window` and the script's undeclared
 * assignments (`handle_msg = function (msg) {...}`, `handle_options = ...`) become globals the
 * runtime then calls. Any exception (at load or in a handler) replaces the widget with an error
 * report and stops the script until it is edited or new options arrive.
 *
 * Upstream's quirks are kept: a script that returns a primitive (`return 0` before the appended
 * `return this`) makes every later options message throw at `"handle_options" in user_class`,
 * which also skips a script sent in the same message, so the widget can no longer be edited; and
 * an error report that itself fails (a script throwing null) leaves the script running.
 */
import { inOperatorError, jsString, nullPropertyError, type JsonObject } from '../layout/json.js'

/** The page side the runtime draws on, injectable for tests. */
export interface SandboxPage<Div> {
  /** Replaces the page content with a fresh widget area and returns it. */
  replaceDiv(): Div
  /** Shows `error` for `script` (upstream `user_error`). */
  showError(error: unknown, script: string): void
  /** Upstream cleared interval ids 0-99 to stop the previous script's timers. */
  clearIntervals(): void
}

/** Calls `target[name](argument)` as a method, throwing as JavaScript would if it is not a function. */
function callMethod(target: unknown, name: string, argument: unknown): void {
  const method: unknown = Reflect.get(Object(target), name)
  if (typeof method !== 'function') throw new TypeError(`user_class.${name} is not a function`)
  Reflect.apply(method, target, [argument])
}

export class SandboxRuntime<Div> {
  private readonly page: SandboxPage<Div>
  /** What the script returned (its `this`, normally); null or undefined when not running. */
  private userClass: unknown = null
  private userScript: string | null = null
  private options: JsonObject = {}

  constructor(page: SandboxPage<Div>) {
    this.page = page
  }

  /** True while a script is loaded and has not failed. */
  get running(): boolean {
    return this.userClass !== null && this.userClass !== undefined
  }

  /** Upstream `user_error`; if drawing the report throws, the script stays loaded, as upstream. */
  private fail(error: unknown): void {
    this.page.showError(error, this.userScript ?? '')
    this.userClass = null
  }

  private loadUserScript(): void {
    this.userClass = null
    const div = this.page.replaceDiv()
    this.page.clearIntervals()
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the user's script is the widget's purpose
      const userFunction = new Function('div', 'options', this.userScript ?? '') as (div: Div, options: JsonObject) => unknown
      this.userClass = userFunction(div, this.options)
    } catch (error) {
      this.fail(error)
    }
  }

  /** A BroadcastChannel post: upstream `if (e?.data?.MAVLink) handle_MAVLink(e.data.MAVLink)`. */
  handleBroadcast(data: unknown): void {
    const message: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'MAVLink') : undefined
    if (message) this.handleMavlink(message)
  }

  /** A MAVLink message from the BroadcastChannel. */
  handleMavlink(message: unknown): void {
    if (!this.running) return
    try {
      callMethod(this.userClass, 'handle_msg', message)
    } catch (error) {
      this.fail(error)
    }
  }

  private handleOptions(options: JsonObject): void {
    this.options = options
    // A script that failed may have failed on bad options: try it again with the new ones.
    if (!this.running && this.userScript !== null) this.loadUserScript()
    const user = this.userClass
    if (user === null || user === undefined) return
    // `"handle_options" in user_class` threw for a primitive, outside any try (see above).
    if (typeof user !== 'object' && typeof user !== 'function') throw inOperatorError('handle_options', user)
    // `handle_options` is optional.
    if (!('handle_options' in user)) return
    try {
      callMethod(user, 'handle_options', options)
    } catch (error) {
      this.fail(error)
    }
  }

  /** A `postMessage` from the dashboard: options first, then the script, as upstream. */
  handleFrameMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) {
      // `"options" in data` threw upstream for primitives; nothing else happened.
      return
    }
    const record = data as Readonly<Record<string, unknown>>
    if ('options' in record) this.handleOptions(record.options as JsonObject)
    if ('script' in record) {
      this.userScript = concatString(record.script) + '\n return this'
      this.loadUserScript()
    }
  }
}

/** `'' + value` (upstream concatenated with `+`): `String(value)`, except that a Symbol throws. */
export function concatString(value: unknown): string {
  if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string')
  return String(value)
}

/**
 * Where an error happened in the user script, from `err.stack` (upstream regex and offset; a
 * thrown value without a stack gives none). Throws, as upstream's `err.stack` did, for a thrown
 * null or undefined.
 */
export function errorLocation(error: unknown): { readonly line: number; readonly column: string } | null {
  if (error === null || error === undefined) throw nullPropertyError(error, 'stack')
  const stack: unknown = Reflect.get(Object(error), 'stack')
  const match = /<(?:(?:anonymous)|(?:Function))>:([0-9]*):([0-9]*)/m.exec(jsString(stack))
  if (match === null) return null
  // The Function constructor adds two lines before the body.
  return { line: Number.parseInt(match[1]!, 10) - 2, column: match[2]! }
}
