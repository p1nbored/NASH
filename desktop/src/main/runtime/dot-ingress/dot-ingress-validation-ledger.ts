import { z } from 'zod'
import {
  DOT_VALIDATION_DECIDE_OUTCOMES,
  DOT_VALIDATION_DECISIONS,
  DotValidationIdSchema,
  type DotValidationDecideOutcome,
  type DotValidationDecision
} from '../../../shared/dot-ingress/dot-ingress-validation'
import { DotRequestIdSchema } from '../../../shared/dot-ingress/dot-ingress-params'
import type Database from '../../sqlite/sync-database'
import { sqlStringList } from '../orchestration/db/autopilot-run-schema-definition'
import {
  dotIngressError,
  parseDotRow,
  runDotWrite
} from '../orchestration/db/dot-ingress-store-input'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'

// G7: dot's decisionId is the idempotency key of a validation decision, so the first outcome of each
// id is kept here and a replay answers from it. A family of its own (no Orca or dot ingress table is
// changed, no foreign key outside it); it holds ids, codes and times only, never text.

export const DOT_VALIDATION_LEDGER_SCHEMA_VERSION = 1
/** The newest rows kept; a decision id older than this many decisions is no longer recognised. */
export const DOT_VALIDATION_LEDGER_MAX_ROWS = 10_000

const UUID_LENGTH = 36

export const DOT_VALIDATION_LEDGER_SCHEMA_DEFINITIONS = [
  {
    name: 'dot_validation_ledger_schema',
    sql: 'CREATE TABLE dot_validation_ledger_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)'
  },
  {
    name: 'dot_validation_decisions',
    sql: `CREATE TABLE dot_validation_decisions (
      sequence INTEGER PRIMARY KEY,
      decision_id TEXT UNIQUE NOT NULL CHECK (length(decision_id) = ${UUID_LENGTH}),
      validation_id TEXT NOT NULL CHECK (length(validation_id) BETWEEN 1 AND 128),
      dot_request_id TEXT NOT NULL CHECK (length(dot_request_id) = ${UUID_LENGTH}),
      decision TEXT NOT NULL CHECK (decision IN (${sqlStringList(DOT_VALIDATION_DECISIONS)})),
      outcome TEXT NOT NULL CHECK (outcome IN (${sqlStringList(DOT_VALIDATION_DECIDE_OUTCOMES)})),
      decided_at TEXT,
      recorded_at TEXT NOT NULL,
      CHECK ((outcome = 'closed') = (decided_at IS NULL))
    )`
  },
  {
    name: 'dot_validation_decisions_recorded',
    sql: 'CREATE INDEX dot_validation_decisions_recorded ON dot_validation_decisions (recorded_at)'
  }
] as const

const SCHEMA_TABLE = 'dot_validation_ledger_schema'
const FAMILY_NAMES: readonly string[] = DOT_VALIDATION_LEDGER_SCHEMA_DEFINITIONS.map(
  (definition) => definition.name
)

