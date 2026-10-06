import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import {
  DotRequestIdSchema,
  DotWorkspaceRefSchema
} from '../../../../shared/dot-ingress/dot-ingress-params'
import { WorkbenchPositiveIntegerSchema } from '../../../../shared/workbench-request'
import { DOT_INGRESS_EVENT_KINDS } from './dot-ingress-schema-definition'
import { parseDotInput, parseDotRow } from './dot-ingress-store-input'

export type DotIngressEventKind = (typeof DOT_INGRESS_EVENT_KINDS)[number]

/** Audit rows hold a kind, ids, a revision and a time: never an objective, a label or a path. */
export type DotIngressEvent = {
  sequence: number
  kind: DotIngressEventKind
  dotRequestId: string | null
  workspaceRef: string | null
  revision: number | null
  recordedAt: string
}

type NewDotIngressEvent = {
  kind: DotIngressEventKind
  dotRequestId?: string
  workspaceRef?: string
  revision?: number
  timestamp: string
}

const EventRowSchema = z.object({
  sequence: z.number().int().positive(),
  kind: z.enum(DOT_INGRESS_EVENT_KINDS),
  dot_request_id: DotRequestIdSchema.nullable(),
  workspace_ref: DotWorkspaceRefSchema.nullable(),
  revision: z.number().int().positive().nullable(),
  recorded_at: z.string()
})

const EventListSchema = z
  .object({
    limit: z.number().int().min(1).max(1000),
    beforeSequence: WorkbenchPositiveIntegerSchema.optional()
  })
  .strict()

export function insertDotIngressEvent(db: Database.Database, event: NewDotIngressEvent): void {
  db.prepare(
    `INSERT INTO dot_ingress_events (kind, dot_request_id, workspace_ref, revision, recorded_at)
      VALUES (?, ?, ?, ?, ?)`
  ).run(
    event.kind,
    event.dotRequestId ?? null,
    event.workspaceRef ?? null,
    event.revision ?? null,
    event.timestamp
  )
}

/** Newest first. */
export function listDotIngressEvents(
  db: Database.Database,
  options: { limit: number; beforeSequence?: number }
): DotIngressEvent[] {
  const { limit, beforeSequence } = parseDotInput(EventListSchema, options, 'event list')
  return db
    .prepare(
      `SELECT sequence, kind, dot_request_id, workspace_ref, revision, recorded_at
        FROM dot_ingress_events WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`
    )
    .all(beforeSequence ?? Number.MAX_SAFE_INTEGER, limit)
    .map((row) => {
      const stored = parseDotRow(EventRowSchema, row)
      return {
        sequence: stored.sequence,
        kind: stored.kind,
        dotRequestId: stored.dot_request_id,
        workspaceRef: stored.workspace_ref,
        revision: stored.revision,
        recordedAt: stored.recorded_at
      }
    })
}
