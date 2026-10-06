import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from './orchestration-db'
import { dispatchOrphanedSql } from './autopilot-orphan-detection'
import { RelativePathSchema } from './autopilot-relative-path'
import { ensureAutopilotRuntimeSchema } from './autopilot-runtime-schema'
import { ARTIFACT_ROOTS } from './autopilot-task-schema-definition'
import {
  AutopilotIdSchema,
  ReasonCodeSchema,
  Sha256HexSchema,
  UtcTimestampSchema,
  parseAutopilotInput,
  parseStoredRow,
  runAutopilotWrite
} from './autopilot-store-input'

/** Caps what one attempt can record, so a runaway executor cannot grow the table. */
export const ATTEMPT_ARTIFACT_LIMIT_PER_DISPATCH = 256

export const AttemptArtifactInputSchema = z
  .object({
    dispatchId: AutopilotIdSchema,
    kind: ReasonCodeSchema,
    root: z.enum(ARTIFACT_ROOTS),
    relativePath: RelativePathSchema,
    sha256: Sha256HexSchema,
    sizeBytes: z.number().int().min(0),
    timestamp: UtcTimestampSchema
  })
  .strict()
export type AttemptArtifactInput = z.input<typeof AttemptArtifactInputSchema>

export type AttemptArtifactRecord = {
  artifactId: string
  dispatchId: string
  kind: string
  root: (typeof ARTIFACT_ROOTS)[number]
  relativePath: string
  sha256: string
  sizeBytes: number
  createdAt: string
  /** True once Orca no longer holds the Dispatch, as after any Orca reset. */
  orphaned: boolean
}

const RowSchema = z.object({
  artifact_id: z.string(),
  dispatch_id: z.string(),
  kind: z.string(),
  root: z.enum(ARTIFACT_ROOTS),
  relative_path: z.string(),
  sha256: z.string(),
  size_bytes: z.number(),
  created_at: z.string(),
  orphaned: z.number()
})

const SELECT_ARTIFACT = `SELECT artifact_id, dispatch_id, kind, root, relative_path, sha256, size_bytes, created_at,
  ${dispatchOrphanedSql('attempt_artifacts.dispatch_id')} AS orphaned FROM attempt_artifacts`

function toRecord(row: unknown): AttemptArtifactRecord {
  const stored = parseStoredRow(RowSchema, row, 'attempt artifact')
  return {
    artifactId: stored.artifact_id,
    dispatchId: stored.dispatch_id,
    kind: stored.kind,
    root: stored.root,
    relativePath: stored.relative_path,
    sha256: stored.sha256,
    sizeBytes: stored.size_bytes,
    createdAt: stored.created_at,
    orphaned: stored.orphaned === 1
  }
}

const stores = new WeakMap<OrchestrationDb, AttemptArtifactStore>()

export function getAttemptArtifactStore(owner: OrchestrationDb): AttemptArtifactStore {
  let store = stores.get(owner)
  if (!store) {
    store = new AttemptArtifactStore(owner.db)
    stores.set(owner, store)
  }
  return store
}

/** Files an attempt produced, by hash: the path is relative to a root the app names, never absolute. */
export class AttemptArtifactStore {
  constructor(private readonly db: Database.Database) {
    ensureAutopilotRuntimeSchema(db)
  }

  get(artifactId: string): AttemptArtifactRecord | null {
    const row = this.db.prepare(`${SELECT_ARTIFACT} WHERE artifact_id = ?`).get(artifactId)
    return row ? toRecord(row) : null
  }

  listForDispatch(dispatchId: string): AttemptArtifactRecord[] {
    return this.db
      .prepare(`${SELECT_ARTIFACT} WHERE dispatch_id = ? ORDER BY sequence`)
      .all(dispatchId)
      .map(toRecord)
  }

  /** One row per file of an attempt: the same file again is a duplicate, changed content a conflict. */
  record(input: AttemptArtifactInput): { duplicate: boolean; record: AttemptArtifactRecord } {
    const params = parseAutopilotInput(AttemptArtifactInputSchema, input, 'attempt artifact')
    return runAutopilotWrite(this.db, 'autopilot_artifact', () => {
      const attempt = this.db
        .prepare(
          `SELECT 1 AS found FROM dispatch_contexts d
             JOIN task_specs s ON s.task_id = d.task_id AND s.run_id = d.run_id
            WHERE d.id = ?`
        )
        .get(params.dispatchId)
      if (!attempt) {
        throw new OrchestrationError('autopilot_attempt_not_found', 'The attempt was not found.')
      }
      const existing = this.db
        .prepare(`${SELECT_ARTIFACT} WHERE dispatch_id = ? AND root = ? AND relative_path = ?`)
        .get(params.dispatchId, params.root, params.relativePath)
      if (existing) {
        const record = toRecord(existing)
        if (record.sha256 === params.sha256 && record.sizeBytes === params.sizeBytes) {
          return { duplicate: true, record }
        }
        throw new OrchestrationError(
          'autopilot_artifact_conflict',
          'That file was already recorded with different content.'
        )
      }
      const recorded = this.db
        .prepare('SELECT count(*) AS n FROM attempt_artifacts WHERE dispatch_id = ?')
        .get(params.dispatchId)
      if (Number(recorded?.n) >= ATTEMPT_ARTIFACT_LIMIT_PER_DISPATCH) {
        throw new OrchestrationError(
          'autopilot_artifact_capacity_exceeded',
          'This attempt has recorded too many files.'
        )
      }
      const artifactId = `artifact_${randomUUID()}`
      this.db
        .prepare(
          `INSERT INTO attempt_artifacts (artifact_id, dispatch_id, kind, root, relative_path, sha256,
            size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          artifactId,
          params.dispatchId,
          params.kind,
          params.root,
          params.relativePath,
          params.sha256,
          params.sizeBytes,
          params.timestamp
        )
      const record = this.get(artifactId)
      if (!record) {
        throw new OrchestrationError('autopilot_recovery_required', 'The artifact row disappeared.')
      }
      return { duplicate: false, record }
    })
  }
}
