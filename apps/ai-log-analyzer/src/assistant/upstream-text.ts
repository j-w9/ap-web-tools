/**
 * Texts upstream logAnalyzer.js showed in the chat, word for word. Where upstream appended an error
 * message, the port appends the same message (see docs/audit/ai-log-analyzer.md).
 */

/** `connectIfNeeded`, after creating a thread. */
export const CONNECTED_TEXT = 'Connected to AI assistant! Upload a log file or ask a question about drone flight analysis.'

/** `handleInvalidApiKey`. */
export const INVALID_KEY_TEXT = 'Invalid OpenAI API key (401). Please enter a valid key.'

/** `processUserMessage`, when connecting or posting the message fails. */
export const MESSAGE_FAILED_TEXT = 'Sorry, there was an error processing your message. Please try again.'

/** `handleRunStream`, on `thread.run.failed`. */
export const REQUEST_FAILED_TEXT = 'Sorry, there was an error processing your request. Please try again.'

/** `handleRunStream`, when the event stream throws. */
export const streamFailedText = (message: string): string => 'Error receiving response from assistant: ' + message

/** `handleRunStream`, when a chart cannot be downloaded. */
export const imageFailedText = (message: string): string => 'Failed to load a graph for visualization. ' + message

/** `updateAssistant`. */
export const updateFailedText = (message: string): string => 'Failed to update the assistant: ' + message

/** Errors `connectIfNeeded` throws. */
export const SESSION_TEXT = {
  invalidKey: 'Invalid API key (401)',
  assistant: 'Could not initialize assistant',
  thread: 'Could not create conversation thread'
} as const

/** `handleFileUpload`. */
export const processingText = (fileName: string): string => `Processing ${fileName}...`
export const LOG_UPLOADED_TEXT = 'Log file uploaded successfully. You can now ask questions about the log.'

/** `updateAssistant` button labels. */
export const UPDATE_LABELS = {
  idle: 'Update Assistant',
  updating: 'Updating...',
  updated: 'Updated',
  failed: 'Update Failed'
} as const

/**
 * `error.message` as upstream read it in a string concatenation: any value's `message` property,
 * converted to a string ("undefined" when there is none).
 */
export function upstreamMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return 'undefined'
}
