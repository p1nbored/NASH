import { z } from 'zod'
import { DotRequestIdSchema } from '../../../shared/dot-ingress/dot-ingress-params'
import { DotRemoteNashRefusalSchema } from '../../../shared/dot-remote/dot-remote-errors'
import {
  DOT_REMOTE_ITEM_KINDS,
  type DotRemoteItemKind
} from '../../../shared/dot-remote/dot-remote-payload'
import type Database from '../../sqlite/sync-database'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { ensureDotRemoteSchema, runDotRemoteWrite } from './dot-remote-schema'

// RG5: delivery is at least once, so NASH journals its final outcome for an item before it acks.
// A lease that comes back after a lost ack is answered from the journal, never dispatched again.

/** The ack variants of dot-remote-ack.ts without the lease fields; the full ack is parsed when sent. */
export const DotRemoteItemOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('accepted'), dotRequestId: DotRequestIdSchema }).strict(),
  z.object({ outcome: z.literal('duplicate'), dotRequestId: DotRequestIdSchema }).strict(),
  z
    .object({
      outcome: z.literal('refused'),
      dotRequestId: DotRequestIdSchema.nullable(),
      refusal: DotRemoteNashRefusalSchema
    })
    .strict(),
  z.object({ outcome: z.literal('expired') }).strict()
])
const OutcomeSchema = DotRemoteItemOutcomeSchema

/** The outcome part of an ack: what NASH decided, without the lease that carried the item. */
export type DotRemoteItemOutcome = z.infer<typeof OutcomeSchema>

export type DotRemoteJournalEntry = {
  itemId: string
  kind: DotRemoteItemKind
  payloadSha256: string
  generation: number
  outcome: DotRemoteItemOutcome
  dotRequestId: string | null
  acked: boolean
}

const RowSchema = z.object({
  item_id: z.string(),
  kind: z.enum(DOT_REMOTE_ITEM_KINDS),
  payload_sha256: z.string(),
  generation: z.number().int(),
  outcome: z.string(),
  dot_request_id: z.string().nullable(),
  acked: z.union([z.literal(0), z.literal(1)])
})

function toEntry(row: unknown): DotRemoteJournalEntry {
  const stored = RowSchema.parse(row)
  return {
    itemId: stored.item_id,
    kind: stored.kind,
    payloadSha256: stored.payload_sha256,
    generation: stored.generation,
    outcome: OutcomeSchema.parse(JSON.parse(stored.outcome)),
    dotRequestId: stored.dot_request_id,
    acked: stored.acked === 1
  }
}

const stores = new WeakMap<OrchestrationDb, DotRemoteItemJournal>()

export function getDotRemoteItemJournal(owner: OrchestrationDb): DotRemoteItemJournal {
  let store = stores.get(owner)
  if (!store) {
    store = new DotRemoteItemJournal(owner.db)
    stores.set(owner, store)
  }
  return store
}

export class DotRemoteItemJournal {
  constructor(private readonly db: Database.Database) {
    ensureDotRemoteSchema(db)
  }

  get(itemId: string): DotRemoteJournalEntry | null {
    const row = this.db
      .prepare(
        'SELECT item_id, kind, payload_sha256, generation, outcome, dot_request_id, acked FROM dot_remote_items WHERE item_id = ?'
      )
      .get(itemId)
    return row ? toEntry(row) : null
  }

  /** The request an accepted submit item created; answers and messages name it on a refusal. */
  requestOfItem(itemId: string): string | null {
    return this.get(itemId)?.dotRequestId ?? null
  }

  /** The first outcome wins: a journal row is never rewritten with another decision. */
  record(input: {
    itemId: string
    kind: DotRemoteItemKind
    payloadSha256: string
    generation: number
    outcome: DotRemoteItemOutcome
    dotRequestId: string | null
    timestamp: string
  }): void {
    const outcome = JSON.stringify(OutcomeSchema.parse(input.outcome))
    runDotRemoteWrite(this.db, 'dot_remote_items', () => {
      this.db
        .prepare(
          `INSERT INTO dot_remote_items (item_id, kind, payload_sha256, generation, outcome, dot_request_id,
             acked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT (item_id) DO NOTHING`
        )
        .run(
          input.itemId,
          input.kind,
          input.payloadSha256,
          input.generation,
          outcome,
          input.dotRequestId,
          input.timestamp,
          input.timestamp
        )
    })
  }

  markAcked(itemId: string, timestamp: string): void {
    runDotRemoteWrite(this.db, 'dot_remote_items', () => {
      this.db
        .prepare('UPDATE dot_remote_items SET acked = 1, updated_at = ? WHERE item_id = ?')
        .run(timestamp, itemId)
    })
  }

  purgeBefore(before: string, limit: number): number {
    return runDotRemoteWrite(this.db, 'dot_remote_items', () =>
      Number(
        this.db
          .prepare(
            `DELETE FROM dot_remote_items WHERE item_id IN (SELECT item_id FROM dot_remote_items
               WHERE updated_at < ? ORDER BY updated_at LIMIT ?)`
          )
          .run(before, limit).changes
      )
    )
  }
}
