/** Assistant stream events the fake OpenAI server replays in the chat-flow oracle tests. */
import type { Json, StreamEvent } from './fake-openai.js'

export const textEvent = (id: string, value: string): StreamEvent => ({
  event: 'thread.message.delta',
  data: { id, object: 'thread.message.delta', delta: { content: [{ index: 0, type: 'text', text: { value } }] } }
})
export const imageEvent = (fileId: string): StreamEvent => ({
  event: 'thread.message.delta',
  data: {
    id: 'msg_img',
    object: 'thread.message.delta',
    delta: { content: [{ index: 0, type: 'image_file', image_file: { file_id: fileId } }] }
  }
})
export const requiresAction = (runId: string, ...calls: [string, string][]): StreamEvent => ({
  event: 'thread.run.requires_action',
  data: {
    id: runId,
    object: 'thread.run',
    status: 'requires_action',
    required_action: {
      type: 'submit_tool_outputs',
      submit_tool_outputs: {
        tool_calls: calls.map(([name, args], i): Json => ({
          id: `call_${i}`,
          type: 'function',
          function: { name, arguments: args }
        }))
      }
    }
  }
})
export const completed: StreamEvent = {
  event: 'thread.run.completed',
  data: { id: 'run', object: 'thread.run', status: 'completed' }
}
export const runFailed: StreamEvent = {
  event: 'thread.run.failed',
  data: { id: 'run', object: 'thread.run', status: 'failed', last_error: { code: 'server_error', message: 'boom' } }
}
export const streamError: StreamEvent = {
  event: 'error',
  data: { message: 'stream broke', type: 'server_error', code: null, param: null }
}
