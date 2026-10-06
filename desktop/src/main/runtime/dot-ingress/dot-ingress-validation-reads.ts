import { WORKBENCH_LIST_MAX_LIMIT } from '../../../shared/workbench-request'
import type {
  DotValidationSettled,
  DotValidationView
} from '../../../shared/dot-ingress/dot-ingress-validation'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import {
  getTaskValidationStore,
  type TaskValidationRecord
} from '../orchestration/db/task-validation-store'
import type { ValidationDecisionService } from '../task-validation/validation-decision-service'
import { findDotRequestOfRun, hasAppTable } from './dot-ingress-run-link'
import { buildDotValidationView } from './dot-ingress-validation-view'

// Read-only: what dot may see of waiting decisions, through G6's decision service filtered to runs dot
// started, and how a decision ended. The local endpoint and the remote event sync both read here.

/** How many waiting dot decisions one read considers; the service scans further for its filter. */
export const DOT_VALIDATION_SCAN_LIMIT = WORKBENCH_LIST_MAX_LIMIT
/** The check the shared decision service appends to a rejected validation. */
const REJECTED_CHECK_KIND = 'user_decision'

export type DotValidationPage = { readonly views: DotValidationView[]; readonly hasMore: boolean }

/** Waiting decisions of runs dot started, oldest first; none on a database without validations. */
export function readDotValidationViews(
  owner: OrchestrationDb,
  decisions: Pick<ValidationDecisionService, 'listPending'>,
  filter: {
    readonly dotRequestId?: string
    /** Only these requests, as the remote sync follows them. */
    readonly within?: ReadonlySet<string>
    readonly limit: number
  }
): DotValidationPage {
  if (!hasAppTable(owner, 'task_validations')) {
    return { views: [], hasMore: false }
  }
  const scanned = decisions.listPending({ limit: DOT_VALIDATION_SCAN_LIMIT, origin: 'dot' })
  const linked = scanned.decisions.flatMap((entry) => {
    const request = findDotRequestOfRun(owner, entry.runId)
    const wanted =
      request !== null &&
      (filter.dotRequestId === undefined || request.dotRequestId === filter.dotRequestId) &&
      (filter.within === undefined || filter.within.has(request.dotRequestId))
    return wanted ? [{ entry, dotRequestId: request.dotRequestId }] : []
  })
  const views = linked
    .slice(0, filter.limit)
    .flatMap(({ entry, dotRequestId }) => buildDotValidationView(owner, entry, dotRequestId) ?? [])
  return { views, hasMore: linked.length > filter.limit || scanned.hasMore }
}

/** How a decision that no longer waits ended: waived or rejected (by anyone), or closed without one. */
export function dotValidationSettlement(
  owner: OrchestrationDb,
  validationId: string
): DotValidationSettled {
  return settlementOf(validationId, recordOf(owner, validationId))
}

/** How a decision ended, or null while it still waits: inconclusive, not waived and not orphaned. */
export function finishedDotValidation(
  owner: OrchestrationDb,
  validationId: string
): DotValidationSettled | null {
  const record = recordOf(owner, validationId)
  const waiting = record?.verdict === 'inconclusive' && !record.waiver && !record.orphaned
  return waiting ? null : settlementOf(validationId, record)
}

function recordOf(owner: OrchestrationDb, validationId: string): TaskValidationRecord | null {
  return hasAppTable(owner, 'task_validations')
    ? getTaskValidationStore(owner).get(validationId)
    : null
}

function settlementOf(
  validationId: string,
  record: TaskValidationRecord | null
): DotValidationSettled {
  if (record?.waiver) {
    return { validationId, outcome: 'waived', decidedAt: record.waivedAt ?? record.updatedAt }
  }
  if (record?.verdict === 'fail' && record.checks.at(-1)?.kind === REJECTED_CHECK_KIND) {
    return { validationId, outcome: 'rejected', decidedAt: record.updatedAt }
  }
  return { validationId, outcome: 'closed', decidedAt: null }
}
