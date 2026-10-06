import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DOT_REQUEST_STATUS_TEXT } from '../../../shared/dot-ingress/dot-ingress-status-text'
import { cancelDotRequest } from '../dot-ingress/dot-ingress-cancel'
import { submitDotRequest } from '../dot-ingress/dot-ingress-intake'
import { createDotHarness, type DotHarness } from '../dot-ingress/dot-ingress-service.test-fixture'
import type { AttemptArtifactRecord } from '../orchestration/db/attempt-artifact-store'
import type { PermissionDecisionRecord } from '../orchestration/db/permission-decision-store'
import { getRunMessageStore, type RunMessageRecord } from '../orchestration/db/run-message-store'
import type { TaskValidationRecord } from '../orchestration/db/task-validation-store'
import { getWorkflowRunStore } from '../orchestration/db/workflow-run-store'
import {
  artifactFactsOf,
  createDotRemoteLocalReaders,
  messageOutcomeOf,
  validationFactsOf
} from './dot-remote-local-readers'

// FIXTURE_ONLY: synthetic ids, text and hashes.
type ListForDot = Parameters<typeof createDotRemoteLocalReaders>[0]['listForDot']
const MESSAGE = '50000000-0000-4000-8000-000000000002'
const RUN = 'run-fixture-1'

function prompt(status: PermissionDecisionRecord['status']): PermissionDecisionRecord {
  return {
    decisionId: '40000000-0000-4000-8000-000000000001',
    runId: RUN,
    ownerId: 'owner_fixture',
    agentId: null,
    toolName: 'Bash',
    summary: 'Bash: git status',
    requestSha256: 'c'.repeat(64),
    status,
    decidedBy: status === 'pending' ? null : 'dot',
    createdAt: '2026-10-05T00:00:11.000Z',
    deadlineAt: '2026-10-05T00:04:11.000Z',
    decidedAt: status === 'pending' ? null : '2026-10-05T00:00:20.000Z'
  }
}

describe('dot remote local readers', () => {
  let harness: DotHarness
  let dotRequestId: string
  let listForDot: Mock<ListForDot>
  beforeEach(async () => {
    harness = createDotHarness()
    dotRequestId = (await submitDotRequest(harness.deps, harness.submitRequest())).record
      .dotRequestId
    listForDot = vi.fn(() => [prompt('pending')])
  })
  afterEach(() => harness.close())

  const readers = () => createDotRemoteLocalReaders({ db: () => harness.owner, listForDot })

  it('reads the coarse D4 status and the D2 prompts of the run the request started', () => {
    const snapshot = readers().snapshot(dotRequestId, { messageIds: [], validationIds: [] })
    expect(snapshot?.status).toEqual({
      state: 'submitted',
      statusText: DOT_REQUEST_STATUS_TEXT.submitted,
      run: { state: 'active', blocker: null }
    })
    expect(listForDot).toHaveBeenCalledWith(RUN, {
      statuses: ['pending', 'allowed', 'denied', 'expired', 'answered_in_terminal'],
      limit: 50
    })
    expect(snapshot?.prompts).toEqual([
      expect.objectContaining({
        decisionId: '40000000-0000-4000-8000-000000000001',
        dotRequestId,
        status: 'pending',
        dotMayAllow: false
      })
    ])
    expect(snapshot?.deliverable).toBeNull()
  })

  it('reads the outcome of each message dot sent from the run messages', () => {
    const text = 'Also list the owners.'
    getRunMessageStore(harness.owner).recordHeld({
      runId: RUN,
      source: 'dot',
      sourceRequestId: MESSAGE,
      text,
      textSha256: createHash('sha256').update(text).digest('hex'),
      reason: 'dialog_open',
      timestamp: '2026-10-05T00:00:12.000Z'
    })
    expect(
      readers().snapshot(dotRequestId, { messageIds: [MESSAGE], validationIds: [] })?.messages
    ).toEqual([{ messageId: MESSAGE, outcome: 'queued', reason: 'dialog_open' }])
  })

  it('reads the D1 run summary once the run completed', () => {
    const runs = getWorkflowRunStore(harness.owner)
    const active = runs.get(RUN)!
    const completing = runs.transition({
      runId: RUN,
      from: 'active',
      to: 'completing',
      expectedRevision: active.revision,
      reason: null,
      timestamp: '2026-10-05T00:01:00.000Z'
    })
    runs.transition({
      runId: RUN,
      from: 'completing',
      to: 'completed',
      expectedRevision: completing.revision,
      reason: null,
      timestamp: '2026-10-05T00:01:01.000Z'
    })
    harness.owner.insertMessage({
      from: 'term_fixture',
      to: `run:${RUN}`,
      subject: 'Run completed',
      body: 'Summarized the open issues.',
      type: 'status',
      payload: JSON.stringify({ kind: 'run_completed', runId: RUN })
    })
    expect(
      readers().snapshot(dotRequestId, { messageIds: [], validationIds: [] })?.deliverable
    ).toEqual({
      summary: 'Summarized the open issues.',
      artifacts: []
    })
  })

  it('shows a canceled request without a run view', async () => {
    await cancelDotRequest(harness.deps, dotRequestId)
    const snapshot = readers().snapshot(dotRequestId, { messageIds: [], validationIds: [] })
    expect(snapshot?.status).toEqual({
      state: 'canceled',
      statusText: DOT_REQUEST_STATUS_TEXT.canceled,
      run: null
    })
  })
})

