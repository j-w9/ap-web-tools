/**
 * The assistant's tools, ported from upstream `AILogAnalyzer/assistantTools.json`.
 *
 * The table is `as const` so the function names and argument types are derived from it: adding a
 * function tool here makes `FunctionToolName` grow, and `TOOL_HANDLERS` (tool-calls.ts) then fails
 * to compile until the new tool has a handler. The shape matches the OpenAI Assistants `tools`
 * parameter, checked where it is sent (assistant/openai-backend.ts), so this module stays free of
 * provider imports.
 */
export const ASSISTANT_TOOLS = [
  { type: 'code_interpreter' },
  { type: 'file_search' },
  {
    type: 'function',
    function: {
      name: 'get',
      description: 'Retrieve information related to the specified message type.',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          message_type: {
            type: 'string',
            description: 'The type of message to retrieve information for (e.g., GPS, CTUN, VIBE).'
          }
        },
        required: ['message_type'],
        additionalProperties: false
      }
    }
  }
] as const

/** Function tools only; `code_interpreter` and `file_search` run on the provider's side. */
export type FunctionToolDefinition = Extract<(typeof ASSISTANT_TOOLS)[number], { type: 'function' }>

/** Names of the tools this page answers locally. */
export type FunctionToolName = FunctionToolDefinition['function']['name']

/** TypeScript type of one JSON-schema property. */
type SchemaValue<P> = P extends { type: 'string' }
  ? string
  : P extends { type: 'number' | 'integer' }
    ? number
    : P extends { type: 'boolean' }
      ? boolean
      : never

type Definition<N extends FunctionToolName> = Extract<FunctionToolDefinition, { function: { name: N } }>
type Properties<N extends FunctionToolName> = Definition<N>['function']['parameters']['properties']

/**
 * Arguments of one tool, derived from its JSON schema. Every property is required because the
 * tools use OpenAI strict mode, which requires all properties to be listed in `required`.
 */
export type ToolArguments<N extends FunctionToolName> = {
  readonly [K in keyof Properties<N>]: SchemaValue<Properties<N>[K]>
}

/** A validated call of one of the local tools. */
export type ToolCall = { [N in FunctionToolName]: { readonly name: N; readonly args: ToolArguments<N> } }[FunctionToolName]

/** Names of the function tools, for runtime checks. */
export const FUNCTION_TOOL_NAMES: readonly FunctionToolName[] = ASSISTANT_TOOLS.flatMap((t) =>
  t.type === 'function' ? [t.function.name] : []
)

export function isFunctionToolName(name: string): name is FunctionToolName {
  return FUNCTION_TOOL_NAMES.some((n) => n === name)
}
