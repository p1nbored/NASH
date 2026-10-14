import type { AgentJournalSubmission } from './agent-session-journal-types'
import { handedOffQueuedMessageIds } from './structured-agent-session-draft-hand-off'

/**
 * Where the host's published state holds a client's sends, by the id each was sent under: as a
 * card (on the queue, or handed off from it), or recorded as a submission. Either settles the send,
 * whichever of that and the send's own answer comes first; a card wins.
 */
export function structuredAgentSessionSettledSends(
  submissions: readonly AgentJournalSubmission[],
  queuedMessageIds: readonly string[]
): {
  cards: ReadonlySet<string>
  recorded: ReadonlyMap<string, AgentJournalSubmission>
} {
  return {
    cards: new Set([...queuedMessageIds, ...handedOffQueuedMessageIds(submissions)]),
    recorded: new Map(submissions.map((submission) => [submission.clientMessageId, submission]))
  }
}
