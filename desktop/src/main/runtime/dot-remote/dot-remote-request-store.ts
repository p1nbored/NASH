import { z } from 'zod'
import type Database from '../../sqlite/sync-database'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { ensureDotRemoteSchema, runDotRemoteWrite } from './dot-remote-schema'

// The dot requests NASH reports to the Site: one row per request accepted from a leased submit, with
// the pairing generation it was accepted under and its source revision counter. A facet signature
// records what was last reported for one aspect, so an unchanged aspect is never sent again.

export type DotRemoteTrackedRequest = {
  dotRequestId: string
  submitItemId: string
  generation: number
  lastRevision: number
}

const RequestRowSchema = z.object({
  dot_request_id: z.string(),
  submit_item_id: z.string(),
  generation: z.number().int(),
  last_revision: z.number().int()
})

function toTracked(row: unknown): DotRemoteTrackedRequest {
  const stored = RequestRowSchema.parse(row)
  return {
    dotRequestId: stored.dot_request_id,
    submitItemId: stored.submit_item_id,
    generation: stored.generation,
    lastRevision: stored.last_revision
  }
}

const SELECT_REQUEST =
  'SELECT dot_request_id, submit_item_id, generation, last_revision FROM dot_remote_requests'

const stores = new WeakMap<OrchestrationDb, DotRemoteRequestStore>()

export function getDotRemoteRequestStore(owner: OrchestrationDb): DotRemoteRequestStore {
  let store = stores.get(owner)
  if (!store) {
    store = new DotRemoteRequestStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

export class DotRemoteRequestStore {
  constructor(private readonly db: Database.Database) {
    ensureDotRemoteSchema(db)
  }

  get(dotRequestId: string): DotRemoteTrackedRequest | null {
    const row = this.db.prepare(`${SELECT_REQUEST} WHERE dot_request_id = ?`).get(dotRequestId)
    return row ? toTracked(row) : null
  }

  /** Idempotent: a request already tracked keeps its generation and revision counter. */
  track(input: {
    dotRequestId: string
    submitItemId: string
    generation: number
    timestamp: string
  }): void {
    runDotRemoteWrite(this.db, 'dot_remote_requests', () => {
      this.db
        .prepare(
          `INSERT INTO dot_remote_requests
             (dot_request_id, submit_item_id, generation, last_revision, open, created_at, updated_at)
           VALUES (?, ?, ?, 0, 1, ?, ?) ON CONFLICT (dot_request_id) DO NOTHING`
        )
        .run(
          input.dotRequestId,
          input.submitItemId,
          input.generation,
          input.timestamp,
          input.timestamp
        )
    })
  }

  /** Oldest first, so a long list never starves the first requests. */
  listOpen(limit: number): DotRemoteTrackedRequest[] {
    return this.db
      .prepare(`${SELECT_REQUEST} WHERE open = 1 ORDER BY created_at, dot_request_id LIMIT ?`)
      .all(limit)
      .map(toTracked)
  }

  close(dotRequestId: string, timestamp: string): void {
    runDotRemoteWrite(this.db, 'dot_remote_requests', () => {
      this.db
        .prepare('UPDATE dot_remote_requests SET open = 0, updated_at = ? WHERE dot_request_id = ?')
        .run(timestamp, dotRequestId)
    })
  }

  /** Revocation: the Site refuses every later event of this generation, so tracking stops. */
  closeGeneration(generation: number, timestamp: string): number {
    return runDotRemoteWrite(this.db, 'dot_remote_requests', () =>
      Number(
        this.db
          .prepare(
            'UPDATE dot_remote_requests SET open = 0, updated_at = ? WHERE generation = ? AND open = 1'
          )
          .run(timestamp, generation).changes
      )
    )
  }

  /** A new pairing: requests accepted under any other generation can no longer be reported. */
  closeOtherGenerations(generation: number, timestamp: string): number {
    return runDotRemoteWrite(this.db, 'dot_remote_requests', () =>
      Number(
        this.db
          .prepare(
            'UPDATE dot_remote_requests SET open = 0, updated_at = ? WHERE generation != ? AND open = 1'
          )
          .run(timestamp, generation).changes
      )
    )
  }

  /** The facets of one family, for example every `message:` facet of a request. */
  facetKeys(dotRequestId: string, prefix: string): string[] {
    return this.db
      .prepare(
        'SELECT facet FROM dot_remote_facets WHERE dot_request_id = ? AND substr(facet, 1, ?) = ? ORDER BY facet'
      )
      .all(dotRequestId, prefix.length, prefix)
      .map((row) => String(row.facet))
  }

  facetSignature(dotRequestId: string, facet: string): string | null {
    const row = this.db
      .prepare('SELECT signature FROM dot_remote_facets WHERE dot_request_id = ? AND facet = ?')
      .get(dotRequestId, facet)
    return typeof row?.signature === 'string' ? row.signature : null
  }
}
