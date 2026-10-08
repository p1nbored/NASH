import {
  DOT_MESSAGE_REASONS,
  type DotMessageReason
} from '../../../shared/dot-ingress/dot-ingress-message'
import { DotDecisionsListResultSchema } from '../../../shared/dot-ingress/dot-ingress-decision'
import { DotRemoteRequestStatusDataSchema } from '../../../shared/dot-remote/dot-remote-events'
import { decisionsListResult, statusResult } from '../dot-ingress/dot-ingress-views'
import { findDotRequestRun, hasAppTable } from '../dot-ingress/dot-ingress-run-link'
import { PERMISSION_DECISION_STATUSES } from '../orchestration/db/autopilot-run-schema-definition'
import {
  type AttemptArtifactRecord,
  getAttemptArtifactStore
} from '../orchestration/db/attempt-artifact-store'

import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import type { OrchestrationDb } from '../orchestration/db/orchestration-db'
import type { PermissionDecisionRecord } from '../orchestration/db/permission-decision-store'
import { getRunMessageStore, type RunMessageRecord } from '../orchestration/db/run-message-store'
import {
  getTaskValidationStore,
  type TaskValidationRecord
} from '../orchestration/db/task-validation-store'
import type { WorkflowRunRecord } from '../orchestration/db/workflow-run-store'
import type {
  DotRemoteArtifactFact,
  DotRemoteEventSource,
  DotRemoteRequestSnapshot,
  DotRemoteValidationFact
} from './dot-remote-event-source'
import type { DotRemoteMessageOutcome } from './dot-remote-item-dispatch'
import { createDotRemoteValidationFacts } from './dot-remote-validation-facts'

// The production event source: the existing local readers only. Status from D4's projection,
// prompts from D2's listForDot (desktop-only prompts are already left out), message outcomes from
// C3's run messages, record lines from C5's validations, the summary from D1's run mailbox message,
// artifacts from C4's attempt records and waiting validation decisions through G6. Nothing writes.

const PROMPTS_PER_REQUEST = 50
const SUMMARY_SCAN = 100

export type DotRemoteLocalReaderPorts = {
  readonly db: () => OrchestrationDb
  /** D2's listForDot through the relay port; an empty list while no relay runs. */
  readonly listForDot: (
    runId: string,
    options: { statuses: readonly PermissionDecisionRecord['status'][]; limit: number }
  ) => PermissionDecisionRecord[]
}

function coarseReason(reason: string | null): DotMessageReason | null {
  if (reason === null) {
    return null
  }
  return DOT_MESSAGE_REASONS.find((known) => known === reason) ?? 'other'
}

/** C3's state as dot's message outcome; null while the first delivery attempt is in flight. */
export function messageOutcomeOf(record: RunMessageRecord): DotRemoteMessageOutcome | null {
  const messageId = record.sourceRequestId
  switch (record.state) {
    case 'refused':
      return { messageId, outcome: 'refused', reason: coarseReason(record.reason) ?? 'other' }
    case 'held':
      return { messageId, outcome: 'queued', reason: coarseReason(record.reason) }
    case 'delivered':
      // Why: typed into a busy agent, the message waits for its next turn, as dot was first told.
      return record.reason === 'agent_busy'
        ? { messageId, outcome: 'queued', reason: 'agent_busy' }
        : { messageId, outcome: 'delivered', reason: null }
    case 'received':
      return record.outcome === null
        ? null
        : { messageId, outcome: record.outcome, reason: coarseReason(record.reason) }
  }
}

/** Decided validations with the C5 record line of the check that decided them. */
export function validationFactsOf(
  records: readonly TaskValidationRecord[]
): DotRemoteValidationFact[] {
  return records.flatMap((record) =>
    record.orphaned || record.verdict === 'pending'
      ? []
      : [
          {
            validationId: record.validationId,
            verdict: record.verdict,
            line: record.checks.find((check) => check.status === record.verdict)?.note ?? null
          }
        ]
  )
}

/** A latest validation that still waits for a waive or reject decision. */
function awaitsDecision(record: TaskValidationRecord): boolean {
  return record.verdict === 'inconclusive' && !record.waiver && !record.orphaned
}

