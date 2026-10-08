import { translate } from '@/i18n/i18n'
import type { RunMessageSendResult } from '../../../../shared/workflow-run/workflow-run-view'

// Why sentences, not codes: the reason codes are C3's delivery vocabulary (D-019); the code stays out of the copy.
const QUEUED = new Map<string, () => string>([
  [
    'agent_busy',
    () =>
      translate(
        'workbench.runs.message.queued.agentBusy',
        'Queued. Claude is working, so the message waits in the session.'
      )
  ],
  [
    'dialog_open',
    () =>
      translate(
        'workbench.runs.message.queued.dialogOpen',
        'Held. A permission or question dialog is open; the message is sent after it closes.'
      )
  ],
  [
    'behind_held_message',
    () =>
      translate(
        'workbench.runs.message.queued.behindHeld',
        'Held. An earlier message has not been sent yet; this one follows it.'
      )
  ]
])

const REFUSED = new Map<string, () => string>([
  [
    'invalid_request',
    () =>
      translate(
        'workbench.runs.message.refused.invalidRequest',
        'The message request was not valid.'
      )
  ],
  [
    'request_id_reused',
    () =>
      translate(
        'workbench.runs.message.refused.requestIdReused',
        'This message ID was already used for different text.'
      )
  ],
  [
    'text_empty',
    () => translate('workbench.runs.message.refused.textEmpty', 'The message is empty.')
  ],
  [
    'text_too_long',
    () =>
      translate(
        'workbench.runs.message.refused.textTooLong',
        'The message is longer than 65,536 characters.'
      )
  ],
  [
    'control_characters',
    () =>
      translate(
        'workbench.runs.message.refused.controlCharacters',
        'The message contains control characters that cannot be typed into a terminal.'
      )
  ],
  [
    'secret_shaped',
    () =>
      translate(
        'workbench.runs.message.refused.secretShaped',
        'The message looks like it contains a secret, such as a key or token.'
      )
  ],
  [
    'too_many_quoted_spans',
    () =>
      translate(
        'workbench.runs.message.refused.tooManyQuotedSpans',
        'The message has too many quoted spans.'
      )
  ],
  [
    'not_english',
    () =>
      translate(
        'workbench.runs.message.refused.notEnglish',
        'Write the message in English; put names or text in another language in quotes.'
      )
  ],
  [
    'run_not_found',
    () => translate('workbench.runs.message.refused.runNotFound', 'The run was not found.')
  ],
  [
    'run_not_active',
    () => translate('workbench.runs.message.refused.runNotActive', 'The run is not active.')
  ],
  [
    'run_not_owned_by_source',
    () =>
      translate(
        'workbench.runs.message.refused.notOwned',
        'This run does not accept messages from here.'
      )
  ],
  [
    'primary_not_live',
    () =>
      translate(
        'workbench.runs.message.refused.primaryNotLive',
        'The Claude Code session is not running.'
      )
  ],
  [
    'hold_capacity_exceeded',
    () =>
      translate(
        'workbench.runs.message.refused.holdCapacity',
        'Too many messages are already waiting for this run.'
      )
  ],
  [
    'hold_expired',
    () =>
      translate(
        'workbench.runs.message.refused.holdExpired',
        'The message waited too long for the dialog to close and was dropped.'
      )
  ],
  [
    'terminal_unavailable',
    () =>
      translate(
        'workbench.runs.message.refused.terminalUnavailable',
        'The terminal could not be reached.'
      )
  ],
  [
    'delivery_incomplete',
    () =>
      translate(
        'workbench.runs.message.refused.deliveryIncomplete',
        'The text may be in the session input without being sent. Check the terminal; it was not retyped.'
      )
  ],
  [
    'delivery_unconfirmed',
    () =>
      translate(
        'workbench.runs.message.refused.deliveryUnconfirmed',
        'Delivery could not be confirmed after the app restarted.'
      )
  ]
])

// Why generic: an unknown reason code stays out of the UI; "Copy details" carries it.
function unknownRefusal(reason: string | null): string {
  return reason === null
    ? translate('workbench.runs.message.noReason', 'No reason was given.')
    : translate('workbench.runs.message.refusedGeneric', 'The session did not accept the message.')
}

/** `detail` is the refusal reason alone, for a callout whose title already says "not sent". */
export type RunMessageCopy = { tone: 'neutral' | 'warning'; text: string; detail: string | null }

/** One sentence for the outcome D-019 reports; the message text itself is never echoed. */
export function describeRunMessageResult(result: RunMessageSendResult): RunMessageCopy {
  const reason = result.reason
  if (result.outcome === 'delivered') {
    const delivered = translate('workbench.runs.message.delivered', 'Delivered to the session.')
    const text = result.duplicate
      ? `${delivered} ${translate(
          'workbench.runs.message.duplicate',
          'This message was sent before, so it was not sent again.'
        )}`
      : delivered
    return { tone: 'neutral', text, detail: null }
  }
  if (result.outcome === 'queued') {
    const known = reason === null ? undefined : QUEUED.get(reason)
    return {
      tone: 'neutral',
      text:
        known?.() ??
        translate(
          'workbench.runs.message.queuedGeneric',
          'Queued. It is sent when the session can take it.'
        ),
      detail: null
    }
  }
  const known = reason === null ? undefined : REFUSED.get(reason)
  const detail = known?.() ?? unknownRefusal(reason)
  return {
    tone: 'warning',
    text: `${translate('workbench.runs.message.notSentPrefix', 'Not sent.')} ${detail}`,
    detail
  }
}
