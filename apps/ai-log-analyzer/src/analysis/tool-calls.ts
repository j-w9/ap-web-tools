/**
 * Answering the assistant's function calls locally (upstream `handleToolCall` and `window.get`).
 *
 * Calls come from the model, so arguments are checked at runtime, but with upstream's exact
 * semantics: the arguments are `JSON.parse`d first (invalid JSON threw), unsupported names and a
 * missing log are reported with upstream's failure texts, and `message_type` is used as a property
 * key, so any JSON value is converted to a string the way the `in` operator does.
 */
import type { DataflashLog } from '@apwt/dataflash'
import { describeColumns, getMessageColumns } from './message-data.js'
import { isFunctionToolName, type FunctionToolName, type ToolArguments } from './tool-definitions.js'

/** Name of the data file the assistant is told to read (upstream `output.json`). */
export const OUTPUT_FILE_NAME = 'output.json'

/** Why a call produced a failure output, which upstream reported to the assistant as text. */
export type ToolFailureReason = 'unsupported' | 'no-log' | 'no-data'

/**
 * Outcome of one call.
 *
 * - `data`: upstream uploaded the JSON as `output.json` and remembered its file id.
 * - `failure`: upstream sent `message` as the tool output. For `no-data` it also cleared the
 *   remembered file id (it assigned the tool's `undefined` result to it).
 * - `crash`: upstream threw inside `handleToolCall`; nothing was submitted and the run was left
 *   waiting. The port reports `message` as an error instead.
 */
export type ToolResult =
  | {
      readonly status: 'data'
      readonly json: string
      /** Short description for the activity list (upstream only logged the call to the console). */
      readonly summary: string
    }
  | { readonly status: 'failure'; readonly reason: ToolFailureReason; readonly message: string }
  | { readonly status: 'crash'; readonly message: string }

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string }

interface ToolHandler<N extends FunctionToolName> {
  /** Read the arguments as upstream did; `ok: false` where upstream threw. */
  parse(raw: unknown): Parsed<ToolArguments<N>>
  /** JSON for the assistant, or `undefined` where upstream's tool returned nothing. */
  run(log: DataflashLog, args: ToolArguments<N>): { readonly json: string; readonly summary: string } | undefined
  /** Upstream's failure text when `run` returns nothing. */
  readonly noDataMessage: string
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/** One handler per function tool; a missing tool is a compile error. */
const TOOL_HANDLERS: { readonly [N in FunctionToolName]: ToolHandler<N> } = {
  get: {
    parse(raw) {
      // `toolArguments.message_type` throws only for null (JSON has no undefined).
      if (raw === null) return { ok: false, message: "Cannot read properties of null (reading 'message_type')" }
      const value = isObject(raw) && !Array.isArray(raw) ? raw.message_type : undefined
      // `message in log.messageTypes` converts the key with ToPropertyKey, i.e. String().
      return { ok: true, value: { message_type: String(value) } }
    },
    run(log, args) {
      const columns = getMessageColumns(log, args.message_type)
      return columns && { json: JSON.stringify(columns), summary: describeColumns(args.message_type, columns) }
    },
    noDataMessage: 'failure, requested message type does not exist in message types'
  }
}

function runTool(handler: ToolHandler<FunctionToolName>, raw: unknown, log: DataflashLog | null): ToolResult {
  if (log === null) return { status: 'failure', reason: 'no-log', message: 'failure, user did not upload logs file' }
  const parsed = handler.parse(raw)
  if (!parsed.ok) return { status: 'crash', message: parsed.message }
  const result = handler.run(log, parsed.value)
  return result === undefined
    ? { status: 'failure', reason: 'no-data', message: handler.noDataMessage }
    : { status: 'data', json: result.json, summary: result.summary }
}

/**
 * Run one function call from the assistant.
 *
 * @param name Function name as sent by the model.
 * @param argumentsJson Arguments as the JSON text the model produced.
 * @param log The loaded log, or `null` when none is loaded yet.
 */
export function executeToolCall(name: string, argumentsJson: string, log: DataflashLog | null): ToolResult {
  let raw: unknown
  try {
    raw = JSON.parse(argumentsJson)
  } catch (error) {
    return { status: 'crash', message: error instanceof Error ? error.message : String(error) }
  }
  if (!isFunctionToolName(name)) {
    return { status: 'failure', reason: 'unsupported', message: 'failure, the function that was called is not supported' }
  }
  return runTool(TOOL_HANDLERS[name], raw, log)
}
