import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema
} from '../../../shared/dot-ingress/dot-ingress-decision'
import { DOT_INGRESS_CONTRACT_VERSION } from '../../../shared/dot-ingress/dot-ingress-limits'
import { DotMessageResultSchema } from '../../../shared/dot-ingress/dot-ingress-message'
import {
  DotCancelResultSchema,
  DotListResultSchema,
  DotStatusResultSchema,
  DotSubmitResultSchema,
  DotWorkspacesResultSchema
} from '../../../shared/dot-ingress/dot-ingress-request'
import {
  toDotDecisionView,
  toDotRequestView,
  toDotWorkspaceViews
} from '../orchestration/db/dot-ingress-projection'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import type { DotRequestRecord } from '../orchestration/db/dot-ingress-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { dotMayAllow } from '../permission-relay/permission-dot-allow'
import type { DotDecisionAnswer, DotDecisionEntry } from './dot-ingress-decisions-service'
import type { DotMessageDelivery } from './dot-ingress-message-service'
import { projectDotRun } from './dot-ingress-run-projection'
import {
  DotValidationDecideResultV3Schema,
  DotValidationsListResultV3Schema
} from '../../../shared/dot-ingress/dot-ingress-validation'
import type { DotValidationPage } from './dot-ingress-validation-reads'
import type { DotValidationDecided } from './dot-ingress-validations-service'

const Version = { contractVersion: DOT_INGRESS_CONTRACT_VERSION }

function requestView(db: OrchestrationDb, record: DotRequestRecord) {
  return toDotRequestView(record, projectDotRun(db, record))
}

export function workspacesResult(db: OrchestrationDb) {
  const settings = getDotIngressSettingsStore(db)
  return DotWorkspacesResultSchema.parse({
    ...Version,
    workspaces: toDotWorkspaceViews(
      settings.listWorkspaces({ enabledOnly: true }).map((entry) => ({
        ...entry,
        maxAccess: settings.getWorkspaceMaxAccess(entry.workspaceRef)
      }))
    )
  })
}

export function submitResult(
  db: OrchestrationDb,
  outcome: { record: DotRequestRecord; duplicate: boolean }
) {
  return DotSubmitResultSchema.parse({
    ...Version,
    request: requestView(db, outcome.record),
    duplicate: outcome.duplicate
  })
}

export function statusResult(db: OrchestrationDb, record: DotRequestRecord) {
  return DotStatusResultSchema.parse({ ...Version, request: requestView(db, record) })
}

export function listResult(
  db: OrchestrationDb,
  page: { records: readonly DotRequestRecord[]; nextBeforeSequence: number | null }
) {
  return DotListResultSchema.parse({
    ...Version,
    requests: page.records.map((record) => requestView(db, record)),
    nextBeforeSequence: page.nextBeforeSequence
  })
}

export function cancelResult(
  db: OrchestrationDb,
  outcome: { record: DotRequestRecord; changed: boolean }
) {
  return DotCancelResultSchema.parse({
    ...Version,
    request: requestView(db, outcome.record),
    changed: outcome.changed
  })
}

function decisionView(db: OrchestrationDb, entry: DotDecisionEntry) {
  return toDotDecisionView(entry.record, entry.dotRequestId, dotMayAllow(db, entry.record))
}

export function decisionsListResult(db: OrchestrationDb, entries: readonly DotDecisionEntry[]) {
  return DotDecisionsListResultSchema.parse({
    ...Version,
    decisions: entries.map((entry) => decisionView(db, entry))
  })
}

export function decisionAnswerResult(db: OrchestrationDb, answer: DotDecisionAnswer) {
  return DotDecisionAnswerResultSchema.parse({
    ...Version,
    outcome: answer.outcome,
    decision: decisionView(db, answer)
  })
}

export function messageResult(
  input: { dotRequestId: string; messageId: string },
  delivery: DotMessageDelivery
) {
  return DotMessageResultSchema.parse({ ...Version, ...input, ...delivery })
}

export function validationsListResult(page: DotValidationPage) {
  return DotValidationsListResultV3Schema.parse({
    ...Version,
    validations: page.views,
    hasMore: page.hasMore
  })
}

export function validationDecideResult(decided: DotValidationDecided) {
  return DotValidationDecideResultV3Schema.parse({ ...Version, ...decided })
}
