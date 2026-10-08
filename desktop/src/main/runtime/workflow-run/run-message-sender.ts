import { errorCodeOf, type PrimaryTerminalPort } from './primary-session-ports'

export type RunMessageSendResult =
  /** Paste and Enter reached the agent; an idle agent takes it as its next turn, a busy one queues it. */
  | { readonly kind: 'sent' }
  /** A permission or question dialog was open, and nothing was written. */
  | { readonly kind: 'dialog_blocked' }
  /** Nothing was written. */
  | { readonly kind: 'not_written'; readonly code: string }
  /** The paste may sit in the composer without Enter; it must never be sent again. */
  | { readonly kind: 'incomplete' }

const DIALOG_BLOCKED = 'agent_prompt_blocked'
const NOT_WRITABLE = 'terminal_not_writable'

/**
 * Types one follow-up message with Orca's own prompt writer, `sendTerminalAgentPrompt`: one bracketed
 * paste frame, Enter only after its permission checks pass, queued when the agent is busy. Orca calls
 * `beforeWrite` before the paste and again before Enter, which tells a refusal before any byte from
 * one after the paste.
 */
export async function sendRunMessageToPrimary(
  terminal: Pick<PrimaryTerminalPort, 'sendTerminalAgentPrompt'>,
  handle: string,
  text: string,
  requestId: string,
  assertMayWrite?: () => void
): Promise<RunMessageSendResult> {
  let writesStarted = 0
  let accepted = false
  try {
    const send = await terminal.sendTerminalAgentPrompt(handle, text, {
      inputKind: 'driving',
      acceptQueued: true,
      requestId,
      // The receipt settles once input lands; what the agent does with it is the pane's to show.
      observationTimeoutMs: 0,
      beforeWrite: () => {
        assertMayWrite?.()
        writesStarted += 1
      },
      onInputAccepted: () => {
        accepted = true
      }
    })
    if (send.accepted || accepted) {
      return { kind: 'sent' }
    }
    return writesStarted >= 2
      ? { kind: 'incomplete' }
      : { kind: 'not_written', code: 'prompt_not_accepted' }
  } catch (error) {
    if (accepted) {
      return { kind: 'sent' }
    }
    const code = errorCodeOf(error)
    if (writesStarted >= 2) {
      return { kind: 'incomplete' }
    }
    if (code === DIALOG_BLOCKED) {
      return { kind: 'dialog_blocked' }
    }
    // Before the paste, or a paste write that failed: no byte reached the terminal.
    if (writesStarted === 0 || code === NOT_WRITABLE) {
      return { kind: 'not_written', code }
    }
    return { kind: 'incomplete' }
  }
}
