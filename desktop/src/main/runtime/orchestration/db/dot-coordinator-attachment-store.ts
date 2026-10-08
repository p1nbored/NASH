import { createHash, randomUUID } from 'node:crypto'
import type Database from '../../../sqlite/sync-database'
import {
  prepareRunMessageText,
  runMessageTextSha256
} from '../../workflow-run/run-message-text-checks'
import { requireOpenWorkspace, requireWithinLimits } from './dot-ingress-admission'
import { insertDotIngressEvent } from './dot-ingress-event-log'
import { ensureDotCoordinatorAttachments } from './dot-coordinator-attachment'
import { insertHeldRunMessageInTransaction } from './run-message-insert'
import { dotIngressError, parseDotInput, runDotWrite } from './dot-ingress-store-input'
import {
  DotIngressSubmitInputSchema,
  dotIngressRequestHash,
  requireStorableObjective,
  type DotIngressSubmitInput
} from './dot-ingress-request-inputs'
import type { DotRequestRecord } from './dot-ingress-request-row'

type ReadRequest = (id: string) => DotRequestRecord
type AttachmentPorts = {
  read: ReadRequest
  insert(input: DotIngressSubmitInput, id: string, hash: string): void
  assertObjective(id: string, text: string): void
}

function attachmentHash(input: DotIngressSubmitInput, runId: string, requestId: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([runId, requestId, dotIngressRequestHash(input)]))
    .digest('hex')
}

export function findDotAttachmentReplay(
  db: Database.Database,
  input: DotIngressSubmitInput,
  runId: string,
  read: ReadRequest
): { record: DotRequestRecord; duplicate: true } | null {
  const params = parseDotInput(DotIngressSubmitInputSchema, input, 'coordinator attachment')
  const prior = db
    .prepare(
      'SELECT dot_request_id, input_hash, workbench_request_id FROM dot_ingress_requests WHERE idempotency_key = ?'
    )
    .get(params.idempotencyKey)
  if (!prior) {
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'dot_coordinator_attachments'").get() &&
      db.prepare('SELECT 1 FROM dot_coordinator_attachments WHERE run_id = ?').get(runId)
    ) {
      throw dotIngressError('dot_request_busy', { reason: 'coordinator_already_attached' })
    }
    return null
  }
  if (prior.input_hash !== attachmentHash(params, runId, prior.workbench_request_id)) {
    throw dotIngressError('dot_idempotency_conflict')
  }
  return { record: read(String(prior.dot_request_id)), duplicate: true }
}

/** Receipt, controller link and queued objective are one atomic write; recovery never launches a CLI. */
export function attachDotCoordinatorRequest(
  db: Database.Database,
  input: DotIngressSubmitInput,
  runId: string,
  requestId: string,
  ports: AttachmentPorts
): { record: DotRequestRecord; duplicate: boolean } {
  const params = parseDotInput(DotIngressSubmitInputSchema, input, 'coordinator attachment')
  requireStorableObjective(params.objective)
  const prepared = prepareRunMessageText(params.objective)
  if (!prepared.ok) {
    throw dotIngressError('dot_requirement_rejected_content')
  }
  ensureDotCoordinatorAttachments(db)
  return runDotWrite(db, 'dot_coordinator_attach', () => {
    requireOpenWorkspace(db, params)
    const replay = findDotAttachmentReplay(db, params, runId, ports.read)
    if (replay) {
      return replay
    }
    if (
      db.prepare('SELECT 1 FROM dot_ingress_requests WHERE workbench_request_id = ?').get(requestId)
    ) {
      throw dotIngressError('dot_request_busy', { reason: 'coordinator_already_attached' })
    }
    requireWithinLimits(db, params.timestamp)
    const id = randomUUID()
    ports.insert(params, id, attachmentHash(params, runId, requestId))
    ports.assertObjective(id, params.objective)
    db.prepare(
      "UPDATE dot_ingress_requests SET state = 'submitted', workbench_request_id = ?, revision = 2 WHERE dot_request_id = ?"
    ).run(requestId, id)
    db.prepare('INSERT INTO dot_coordinator_attachments VALUES (?, ?, ?)').run(
      runId,
      id,
      params.timestamp
    )
    if (
      db
        .prepare("SELECT 1 FROM run_messages WHERE source = 'dot' AND source_request_id = ?")
        .get(params.idempotencyKey)
    ) {
      throw dotIngressError('dot_idempotency_conflict')
    }
    insertHeldRunMessageInTransaction(db, {
      runId,
      source: 'dot',
      sourceRequestId: params.idempotencyKey,
      text: prepared.text,
      textSha256: runMessageTextSha256(params.objective),
      reason: 'coordinator_attached',
      timestamp: params.timestamp
    })
    insertDotIngressEvent(db, {
      kind: 'request_submitted',
      dotRequestId: id,
      workspaceRef: params.workspaceRef,
      revision: 2,
      timestamp: params.timestamp
    })
    return { record: ports.read(id), duplicate: false }
  })
}
