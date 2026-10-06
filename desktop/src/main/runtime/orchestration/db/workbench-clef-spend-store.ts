import { z } from 'zod'
import type Database from '../../../sqlite/sync-database'
import { OrchestrationError } from '../orchestration-error'
import { runLifecycleWriteTransaction } from './lifecycle-write-transaction-runner'
import {
  requireIdleWorkbenchConnection,
  requireWorkbenchTransaction
} from './workbench-connection-guard'
import {
  CLEF_PRICE_BASIS,
  CLEF_SPEND_PURPOSES,
  clefUtcDayKey,
  type ClefSpendPurpose,
  type ClefSpendReservationRow,
  type ClefSpendSettlement,
  type ClefSpendStore
} from '../../../clef/clef-spend-ledger'
import type {
  ClassificationSpendLink,
  ClassificationSpendStore
} from '../../../clef/clef-classification-spend'
import { ClefRecordIdSchema } from '../../../../shared/clef/clef-route-contract'
import { WorkbenchRequestIdSchema } from '../../../../shared/workbench-request'
import { AutopilotIdSchema } from './autopilot-store-input'

const SpendIdSchema = ClefRecordIdSchema
/** Micro-dollars, neurons and token counts are exact non-negative integers. */
const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const TimestampSchema = z.iso.datetime({ offset: true })
const UtcDayKeySchema = z.iso.date()
const PurposesSchema = z.array(z.enum(CLEF_SPEND_PURPOSES))
const OutputCostSchema = z.literal(CLEF_PRICE_BASIS.outputCost)

const ReservationRowSchema = z
  .object({
    reservationId: SpendIdSchema,
    requestId: WorkbenchRequestIdSchema.nullable(),
    purpose: z.enum(CLEF_SPEND_PURPOSES),
    attempt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
    utcDayKey: UtcDayKeySchema,
    priceBasisVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    estimatedInputTokens: CountSchema,
    reservedMicroUsd: CountSchema,
    reservedNeurons: CountSchema,
    reservedAt: TimestampSchema
  })
  .strict()
  .refine((row) => row.purpose !== 'production' || row.requestId !== null, {
    message: 'Production spend must belong to a request'
  })
  .refine((row) => (row.requestId === null) === (row.attempt === null), {
    message: 'Only request spend carries an attempt number'
  })
  .refine((row) => clefUtcDayKey(Date.parse(row.reservedAt)) === row.utcDayKey, {
    message: 'The UTC day key must match the reservation time'
  }) satisfies z.ZodType<ClefSpendReservationRow>

const SettledAmountsSchema = z.object({
  spentMicroUsd: CountSchema,
  spentNeurons: CountSchema,
  outputCost: OutputCostSchema,
  settledAt: TimestampSchema
})

const SettlementSchema = z.discriminatedUnion('basis', [
  SettledAmountsSchema.extend({
    basis: z.literal('usage'),
    inputTokens: CountSchema,
    outputTokens: CountSchema.nullable()
  }).strict(),
  SettledAmountsSchema.extend({
    basis: z.literal('reservation_kept'),
    inputTokens: z.null(),
    outputTokens: z.null()
  }).strict()
]) satisfies z.ZodType<ClefSpendSettlement>

const ClassificationLinkSchema = z
  .object({
    reservationId: SpendIdSchema,
    runId: AutopilotIdSchema,
    taskId: AutopilotIdSchema,
    attempt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
  })
  .strict() satisfies z.ZodType<ClassificationSpendLink>

const SETTLED_STATE = { usage: 'settled', reservation_kept: 'kept' } as const

// Why: an open reservation counts at its reserved bound, so spend is never under-counted mid-call.
const SPENT_MICRO_USD =
  "coalesce(sum(CASE WHEN state = 'reserved' THEN reserved_micro_usd ELSE spent_micro_usd END), 0)"
const SPENT_NEURONS =
  "coalesce(sum(CASE WHEN state = 'reserved' THEN reserved_neurons ELSE spent_neurons END), 0)"

function readTotal(row: Record<string, unknown> | undefined): number {
  const total = CountSchema.safeParse(row?.total)
  if (!total.success) {
    throw new OrchestrationError(
      'workbench_recovery_required',
      'Stored Clef spend is not an exact amount.'
    )
  }
  return total.data
}

/**
 * `workbench_clef_spend` rows behind the ledger port; the ledger owns price math and the retry
 * bound. The classification methods read and write `clef_classification_spend`, which needs the
 * autopilot schema.
 */
export class WorkbenchClefSpendStore implements ClefSpendStore, ClassificationSpendStore {
  constructor(private readonly db: Database.Database) {}

  /** Runs a ledger reservation (attempt count plus insert) as one top-level transaction. */
  atomically<T>(operation: () => T): T {
    requireIdleWorkbenchConnection(this.db)
    return runLifecycleWriteTransaction(this.db, 'workbench_clef_spend', operation)
  }

  sumSpentMicroUsd(purposes: readonly ClefSpendPurpose[]): number {
    const valid = PurposesSchema.parse(purposes)
    if (valid.length === 0) {
      return 0
    }
    const placeholders = valid.map(() => '?').join(', ')
    return readTotal(
      this.db
        .prepare(
          `SELECT ${SPENT_MICRO_USD} AS total FROM workbench_clef_spend WHERE purpose IN (${placeholders})`
        )
        .get(...valid)
    )
  }