function signature(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

// Why the definitions before the version: a drifted version table is never read.
function verifyFamily(db: Database.Database, present: number): void {
  const drifted = DOT_VALIDATION_LEDGER_SCHEMA_DEFINITIONS.some((definition) => {
    const stored = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(definition.name)
    return typeof stored?.sql !== 'string' || signature(stored.sql) !== signature(definition.sql)
  })
  if (present !== FAMILY_NAMES.length || drifted) {
    throw dotIngressError('dot_recovery_required')
  }
  const version = db.prepare(`SELECT version FROM ${SCHEMA_TABLE} WHERE id = 1`).get()
  if (version?.version !== DOT_VALIDATION_LEDGER_SCHEMA_VERSION) {
    throw dotIngressError('dot_recovery_required')
  }
}

/** Creates the family, or verifies an existing one and fails closed without changing it. */
export function ensureDotValidationLedgerSchema(db: Database.Database): void {
  runDotWrite(db, 'dot_validation_ledger_schema', () => {
    const placeholders = FAMILY_NAMES.map(() => '?').join(', ')
    const present = db
      .prepare(`SELECT name FROM sqlite_master WHERE name IN (${placeholders})`)
      .all(...FAMILY_NAMES).length
    if (present > 0) {
      verifyFamily(db, present)
      return
    }
    for (const definition of DOT_VALIDATION_LEDGER_SCHEMA_DEFINITIONS) {
      db.exec(definition.sql)
    }
    db.prepare(`INSERT INTO ${SCHEMA_TABLE} VALUES (1, ?)`).run(
      DOT_VALIDATION_LEDGER_SCHEMA_VERSION
    )
  })
}

export type DotValidationLedgerEntry = {
  readonly decisionId: string
  readonly validationId: string
  readonly dotRequestId: string
  readonly decision: DotValidationDecision
  readonly outcome: DotValidationDecideOutcome
  readonly decidedAt: string | null
  readonly recordedAt: string
}

const RowSchema = z.object({
  decision_id: z.uuid(),
  validation_id: DotValidationIdSchema,
  dot_request_id: DotRequestIdSchema,
  decision: z.enum(DOT_VALIDATION_DECISIONS),
  outcome: z.enum(DOT_VALIDATION_DECIDE_OUTCOMES),
  decided_at: z.string().nullable(),
  recorded_at: z.string()
})

const COLUMNS =
  'decision_id, validation_id, dot_request_id, decision, outcome, decided_at, recorded_at'

const ledgers = new WeakMap<OrchestrationDb, DotValidationLedger>()

export function getDotValidationLedger(owner: OrchestrationDb): DotValidationLedger {
  let ledger = ledgers.get(owner)
  if (!ledger) {
    ledger = new DotValidationLedger(owner.db)
    ledgers.set(owner, ledger)
  }
  return ledger
}

export class DotValidationLedger {
  constructor(private readonly db: Database.Database) {
    ensureDotValidationLedgerSchema(db)
  }

  get(decisionId: string): DotValidationLedgerEntry | null {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM dot_validation_decisions WHERE decision_id = ?`)
      .get(decisionId)
    if (!row) {
      return null
    }
    const stored = parseDotRow(RowSchema, row)
    return {
      decisionId: stored.decision_id,
      validationId: stored.validation_id,
      dotRequestId: stored.dot_request_id,
      decision: stored.decision,
      outcome: stored.outcome,
      decidedAt: stored.decided_at,
      recordedAt: stored.recorded_at
    }
  }

  /** Records the first outcome of a decision id; a second record of the same id is refused. */
  record(entry: DotValidationLedgerEntry): void {
    if (this.recordFirst(entry) !== entry) {
      throw dotIngressError('dot_idempotency_conflict')
    }
  }

  /** Records the outcome unless the id already has one; returns `entry` when it was recorded, else the first. */
  recordFirst(entry: DotValidationLedgerEntry): DotValidationLedgerEntry {
    const inserted = runDotWrite(this.db, 'dot_validation_ledger', () => {
      const result = this.db
        .prepare(
          `INSERT INTO dot_validation_decisions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (decision_id) DO NOTHING`
        )
        .run(
          entry.decisionId,
          entry.validationId,
          entry.dotRequestId,
          entry.decision,
          entry.outcome,
          entry.decidedAt,
          entry.recordedAt
        )
      this.db
        .prepare(
          `DELETE FROM dot_validation_decisions WHERE sequence <= (SELECT sequence FROM dot_validation_decisions
            ORDER BY sequence DESC LIMIT 1 OFFSET ?)`
        )
        .run(DOT_VALIDATION_LEDGER_MAX_ROWS)
      return Number(result.changes) === 1
    })
    const first = inserted ? entry : this.get(entry.decisionId)
    if (!first) {
      throw dotIngressError('dot_recovery_required')
    }
    return first
  }

  /** Decisions recorded after `since` (or at it, when `inclusive`), for the user's rate caps. */
  countRecordedSince(since: string, inclusive: boolean): number {
    const comparison = inclusive ? '>=' : '>'
    const row = this.db
      .prepare(
        `SELECT count(*) AS n FROM dot_validation_decisions WHERE recorded_at ${comparison} ?`
      )
      .get(since)
    return Number(row?.n ?? 0)
  }
}
