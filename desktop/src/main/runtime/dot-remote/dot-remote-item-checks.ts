import { DOT_REMOTE_ALLOWED_SUBMIT_ACCESS } from '../../../shared/dot-remote/dot-remote-defaults'
import { dotRemoteNashRefusal } from '../../../shared/dot-remote/dot-remote-errors'
import {
  DotRemoteInboxItemSchema,
  type DotRemoteInboxItem
} from '../../../shared/dot-remote/dot-remote-inbox'
import type { DotRemoteItemOutcome, DotRemoteJournalEntry } from './dot-remote-item-journal'

// What NASH decides about a leased item before anything reaches its dot endpoint: the item is
// validated again against R2's schema, fenced by generation, answered from the journal when it was
// already decided, refused once expired, and capped at the remote access cap (R2's default read_only).

export type DotRemoteItemCheck =
  | { kind: 'dispatch'; item: DotRemoteInboxItem }
  | { kind: 'answer'; item: DotRemoteInboxItem; outcome: DotRemoteItemOutcome; journaled: boolean }
  | { kind: 'skip'; reason: 'invalid' | 'other_generation' | 'payload_changed' }

export type DotRemoteItemCheckContext = {
  readonly generation: number
  readonly now: number
  readonly journalEntry: (itemId: string) => DotRemoteJournalEntry | null
}

function allowedAccess(access: string): boolean {
  return DOT_REMOTE_ALLOWED_SUBMIT_ACCESS.some((allowed) => allowed === access)
}

export function checkLeasedItem(
  raw: unknown,
  context: DotRemoteItemCheckContext
): DotRemoteItemCheck {
  const parsed = DotRemoteInboxItemSchema.safeParse(raw)
  if (!parsed.success) {
    return { kind: 'skip', reason: 'invalid' }
  }
  const item = parsed.data
  if (item.lease.generation !== context.generation) {
    return { kind: 'skip', reason: 'other_generation' }
  }
  const journaled = context.journalEntry(item.itemId)
  if (journaled) {
    return journaled.payloadSha256 === item.payloadSha256
      ? { kind: 'answer', item, outcome: journaled.outcome, journaled: true }
      : { kind: 'skip', reason: 'payload_changed' }
  }
  if (Date.parse(item.expiresAt) <= context.now) {
    return { kind: 'answer', item, outcome: { outcome: 'expired' }, journaled: false }
  }
  if (item.kind === 'submit' && !allowedAccess(item.payload.requestedAccess)) {
    return {
      kind: 'answer',
      item,
      outcome: {
        outcome: 'refused',
        dotRequestId: null,
        refusal: dotRemoteNashRefusal('dot_access_above_maximum')
      },
      journaled: false
    }
  }
  return { kind: 'dispatch', item }
}
