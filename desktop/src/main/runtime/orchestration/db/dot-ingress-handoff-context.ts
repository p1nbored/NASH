import { z } from 'zod'
import {
  DOT_INGRESS_SENDER_AUTH,
  DOT_INGRESS_SOURCE,
  DOT_REQUEST_ACCESS_LEVELS,
  type DotRequestAccess
} from '../../../../shared/dot-ingress/dot-ingress-limits'
import {
  DotClientDescriptorSchema,
  DotRequestIdSchema,
  type DotClientDescriptor
} from '../../../../shared/dot-ingress/dot-ingress-params'
import { WorkbenchRequestIdSchema } from '../../../../shared/workbench-request'
import type { OrchestrationDb } from './orchestration-db'
import { getDotIngressStore } from './dot-ingress-store'
import { parseDotInput, parseDotRow } from './dot-ingress-store-input'

/**
 * Facts about a Workbench request that came from dot; task messages remain English.
 */
export type DotIngressHandoffContext = {
  dotRequestId: string
  source: typeof DOT_INGRESS_SOURCE
  senderAuth: typeof DOT_INGRESS_SENDER_AUTH
  /** Claimed by the sender and untrusted. */
  client: DotClientDescriptor | null
  /** The stored bytes, quoted spans included, unchanged. */
  objective: string
  spanCount: number
  scanRules: string[]
  requestedAccess: DotRequestAccess
  receivedAt: string
}

const RowSchema = z.object({
  dot_request_id: DotRequestIdSchema,
  objective: z.string().min(1),
  span_count: z.number().int().min(0).max(32),
  scan_rules: z.string(),
  requested_access: z.enum(DOT_REQUEST_ACCESS_LEVELS),
  client_name: z.string().nullable(),
  client_version: z.string().nullable(),
  created_at: z.string()
})
const ScanRulesSchema = z.array(z.string().regex(/^[a-z0-9_:.-]{1,64}$/))

/** Null for a Workbench request of any other origin, such as one the user typed in the app. */
export function getDotIngressHandoffContext(
  owner: OrchestrationDb,
  workbenchRequestId: string
): DotIngressHandoffContext | null {
  const id = parseDotInput(WorkbenchRequestIdSchema, workbenchRequestId, 'Workbench request id')
  // Why: opening the store verifies the dot schema, so a drifted layout fails closed here too.
  getDotIngressStore(owner)
  const row = owner.db
    .prepare(
      `SELECT dot_request_id, objective, span_count, scan_rules, requested_access,
        client_name, client_version, created_at FROM dot_ingress_requests WHERE workbench_request_id = ?`
    )
    .get(id)
  if (!row) {
    return null
  }
  const stored = parseDotRow(RowSchema, row)
  const client =
    stored.client_name === null
      ? null
      : parseDotRow(DotClientDescriptorSchema, {
          name: stored.client_name,
          version: stored.client_version
        })
  return {
    dotRequestId: stored.dot_request_id,
    source: DOT_INGRESS_SOURCE,
    senderAuth: DOT_INGRESS_SENDER_AUTH,
    client,
    objective: stored.objective,
    spanCount: stored.span_count,
    scanRules: parseDotRow(ScanRulesSchema, JSON.parse(stored.scan_rules)),
    requestedAccess: stored.requested_access,
    receivedAt: stored.created_at
  }
}
