import { z } from 'zod'
import { redactAndBound } from '../../agent-exec-shared/secret-redaction'
import { ATTEMPT_NOTICE_BODY_MAX_CHARS } from '../orchestration/db/app-attempt-input'
import type { MessageRow, MessageType } from '../orchestration/types'
import type { AttemptEvidence } from './validation-context'

// An in-session attempt's result is the primary's task-report text: the body of B3's claim notice.

/** How many of the run's newest status messages are searched for the claim notice. */
const SESSION_REPORT_SCAN_LIMIT = 500

/** Orca's read-only mailbox history; it never flips the read bit. */
export type SessionReportMailbox = {
  getAllMessagesForHandle(toHandle: string, limit: number, types: MessageType[]): MessageRow[]
}

export type SessionReport =
  | { readonly status: 'ok'; readonly text: string; readonly messageId: string }
  | { readonly status: 'missing' | 'mismatched' }

const ClaimPayloadSchema = z.object({
  taskId: z.string(),
  dispatchId: z.string(),
  outcome: z.literal('claimed')
})

function claimPayloadOf(payload: string | null): z.infer<typeof ClaimPayloadSchema> | null {
  try {
    const parsed = ClaimPayloadSchema.safeParse(JSON.parse(payload ?? ''))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The claim notice this attempt filed, read without marking it read, and only if it names this attempt. */
export function readSessionReport(
  mailbox: SessionReportMailbox,
  attempt: Pick<AttemptEvidence, 'taskId' | 'runId' | 'dispatchId'>
): SessionReport {
  const claims = mailbox
    .getAllMessagesForHandle(`run:${attempt.runId}`, SESSION_REPORT_SCAN_LIMIT, ['status'])
    .filter(
      (row) =>
        row.from_handle === `dispatch:${attempt.dispatchId}` && claimPayloadOf(row.payload) !== null
    )
  if (claims.length === 0) {
    return { status: 'missing' }
  }
  const [claim] = claims
  const payload = claimPayloadOf(claim?.payload ?? null)
  if (
    !claim ||
    claims.length > 1 ||
    claim.run_id !== attempt.runId ||
    payload?.taskId !== attempt.taskId ||
    payload.dispatchId !== attempt.dispatchId
  ) {
    return { status: 'mismatched' }
  }
  // Why: the writer checked the body, but the reader bounds and masks it again before any prompt.
  const text = redactAndBound(claim.body, ATTEMPT_NOTICE_BODY_MAX_CHARS).text.trim()
  return text.length === 0 ? { status: 'missing' } : { status: 'ok', text, messageId: claim.id }
}
