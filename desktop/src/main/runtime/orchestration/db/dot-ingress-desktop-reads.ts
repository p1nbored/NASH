import { z } from 'zod'
import {
  DotClientDescriptorSchema,
  type DotClientDescriptor
} from '../../../../shared/dot-ingress/dot-ingress-params'
import { WORKBENCH_LIST_MAX_LIMIT } from '../../../../shared/workbench-request'
import type { OrchestrationDb } from './orchestration-db'
import {
  DOT_RECORD_COLUMNS,
  toDotRequestRecord,
  type DotRequestRecord
} from './dot-ingress-request-row'
import { ensureDotIngressSchema } from './dot-ingress-schema'
import { parseDotInput, parseDotRow } from './dot-ingress-store-input'

// The desktop's read of what dot submitted (D-018 removed the confirmation step, so this is how the
// user sees it). It returns the objective and workspace id, so it must never back a dot-facing view.

export type DotDesktopRequest = {
  record: DotRequestRecord
  workspaceId: string
  objective: string
  /** The sender's claim about itself, never verified. */
  claimedClient: DotClientDescriptor | null
}

const PageSchema = z
  .object({
    limit: z.number().int().min(1).max(WORKBENCH_LIST_MAX_LIMIT),
    beforeSequence: z.number().int().positive().optional()
  })
  .strict()

const DesktopColumnsSchema = z.object({
  workspace_id: z.string().min(1),
  objective: z.string().min(1),
  client_name: z.string().nullable(),
  client_version: z.string().nullable()
})

function toDesktopRequest(row: unknown): DotDesktopRequest {
  const extra = parseDotRow(DesktopColumnsSchema, row)
  const claimed =
    extra.client_name === null || extra.client_version === null
      ? null
      : parseDotRow(DotClientDescriptorSchema, {
          name: extra.client_name,
          version: extra.client_version
        })
  return {
    record: toDotRequestRecord(row),
    workspaceId: extra.workspace_id,
    objective: extra.objective,
    claimedClient: claimed
  }
}

/** Newest first, one page at a time. */
export function listDotRequestsForDesktop(
  owner: OrchestrationDb,
  page: { limit: number; beforeSequence?: number }
): { requests: DotDesktopRequest[]; nextBeforeSequence: number | null } {
  const { limit, beforeSequence } = parseDotInput(PageSchema, page, 'request page')
  ensureDotIngressSchema(owner.db)
  const rows = owner.db
    .prepare(
      `SELECT ${DOT_RECORD_COLUMNS}, workspace_id, objective, client_name, client_version
        FROM dot_ingress_requests WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`
    )
    .all(beforeSequence ?? Number.MAX_SAFE_INTEGER, limit + 1)
  const requests = rows.slice(0, limit).map(toDesktopRequest)
  return {
    requests,
    nextBeforeSequence: rows.length > limit ? (requests.at(-1)?.record.sequence ?? null) : null
  }
}
