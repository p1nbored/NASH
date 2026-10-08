import type {
  WorkbenchPermissionDecisionView,
  WorkbenchPermissionListInput,
  WorkbenchPermissionListResult
} from '../../../shared/rpc-contract/permission-relay-params'
import type { OrchestrationDb } from '../orchestration/db'
import {
  getPermissionDecisionStore,
  type PermissionDecisionRecord,
  type PermissionDecisionStatus
} from '../orchestration/db/permission-decision-store'
import { isDesktopOnlyRecord } from './permission-redaction'
import { appRunReadersIfPresent } from './permission-relay-caller'
import { permissionSource } from './permission-source'

const DEFAULT_LIST_LIMIT = 50
const ADOPT_LIMIT = 100

/** The desktop's view of a prompt: the stored names and state, never the owner or the request hash. */
export function toDesktopPermissionView(
  record: PermissionDecisionRecord,
  answerable: boolean
): WorkbenchPermissionDecisionView {
  return {
    decisionId: record.decisionId,
    runId: record.runId,
    agentId: record.agentId,
    toolName: record.toolName,
    summary: record.summary,
    status: record.status,
    decidedBy: record.decidedBy === 'primary' ? null : record.decidedBy,
    ...(record.decidedBy === 'primary' ? { reviewedBy: 'primary' as const } : {}),
    createdAt: record.createdAt,
    deadlineAt: record.deadlineAt,
    decidedAt: record.decidedAt,
    desktopOnly: isDesktopOnlyRecord(record),
    answerable
  }
}

/** Every prompt of the named run, or of all open app runs, oldest first. */
export function listDesktopPermissionViews(
  db: OrchestrationDb,
  input: WorkbenchPermissionListInput,
  isAnswerable: (record: PermissionDecisionRecord) => boolean
): WorkbenchPermissionListResult {
  const readers = appRunReadersIfPresent(db)
  if (!readers) {
    return { decisions: [] }
  }
  const runIds = input.runId
    ? [input.runId].filter((runId) => readers.findAppRun(runId) !== null)
    : readers.listOpenAppRuns().map((run) => run.runId)
  const limit = input.limit ?? DEFAULT_LIST_LIMIT
  const options = input.statuses ? { statuses: input.statuses, limit } : { limit }
  const store = getPermissionDecisionStore(db)
  const records = runIds
    .flatMap((runId) => store.listForRun(runId, options))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, limit)
  return {
    decisions: records.map((record) => toDesktopPermissionView(record, isAnswerable(record)))
  }
}

/** The prompts of one run that dot may see: desktop-only prompts are never offered to it. */
export function listDotPermissionRecords(
  db: OrchestrationDb,
  runId: string,
  options: { statuses?: readonly PermissionDecisionStatus[]; limit: number }
): PermissionDecisionRecord[] {
  if (!appRunReadersIfPresent(db)) {
    return []
  }
  return getPermissionDecisionStore(db)
    .listForRun(runId, options)
    .filter((record) => record.agentId === null || isDesktopOnlyRecord(record))
}

/** Prompts still pending in open app runs, with the pane their primary session ran in. */
export function listPendingPrompts(
  db: OrchestrationDb
): { decisionId: string; deadlineMs: number; terminalHandle: string | null }[] {
  const readers = appRunReadersIfPresent(db)
  if (!readers) {
    return []
  }
  const store = getPermissionDecisionStore(db)
  return readers.listOpenAppRuns().flatMap((run) =>
    store.listPending(run.runId, ADOPT_LIMIT).map((record) => ({
      decisionId: record.decisionId,
      deadlineMs: Date.parse(record.deadlineAt),
      terminalHandle: permissionSource(db, record)?.handle ?? null
    }))
  )
}