describe('dot remote reader mappings', () => {
  const message = (overrides: Partial<RunMessageRecord>): RunMessageRecord => ({
    sequence: 1,
    messageId: 'm1',
    runId: RUN,
    source: 'dot',
    sourceRequestId: MESSAGE,
    text: null,
    textSha256: 'a'.repeat(64),
    state: 'received',
    outcome: null,
    reason: null,
    createdAt: '2026-10-05T00:00:12.000Z',
    updatedAt: '2026-10-05T00:00:12.000Z',
    deliveredAt: null,
    ...overrides
  })

  it.each([
    [{ state: 'received' as const }, null],
    [
      { state: 'delivered' as const, outcome: 'delivered' as const },
      { outcome: 'delivered', reason: null }
    ],
    [
      { state: 'delivered' as const, outcome: 'queued' as const, reason: 'agent_busy' },
      { outcome: 'queued', reason: 'agent_busy' }
    ],
    [
      { state: 'refused' as const, outcome: 'refused' as const, reason: 'request_id_reused' },
      { outcome: 'refused', reason: 'other' }
    ],
    [
      { state: 'refused' as const, outcome: 'refused' as const, reason: 'secret_shaped' },
      { outcome: 'refused', reason: 'secret_shaped' }
    ]
  ])('maps a C3 message %j', (overrides, expected) => {
    const outcome = messageOutcomeOf(message(overrides))
    expect(outcome).toEqual(expected === null ? null : { messageId: MESSAGE, ...expected })
  })

  it('keeps only decided validations of tasks Orca still holds, with the deciding line', () => {
    const base: Omit<TaskValidationRecord, 'validationId' | 'verdict' | 'checks'> = {
      taskId: 't',
      dispatchId: 'd',
      policy: 'model_review',
      criteriaSha256: 'a'.repeat(64),
      validatorId: 'v',
      workerModel: null,
      reviewerModel: null,
      evidenceRefs: [],
      waiver: null,
      waivedAt: null,
      createdAt: '2026-10-05T00:00:12.000Z',
      updatedAt: '2026-10-05T00:00:12.000Z',
      orphaned: false
    }
    const records: TaskValidationRecord[] = [
      { ...base, validationId: 'v1', verdict: 'pending', checks: [] },
      {
        ...base,
        validationId: 'v2',
        verdict: 'fail',
        checks: [
          { kind: 'artifact_exists', status: 'pass', note: 'Found.' },
          { kind: 'model_review', status: 'fail', note: 'Criterion 1 is not met.' }
        ]
      },
      { ...base, validationId: 'v3', verdict: 'pass', checks: [], orphaned: true }
    ]
    expect(validationFactsOf(records)).toEqual([
      { validationId: 'v2', verdict: 'fail', line: 'Criterion 1 is not met.' }
    ])
  })

  it('maps artifacts to size and hash only, never the path', () => {
    const record: AttemptArtifactRecord = {
      artifactId: 'artifact_1',
      dispatchId: 'd',
      kind: 'output',
      root: 'worktree',
      relativePath: 'docs/secret-plan.md',
      sha256: 'b'.repeat(64),
      sizeBytes: 42,
      createdAt: '2026-10-05T00:00:12.000Z',
      orphaned: false
    }
    const facts = artifactFactsOf([record, { ...record, artifactId: 'artifact_2', orphaned: true }])
    expect(facts).toEqual([{ artifactId: 'artifact_1', sizeBytes: 42, sha256: 'b'.repeat(64) }])
    expect(JSON.stringify(facts)).not.toContain('docs')
  })
})
