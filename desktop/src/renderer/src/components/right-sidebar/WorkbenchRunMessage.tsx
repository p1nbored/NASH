import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import { WORKBENCH_RUN_MESSAGE_MAX_UNITS } from '../../../../shared/rpc-contract/workbench-run-params'
import type { RunMessageAttempt, WorkbenchRuns } from './use-workbench-runs'
import WorkbenchCallout from './WorkbenchCallout'
import { errorDetails, type WorkbenchDetail } from './workbench-details'
import { describeRunMessageResult } from './workbench-run-message-copy'

type MessageInput = { text: string; idempotencyKey: string }
type SentAttempt = { attempt: RunMessageAttempt; idempotencyKey: string }

function messageDetails(runId: string, sent: SentAttempt): WorkbenchDetail[] {
  const base: WorkbenchDetail[] = [
    ['run_id', runId],
    ['idempotency_key', sent.idempotencyKey]
  ]
  if (!sent.attempt.ok) {
    return [...base, ...errorDetails(sent.attempt.error)]
  }
  const { result } = sent.attempt
  return [
    ...base,
    ['outcome', result.outcome],
    ['reason', result.reason],
    ['message_id', result.messageId],
    ['state', result.state],
    ['duplicate', String(result.duplicate)]
  ]
}

function MessageOutcome({ runId, sent }: { runId: string; sent: SentAttempt }): React.JSX.Element {
  const { attempt } = sent
  const details = { subject: 'run message', entries: messageDetails(runId, sent) }
  if (!attempt.ok) {
    return (
      <WorkbenchCallout
        role="alert"
        tone="error"
        label={translate('workbench.runs.message.failedTitle', 'Message not confirmed')}
        details={details}
      >
        <p className="break-words">{attempt.error.message}</p>
        <p className="text-muted-foreground">
          {translate(
            'workbench.runs.message.retryHintShort',
            'Sending it again will not deliver it twice.'
          )}
        </p>
      </WorkbenchCallout>
    )
  }
  const copy = describeRunMessageResult(attempt.result)
  if (copy.tone === 'warning') {
    return (
      <WorkbenchCallout
        role="alert"
        label={translate('workbench.runs.message.refusedTitle', 'Message not sent')}
        details={details}
      >
        <p className="break-words">{copy.detail ?? copy.text}</p>
      </WorkbenchCallout>
    )
  }
  return (
    <p role="status" className="break-words text-meta text-foreground">
      {copy.text}
    </p>
  )
}

// Why a new key per message: the key is the message's source request id (D-019); only a retry reuses it.
export default function WorkbenchRunMessage({
  runId,
  sendMessage
}: {
  runId: string
  sendMessage: WorkbenchRuns['sendMessage']
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<SentAttempt | null>(null)
  const retryRef = useRef<MessageInput | null>(null)
  const fieldId = useId()
  const helpId = useId()
  const empty = text.trim().length === 0

  const submit = async (): Promise<void> => {
    if (sending || empty) {
      return
    }
    const retry = retryRef.current
    const input = retry?.text === text ? retry : { text, idempotencyKey: createBrowserUuid() }
    retryRef.current = input
    setSending(true)
    const result = await sendMessage(runId, input)
    setSending(false)
    setSent({ attempt: result, idempotencyKey: input.idempotencyKey })
    if (!result.ok) {
      return
    }
    retryRef.current = null
    // Why keep refused text: the user edits it rather than retyping it.
    if (result.result.outcome !== 'refused') {
      setText('')
    }
  }

  return (
    <form
      className="space-y-1.5 pt-1"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Label htmlFor={fieldId}>
        {translate('workbench.runs.message.label', 'Message to the session')}
      </Label>
      <Textarea
        id={fieldId}
        aria-describedby={helpId}
        value={text}
        maxLength={WORKBENCH_RUN_MESSAGE_MAX_UNITS}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        rows={2}
      />
      <div className="flex items-start justify-between gap-3">
        <p id={helpId} className="text-meta text-muted-foreground">
          {translate(
            'workbench.runs.message.helpShort',
            'Typed into the primary session; held while a dialog is open.'
          )}
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={sending || empty}>
          {translate('workbench.runs.message.send', 'Send message')}
        </Button>
      </div>
      {sent && <MessageOutcome runId={runId} sent={sent} />}
    </form>
  )
}