/** Size and hash only; the path stays in the record on the PC. */
export function artifactFactsOf(
  records: readonly AttemptArtifactRecord[]
): DotRemoteArtifactFact[] {
  return records
    .filter((record) => !record.orphaned)
    .map((record) => ({
      artifactId: record.artifactId,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256
    }))
}

function latestValidations(db: OrchestrationDb, runId: string): TaskValidationRecord[] {
  if (!hasAppTable(db, 'task_validations')) {
    return []
  }
  const store = getTaskValidationStore(db)
  return db.listTasks({ runId }).flatMap((task) => store.latestForTask(task.id) ?? [])
}

/** D1: the English summary run-complete kept in the run mailbox. */
export function runSummaryOf(db: OrchestrationDb, runId: string): string | null {
  const message = db
    .getAllMessagesForHandle(`run:${runId}`, SUMMARY_SCAN, ['status'])
    .find((row) => {
      try {
        const payload: unknown = row.payload === null ? null : JSON.parse(row.payload)
        return (
          typeof payload === 'object' &&
          payload !== null &&
          Reflect.get(payload, 'kind') === 'run_completed'
        )
      } catch {
        return false
      }
    })
  return message?.body ?? null
}

function deliverableOf(
  db: OrchestrationDb,
  run: WorkflowRunRecord,
  validations: readonly TaskValidationRecord[]
) {
  if (run.status !== 'completed') {
    return null
  }
  const artifacts = getAttemptArtifactStore(db)
  const passed = validations.filter((record) => record.verdict === 'pass' && !record.orphaned)
  return {
    summary: runSummaryOf(db, run.runId),
    artifacts: passed.flatMap((record) =>
      artifactFactsOf(artifacts.listForDispatch(record.dispatchId))
    )
  }
}

function messagesOf(
  db: OrchestrationDb,
  runId: string,
  messageIds: readonly string[]
): DotRemoteMessageOutcome[] {
  const store = getRunMessageStore(db)
  return messageIds.flatMap((messageId) => {
    const message = store.findBySource('dot', messageId)
    const outcome = message && message.runId === runId ? messageOutcomeOf(message) : null
    return outcome ? [outcome] : []
  })
}

export function createDotRemoteLocalReaders(
  ports: DotRemoteLocalReaderPorts
): DotRemoteEventSource {
  const validationFacts = createDotRemoteValidationFacts()

  function snapshot(
    dotRequestId: string,
    known: { messageIds: readonly string[]; validationIds: readonly string[] }
  ): DotRemoteRequestSnapshot | null {
    const db = ports.db()
    if (!hasAppTable(db, 'dot_ingress_requests')) {
      return null
    }
    const record = getDotIngressStore(db).get(dotRequestId)
    const view = statusResult(db, record).request
    const status = DotRemoteRequestStatusDataSchema.parse({
      state: view.state,
      statusText: view.statusText,
      run: view.run
    })
    const run = findDotRequestRun(db, record)
    if (!run) {
      return {
        status,
        prompts: [],
        messages: [],
        validations: [],
        deliverable: null,
        validationDecisions: [],
        awaitsValidationDecision: false
      }
    }
    const records = ports.listForDot(run.runId, {
      statuses: PERMISSION_DECISION_STATUSES,
      limit: PROMPTS_PER_REQUEST
    })
    const entries = records.map((entry) => ({ record: entry, dotRequestId }))
    const validations = latestValidations(db, run.runId)
    return {
      status,
      prompts: DotDecisionsListResultSchema.parse(decisionsListResult(db, entries)).decisions,
      messages: messagesOf(db, run.runId, known.messageIds),
      validations: validationFactsOf(validations),
      deliverable: deliverableOf(db, run, validations),
      validationDecisions: validationFacts.factsOf(db, dotRequestId, known.validationIds),
      awaitsValidationDecision: validations.some(awaitsDecision)
    }
  }
  return { snapshot, beginSync: (followed) => validationFacts.begin(followed) }
}
