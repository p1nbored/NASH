import { z } from 'zod'
import type { OrchestrationDb } from './orchestration-db'
import {
  DOT_INTAKE_COLUMNS,
  toDotIntakeHandle,
  type DotIntakeHandle
} from './dot-ingress-request-row'
import { ensureDotIngressSchema } from './dot-ingress-schema'

const IdempotencyKeySchema = z.uuid()

/**
 * The unfinished intake recorded under a dot idempotency key, or null when there is none. A replay
 * the admission policy refuses uses it to settle the recorded request instead of leaving it waiting.
 * A key that is not a uuid cannot name a recorded request.
 */
export function findReceivedDotIntake(
  owner: OrchestrationDb,
  idempotencyKey: string
): DotIntakeHandle | null {
  const key = IdempotencyKeySchema.safeParse(idempotencyKey)
  if (!key.success) {
    return null
  }
  ensureDotIngressSchema(owner.db)
  const row = owner.db
    .prepare(
      `SELECT ${DOT_INTAKE_COLUMNS} FROM dot_ingress_requests WHERE idempotency_key = ? AND state = 'received'`
    )
    .get(key.data)
  return row === undefined ? null : toDotIntakeHandle(row)
}
