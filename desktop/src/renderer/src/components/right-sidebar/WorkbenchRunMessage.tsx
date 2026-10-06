import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import { WORKBENCH_RUN_MESSAGE_MAX_UNITS } from '../../../../shared/rpc-contract/workbench-run-params'
import type { RunMessageAttempt, WorkbenchRuns } from './use-workbench-runs'
import WorkbenchCallout from './WorkbenchCallout'
import { describeRunMessageResult } from './workbench-run-message-copy'

type MessageInput = { text: string; idempotencyKey: string }

function MessageOutcome({ attempt }: { attempt: RunMessageAttempt }): React.JSX.Element {
  if (!attempt.ok) {
    return (
      <WorkbenchCallout
        role="alert"
        label={translate('workbench.runs.message.failedTitle', 'Message not confirmed')}
      >
        <p className="break-words">{attempt.error.message}</p>
        <p className="break-words font-mono">{attempt.error.code}</p>
        <p>
          {translate(
            'workbench.runs.message.retryHint',
            'Sending again reuses the same message ID, so it is not delivered twice.'
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
      >
        <p className="break-words">{copy.detail ?? copy.text}</p>
      </WorkbenchCallout>
    )
  }
  return (
    <p role="status" className="break-words text-xs text-foreground">
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
  const [attempt, setAttempt] = useState<RunMessageAttempt | null>(null)
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
    setAttempt(result)
    if (!result.ok) {
      return
    }
    retryRef.current = null
    // Why keep refused text: the user edits it (for example into English) rather than retyping it.
    if (result.result.outcome !== 'refused') {
      setText('')
    }
  }

  return (
    <form
      className="space-y-2"
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
        <p id={helpId} className="text-xs text-muted-foreground">
          {translate(
            'workbench.runs.message.help',
            'English only. Typed into the Claude Code session; held while a dialog is open.'
          )}
        </p>
        <Button type="submit" variant="secondary" size="sm" disabled={sending || empty}>
          {translate('workbench.runs.message.send', 'Send message')}
        </Button>
      </div>
      {attempt && <MessageOutcome attempt={attempt} />}
    </form>
  )
}
