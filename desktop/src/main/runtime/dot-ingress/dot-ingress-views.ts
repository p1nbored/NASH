import {
  DotDecisionAnswerResultSchema,
  DotDecisionsListResultSchema,
  type DotDecisionView
} from '../../../shared/dot-ingress/dot-ingress-decision'
import {
  DotMessageResultSchema,
  type DotMessageResult
} from '../../../shared/dot-ingress/dot-ingress-message'
import {
  DotCancelResultSchema,
  DotListResultSchema,
  DotStatusResultSchema,
  DotSubmitResultSchema,
  DotWorkspacesResultSchema,
  type DotRequestView
} from '../../../shared/dot-ingress/dot-ingress-request'
import {
  DotCancelResultV2Schema,
  DotDecisionAnswerResultV2Schema,
  DotDecisionsListResultV2Schema,
  DotDecisionViewV2Schema,
  DotListResultV2Schema,
  DotRequestViewV2Schema,
  DotStatusResultV2Schema,
  DotSubmitResultV2Schema,
  DotWorkspacesResultV2Schema,
  type DotDecisionViewV2,
  type DotRequestViewV2
} from '../../../shared/dot-ingress/dot-ingress-v2'
import {
  DotMessageResultV3Schema,
  type DotMessageResultV3
} from '../../../shared/dot-ingress/dot-ingress-v3'
import type { DotContractVersion } from '../../../shared/dot-ingress/dot-ingress-versions'
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
import { dotRefusal } from './dot-ingress-refusals'
import { projectDotRun } from './dot-ingress-run-projection'
import { toV3 } from './dot-ingress-views-v3'

// Versioned results: version 1 is the frozen projection; version 2 adds the access fields; version 3
// is version 2 pinned to 3. Every result is parsed against its schema before it leaves, so a view
// cannot drift from the contract.

function requestViewV1(db: OrchestrationDb, record: DotRequestRecord): DotRequestView {
  return toDotRequestView(record, projectDotRun(db, record))
}

function requestViewV2(db: OrchestrationDb, record: DotRequestRecord): DotRequestViewV2 {
  return DotRequestViewV2Schema.parse({
    ...requestViewV1(db, record),
    contractVersion: 2,
    requestedAccess: record.requestedAccess
  })
}

export function workspacesResult(db: OrchestrationDb, version: DotContractVersion) {
  const settings = getDotIngressSettingsStore(db)
  const entries = settings.listWorkspaces({ enabledOnly: true })
  if (version === 1) {
    return DotWorkspacesResultSchema.parse({
      contractVersion: 1,
      workspaces: toDotWorkspaceViews(entries)
    })
  }
  const v2 = DotWorkspacesResultV2Schema.parse({
    contractVersion: 2,
    workspaces: toDotWorkspaceViews(entries).map((view) => ({
      ...view,
      maxAccess: settings.getWorkspaceMaxAccess(view.workspaceRef)
    }))
  })
  return version === 3 ? toV3.workspaces(v2) : v2
}

export function submitResult(
  db: OrchestrationDb,
  version: DotContractVersion,
  outcome: { record: DotRequestRecord; duplicate: boolean }
) {
  if (version === 1) {
    return DotSubmitResultSchema.parse({
      contractVersion: 1,
      request: requestViewV1(db, outcome.record),
      duplicate: outcome.duplicate
    })
  }
  const v2 = DotSubmitResultV2Schema.parse({
    contractVersion: 2,
    request: requestViewV2(db, outcome.record),
    duplicate: outcome.duplicate
  })
  return version === 3 ? toV3.submit(v2) : v2
}

export function statusResult(
  db: OrchestrationDb,
  version: DotContractVersion,
  record: DotRequestRecord
) {
  if (version === 1) {
    return DotStatusResultSchema.parse({ contractVersion: 1, request: requestViewV1(db, record) })
  }
  const v2 = DotStatusResultV2Schema.parse({
    contractVersion: 2,
    request: requestViewV2(db, record)
  })
  return version === 3 ? toV3.status(v2) : v2
}

export function listResult(
  db: OrchestrationDb,
  version: DotContractVersion,
  page: { records: readonly DotRequestRecord[]; nextBeforeSequence: number | null }
) {
  if (version === 1) {
    return DotListResultSchema.parse({
      contractVersion: 1,
      requests: page.records.map((record) => requestViewV1(db, record)),
      nextBeforeSequence: page.nextBeforeSequence
    })
  }
  const v2 = DotListResultV2Schema.parse({
    contractVersion: 2,
    requests: page.records.map((record) => requestViewV2(db, record)),
    nextBeforeSequence: page.nextBeforeSequence
  })
  return version === 3 ? toV3.list(v2) : v2
}

export function cancelResult(
  db: OrchestrationDb,
  version: DotContractVersion,
  outcome: { record: DotRequestRecord; changed: boolean }
) {
  if (version === 1) {
    return DotCancelResultSchema.parse({
      contractVersion: 1,
      request: requestViewV1(db, outcome.record),
      changed: outcome.changed
    })
  }
  const v2 = DotCancelResultV2Schema.parse({
    contractVersion: 2,
    request: requestViewV2(db, outcome.record),
    changed: outcome.changed
  })
  return version === 3 ? toV3.cancel(v2) : v2
}

function decisionViewV1(entry: DotDecisionEntry): DotDecisionView {
  return toDotDecisionView(entry.record, entry.dotRequestId)
}

function decisionViewV2(db: OrchestrationDb, entry: DotDecisionEntry): DotDecisionViewV2 {
  return DotDecisionViewV2Schema.parse({
    ...decisionViewV1(entry),
    dotMayAllow: dotMayAllow(db, entry.record)
  })
}

export function decisionsListResult(
  db: OrchestrationDb,
  version: DotContractVersion,
  entries: readonly DotDecisionEntry[]
) {
  if (version === 1) {
    return DotDecisionsListResultSchema.parse({
      contractVersion: 1,
      decisions: entries.map(decisionViewV1)
    })
  }
  const v2 = DotDecisionsListResultV2Schema.parse({
    contractVersion: 2,
    decisions: entries.map((entry) => decisionViewV2(db, entry))
  })
  return version === 3 ? toV3.decisionsList(v2) : v2
}

/** Version 1 has no `closed` outcome: the prompt then waits in the app, which is what desktop-only says. */
export function decisionAnswerResult(
  db: OrchestrationDb,
  version: DotContractVersion,
  answer: DotDecisionAnswer
) {
  if (version !== 1) {
    const v2 = DotDecisionAnswerResultV2Schema.parse({
      contractVersion: 2,
      outcome: answer.outcome,
      decision: decisionViewV2(db, answer)
    })
    return version === 3 ? toV3.decisionAnswer(v2) : v2
  }
  if (answer.outcome === 'closed') {
    throw dotRefusal('dot_decision_desktop_only', { reason: 'closed' })
  }
  return DotDecisionAnswerResultSchema.parse({
    contractVersion: 1,
    outcome: answer.outcome,
    decision: decisionViewV1(answer)
  })
}

export function messageResult(
  version: 2 | 3,
  input: { dotRequestId: string; messageId: string },
  delivery: DotMessageDelivery
): DotMessageResult | DotMessageResultV3 {
  const result = { dotRequestId: input.dotRequestId, messageId: input.messageId, ...delivery }
  return version === 3
    ? DotMessageResultV3Schema.parse({ contractVersion: 3, ...result })
    : DotMessageResultSchema.parse({ contractVersion: 2, ...result })
}
