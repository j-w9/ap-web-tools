/**
 * Connecting and updating the assistant (upstream `connectIfNeeded` after the key form, and
 * `updateAssistant`), with upstream's chat lines. Framework-free; the UI keeps the state.
 */
import { asBackendError, type AssistantBackend } from '../assistant/backend.js'
import { INVALID_KEY_TEXT } from '../assistant/upstream-text.js'
import { connectedNotice, errorEvents, type TurnEvent } from './turn.js'

/**
 * Connect after a key was entered. `prompt-key`: the key was rejected (upstream
 * `handleInvalidApiKey`). `ready`: connected, or failed for another reason, which upstream left
 * unhandled while keeping the key, so the next message connects again.
 */
export async function connectAssistant(
  backend: AssistantBackend,
  emit: (event: TurnEvent) => void
): Promise<'ready' | 'prompt-key'> {
  try {
    if (await backend.connect()) emit({ type: 'notice', notice: connectedNotice })
    return 'ready'
  } catch (e) {
    const error = asBackendError(e)
    if (error.promptForKey) {
      emit({ type: 'notice', notice: { tone: 'error', text: INVALID_KEY_TEXT, detail: null } })
      emit({ type: 'prompt-key' })
      return 'prompt-key'
    }
    // Upstream showed nothing here (an unhandled rejection); the port shows upstream's error text.
    emit({ type: 'notice', notice: { tone: 'error', text: error.message, detail: error.detail } })
    return 'ready'
  }
}

/**
 * Upstream `updateAssistant`: `skipped` when there is no assistant yet (the button did nothing),
 * otherwise `updated` or `failed` for the button label.
 */
export async function updateAssistant(
  backend: AssistantBackend,
  emit: (event: TurnEvent) => void
): Promise<'skipped' | 'updated' | 'failed'> {
  try {
    if (!(await backend.recreateAssistant())) return 'skipped'
    emit({ type: 'notice', notice: connectedNotice })
    return 'updated'
  } catch (e) {
    errorEvents(asBackendError(e)).forEach(emit)
    return 'failed'
  }
}
