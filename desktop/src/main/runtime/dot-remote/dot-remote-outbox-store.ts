import type { z } from 'zod'
import {
  type DotRemoteEventBatchResultSchema,
  DotRemoteEventSchema,
  type DotRemoteEvent
} from '../../../shared/dot-remote/dot-remote-events'
import type Database from '../../sqlite/sync-database'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { ensureDotRemoteSchema, runDotRemoteWrite } from './dot-remote-schema'

// RG6: every event is persisted, validated against its allowlisted schema, before it is sent. The
// source revision of a request grows by one per event, in the same transaction that records the facet
// signature, so a crash can neither lose an event nor send one aspect twice.

export type DotRemoteEventResult = z.infer<
  typeof DotRemoteEventBatchResultSchema
>['results'][number]

export type DotRemoteEnqueueInput = {
  dotRequestId: string
  /** The reported aspect, for example `status` or `prompt:<decisionId>`. */
  facet: string
  /** sha256 of what the aspect now says; an unchanged signature enqueues nothing. */
  signature: string
  timestamp: string
  build: (sourceRevision: number) => unknown
}

const SETTLED_RESULTS: ReadonlySet<string> = new Set(['applied', 'duplicate', 'stale'])

const stores = new WeakMap<OrchestrationDb, DotRemoteOutboxStore>()

export function getDotRemoteOutboxStore(owner: OrchestrationDb): DotRemoteOutboxStore {
  let store = stores.get(owner)
  if (!store) {
    store = new DotRemoteOutboxStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

function untracked(): OrchestrationError {
  return new OrchestrationError(
    'dot_remote_request_not_tracked',
    'Events are recorded only for a request accepted from the Site.'
  )
}

export class DotRemoteOutboxStore {
  constructor(private readonly db: Database.Database) {
    ensureDotRemoteSchema(db)
  }

  /** Persists the next event of a changed aspect; null when the aspect is unchanged. */
  enqueue(input: DotRemoteEnqueueInput): { eventId: string; sourceRevision: number } | null {
    return runDotRemoteWrite(this.db, 'dot_remote_outbox', () => {
      const request = this.db
        .prepare(
          'SELECT generation, last_revision FROM dot_remote_requests WHERE dot_request_id = ?'
        )
        .get(input.dotRequestId)
      if (typeof request?.generation !== 'number' || typeof request.last_revision !== 'number') {
        throw untracked()
      }
      const current = this.db
        .prepare('SELECT signature FROM dot_remote_facets WHERE dot_request_id = ? AND facet = ?')
        .get(input.dotRequestId, input.facet)
      if (current?.signature === input.signature) {
        return null
      }
      const revision = request.last_revision + 1
      const event = DotRemoteEventSchema.parse(input.build(revision))
      if (event.dotRequestId !== input.dotRequestId || event.sourceRevision !== revision) {
        throw untracked()
      }
      this.insertEvent(event, request.generation, input.timestamp)
      this.db
        .prepare(
          'UPDATE dot_remote_requests SET last_revision = ?, updated_at = ? WHERE dot_request_id = ?'
        )
        .run(revision, input.timestamp, input.dotRequestId)
      this.db
        .prepare(
          `INSERT INTO dot_remote_facets (dot_request_id, facet, signature, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (dot_request_id, facet) DO UPDATE SET signature = excluded.signature, updated_at = excluded.updated_at`
        )
        .run(input.dotRequestId, input.facet, input.signature, input.timestamp)
      return { eventId: event.eventId, sourceRevision: revision }
    })
  }

  /** Pending events of one generation in the order they were recorded (revisions ascend per request). */
  pending(generation: number, limit: number): DotRemoteEvent[] {
    return this.db
      .prepare(
        "SELECT body FROM dot_remote_outbox WHERE state = 'pending' AND generation = ? ORDER BY sequence LIMIT ?"
      )
      .all(generation, limit)
      .map((row) => DotRemoteEventSchema.parse(JSON.parse(String(row.body))))
  }

  countPending(): number {
    const row = this.db
      .prepare("SELECT count(*) AS n FROM dot_remote_outbox WHERE state = 'pending'")
      .get()
    return Number(row?.n ?? 0)
  }

  recordAttempt(eventIds: readonly string[], timestamp: string): void {
    this.updateEach(eventIds, (eventId) =>
      this.db
        .prepare(
          "UPDATE dot_remote_outbox SET attempts = attempts + 1, updated_at = ? WHERE event_id = ? AND state = 'pending'"
        )
        .run(timestamp, eventId)
    )
  }

  /** applied, duplicate and stale settle an event; conflict and unknown_request reject it for good. */
  markResults(results: readonly DotRemoteEventResult[], timestamp: string): void {
    runDotRemoteWrite(this.db, 'dot_remote_outbox', () => {
      for (const result of results) {
        const state = SETTLED_RESULTS.has(result.status) ? 'sent' : 'rejected'
        this.db
          .prepare(
            "UPDATE dot_remote_outbox SET state = ?, result = ?, updated_at = ? WHERE event_id = ? AND state = 'pending'"
          )
          .run(state, result.status, timestamp, result.eventId)
      }
    })
  }

  /** Recovery through the cursor: applied events above what the Site still holds are sent again. */
  requeueAbove(dotRequestId: string, appliedRevision: number, timestamp: string): number {
    return this.change(
      `UPDATE dot_remote_outbox SET state = 'pending', result = NULL, updated_at = ?
         WHERE dot_request_id = ? AND source_revision > ? AND state = 'sent' AND result IN ('applied', 'duplicate')`,
      [timestamp, dotRequestId, appliedRevision]
    )
  }

  /** Revocation: the Site refuses events of a revoked generation, so they are never sent. */
  fenceGeneration(generation: number, timestamp: string): number {
    return this.change(
      "UPDATE dot_remote_outbox SET state = 'fenced', updated_at = ? WHERE generation = ? AND state = 'pending'",
      [timestamp, generation]
    )
  }

  /** A new pairing: events recorded under any other generation can never be delivered. */
  fenceOtherGenerations(generation: number, timestamp: string): number {
    return this.change(
      "UPDATE dot_remote_outbox SET state = 'fenced', updated_at = ? WHERE generation != ? AND state = 'pending'",
      [timestamp, generation]
    )
  }

  purgeSettledBefore(before: string, limit: number): number {
    return this.change(
      `DELETE FROM dot_remote_outbox WHERE sequence IN (SELECT sequence FROM dot_remote_outbox
         WHERE state != 'pending' AND updated_at < ? ORDER BY sequence LIMIT ?)`,
      [before, limit]
    )
  }

  private insertEvent(event: DotRemoteEvent, generation: number, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO dot_remote_outbox (event_id, dot_request_id, source_revision, kind, body, generation,
           state, attempts, result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)`
      )
      .run(
        event.eventId,
        event.dotRequestId,
        event.sourceRevision,
        event.kind,
        JSON.stringify(event),
        generation,
        timestamp,
        timestamp
      )
  }

  private change(sql: string, parameters: (string | number)[]): number {
    return runDotRemoteWrite(this.db, 'dot_remote_outbox', () =>
      Number(this.db.prepare(sql).run(...parameters).changes)
    )
  }

  private updateEach(eventIds: readonly string[], update: (eventId: string) => unknown): void {
    runDotRemoteWrite(this.db, 'dot_remote_outbox', () => {
      for (const eventId of eventIds) {
        update(eventId)
      }
    })
  }
}