  /** Neurons on one UTC day for the given purposes; every purpose when none are named. */
  sumNeuronsForUtcDay(utcDayKey: string, purposes?: readonly ClefSpendPurpose[]): number {
    const day = UtcDayKeySchema.parse(utcDayKey)
    if (purposes === undefined) {
      return readTotal(
        this.db
          .prepare(`SELECT ${SPENT_NEURONS} AS total FROM workbench_clef_spend WHERE utc_day = ?`)
          .get(day)
      )
    }
    const valid = PurposesSchema.parse(purposes)
    if (valid.length === 0) {
      return 0
    }
    const placeholders = valid.map(() => '?').join(', ')
    return readTotal(
      this.db
        .prepare(
          `SELECT ${SPENT_NEURONS} AS total FROM workbench_clef_spend WHERE utc_day = ? AND purpose IN (${placeholders})`
        )
        .get(day, ...valid)
    )
  }

  countAttemptsForRequest(requestId: string): number {
    return readTotal(
      this.db
        .prepare('SELECT count(*) AS total FROM workbench_clef_spend WHERE request_id = ?')
        .get(WorkbenchRequestIdSchema.parse(requestId))
    )
  }

  countAttemptsForSubject(subjectId: string): number {
    return readTotal(
      this.db
        .prepare('SELECT count(*) AS total FROM clef_classification_spend WHERE task_id = ?')
        .get(AutopilotIdSchema.parse(subjectId))
    )
  }

  /** Max plus one, so `UNIQUE (request_id, attempt)` holds while several TaskSpecs share the request. */
  nextAttemptForRequest(requestId: string): number {
    return readTotal(
      this.db
        .prepare(
          'SELECT coalesce(max(attempt), 0) + 1 AS total FROM workbench_clef_spend WHERE request_id = ?'
        )
        .get(WorkbenchRequestIdSchema.parse(requestId))
    )
  }

  insertClassificationLink(input: ClassificationSpendLink): void {
    requireWorkbenchTransaction(this.db)
    const link = ClassificationLinkSchema.parse(input)
    this.db
      .prepare(
        'INSERT INTO clef_classification_spend (reservation_id, run_id, task_id, attempt) VALUES (?, ?, ?, ?)'
      )
      .run(link.reservationId, link.runId, link.taskId, link.attempt)
  }

  /** Startup recovery: each TaskSpec's latest billed attempt that no classification records. */
  listUnrecordedClassificationAttempts(limit: number): ClassificationSpendLink[] {
    return this.db
      .prepare(
        `SELECT link.reservation_id, link.run_id, link.task_id, link.attempt
          FROM clef_classification_spend link
          WHERE link.attempt = (SELECT max(attempt) FROM clef_classification_spend
            WHERE task_id = link.task_id)
          AND NOT EXISTS (SELECT 1 FROM task_classifications classification
            WHERE classification.spend_reservation_id = link.reservation_id)
          ORDER BY link.rowid LIMIT ?`
      )
      .all(z.number().int().min(1).max(1000).parse(limit))
      .map((row) =>
        ClassificationLinkSchema.parse({
          reservationId: row.reservation_id,
          runId: row.run_id,
          taskId: row.task_id,
          attempt: row.attempt
        })
      )
  }

  insertReservation(input: ClefSpendReservationRow): void {
    requireWorkbenchTransaction(this.db)
    const row = ReservationRowSchema.parse(input)
    this.db
      .prepare(`INSERT INTO workbench_clef_spend (reservation_id, request_id, purpose, attempt,
        price_basis_version, estimated_input_tokens, reserved_micro_usd, reserved_neurons, state,
        utc_day, reserved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`)
      .run(
        row.reservationId,
        row.requestId,
        row.purpose,
        row.attempt,
        row.priceBasisVersion,
        row.estimatedInputTokens,
        row.reservedMicroUsd,
        row.reservedNeurons,
        row.utcDayKey,
        row.reservedAt
      )
  }

  settle(reservationId: string, input: ClefSpendSettlement): void {
    const id = SpendIdSchema.parse(reservationId)
    const settlement = SettlementSchema.parse(input)
    const result = this.db
      .prepare(`UPDATE workbench_clef_spend SET state = ?, input_tokens = ?, output_tokens = ?,
        output_cost = ?, spent_micro_usd = ?, spent_neurons = ?, closed_at = ?
        WHERE reservation_id = ? AND state = 'reserved'`)
      .run(
        SETTLED_STATE[settlement.basis],
        settlement.inputTokens,
        settlement.outputTokens,
        settlement.outputCost,
        settlement.spentMicroUsd,
        settlement.spentNeurons,
        settlement.settledAt,
        id
      )
    if (Number(result.changes) !== 1) {
      throw new OrchestrationError(
        'workbench_spend_conflict',
        'The spend reservation is unknown or already closed.'
      )
    }
  }

  /**
   * Startup recovery: closes every open reservation. The amount stays counted as spent because
   * an interrupted call may have been billed.
   */
  releaseUnsettled(timestamp: string): number {
    const result = this.db
      .prepare(`UPDATE workbench_clef_spend SET state = 'released', output_cost = ?,
        spent_micro_usd = reserved_micro_usd, spent_neurons = reserved_neurons, closed_at = ?
        WHERE state = 'reserved'`)
      .run(CLEF_PRICE_BASIS.outputCost, TimestampSchema.parse(timestamp))
    return Number(result.changes)
  }
}
