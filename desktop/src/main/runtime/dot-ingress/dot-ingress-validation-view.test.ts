import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DotValidationViewSchema } from '../../../shared/dot-ingress/dot-ingress-validation'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import type { ValidationCheck } from '../orchestration/db/task-validation-record'
import { createTaskValidationPort } from '../task-validation/task-validation-port'
import { createValidationDecisionService } from '../task-validation/validation-decision-service'
import {
  FIXTURE_REASON,
  inconclusiveAttempt
} from '../task-validation/validation-decision.test-fixture'
import {
  buildDotValidationView,
  dotSummarySource,
  dotValidationReason
} from './dot-ingress-validation-view'

const DOT_REQUEST = '00000000-0000-4000-8000-0000000000aa'
const PRIMARY_ROUTE = {
  target: 'claude_primary',
  model: null,
  policyLevel: 'inherit',
  cliSetting: null
} as const

const check = (kind: string, status: ValidationCheck['status'], note?: string): ValidationCheck =>
  note === undefined ? { kind, status } : { kind, status, note }

describe('dot validation reason codes', () => {
  const reasonOf = (checks: ValidationCheck[], executorKind = 'codex', evidence: string[] = []) =>
    dotValidationReason(
      { checks, evidenceRefs: evidence.map((kind) => ({ kind, ref: 'fixture' })) },
      executorKind
    )

  it('maps the first undecided check to a fixed code', () => {
    expect(reasonOf([check('work_evidence', 'inconclusive')])).toBe('claim_only')
    expect(reasonOf([check('session_report', 'inconclusive')], 'claude_primary')).toBe(
      'primary_did_task'
    )
    expect(reasonOf([check('session_report', 'inconclusive')], 'claude_subagent')).toBe(
      'report_missing'
    )
    expect(reasonOf([check('model_review', 'inconclusive')])).toBe('review_unavailable')
    expect(reasonOf([check('model_review', 'inconclusive')], 'codex', ['reviewer_run'])).toBe(
      'review_inconclusive'
    )
    for (const kind of [
      'executor_completed',
      'artifact_exists',
      'output_schema',
      'no_workspace_writes',
      'secret_scan_clean'
    ]) {
      expect(reasonOf([check(kind, 'inconclusive')]), kind).toBe('checks_inconclusive')
    }
  })

  it('skips passing checks and maps anything unknown or missing to other', () => {
    expect(
      reasonOf([check('executor_completed', 'pass'), check('work_evidence', 'inconclusive')])
    ).toBe('claim_only')
    expect(reasonOf([check('validator_error', 'inconclusive')])).toBe('other')
    expect(reasonOf([check('executor_completed', 'pass')])).toBe('other')
    expect(reasonOf([])).toBe('other')
  })
})

describe('dot validation summary source', () => {
  it("uses the reviewer's line for a model review", () => {
    const source = dotSummarySource(
      {
        policy: 'model_review',
        checks: [
          check('artifact_exists', 'pass', 'Found.'),
          check('model_review', 'inconclusive', 'The reviewer could not tell.')
        ]
      },
      'claude_subagent',
      'Primary report text.'
    )
    expect(source).toBe('The reviewer could not tell.')
  })

  it("uses the primary's task report for an in-session task", () => {
    const validation = {
      policy: 'machine_checks' as const,
      checks: [check('session_report', 'inconclusive', 'The primary did this itself.')]
    }
    expect(dotSummarySource(validation, 'claude_primary', 'Wrote the summary.')).toBe(
      'Wrote the summary.'
    )
    expect(dotSummarySource(validation, 'claude_primary', null)).toBe(
      'The primary did this itself.'
    )
  })

  it("uses the check's reason line for a process check, never a report", () => {
    expect(
      dotSummarySource(
        { policy: 'machine_checks', checks: [check('artifact_exists', 'inconclusive', 'Gone.')] },
        'codex',
        'Ignored.'
      )
    ).toBe('Gone.')
    expect(dotSummarySource({ policy: 'machine_checks', checks: [] }, 'codex', null)).toBeNull()
  })
})

describe('dot validation view (the U32 exception: title, reason, summary)', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  function pendingEntry() {
    const service = createValidationDecisionService({
      owner: harness.owner,
      readOrigin: () => 'dot'
    })
    const [entry] = service.listPending({ limit: 10, origin: 'dot' }).decisions
    if (!entry) {
      throw new Error('no pending decision')
    }
    return entry
  }

  it('shows only the approved fields for an in-session result', () => {
    const write = inconclusiveAttempt(harness)
    const view = buildDotValidationView(harness.owner, pendingEntry(), DOT_REQUEST)
    expect(DotValidationViewSchema.parse(view)).toEqual({
      validationId: write.validationId,
      dotRequestId: DOT_REQUEST,
      title: 'Summarize the repository layout in a short report.',
      reason: 'primary_did_task',
      summary: FIXTURE_REASON,
      summaryWithheld: false,
      createdAt: fixtureTime(9)
    })
    const text = JSON.stringify(view)
    for (const hidden of ['gpt-6.1-sol', harness.runId, write.taskId, write.dispatchId]) {
      expect(text).not.toContain(hidden)
    }
  })

  it("sends the primary's masked report for a task it did itself", () => {
    const task = inconclusiveAttempt(harness, {
      route: PRIMARY_ROUTE,
      verdict: 'pending'
    })
    harness.owner.insertMessage({
      runId: harness.runId,
      from: `dispatch:${task.dispatchId}`,
      to: `run:${harness.runId}`,
      subject: 'Task claimed',
      body: 'Wrote the report to C:\\fixture\\out\\report.md and checked "README.md".',
      type: 'status',
      priority: 'normal',
      payload: JSON.stringify({
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        outcome: 'claimed'
      })
    })
    createTaskValidationPort(harness.owner).recordVerdict({
      validationId: task.validationId,
      verdict: 'inconclusive',
      checks: [
        check('session_report', 'inconclusive', 'The primary session did this task itself.')
      ],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
    const view = buildDotValidationView(harness.owner, pendingEntry(), DOT_REQUEST)
    expect(view).toMatchObject({
      reason: 'primary_did_task',
      summary: 'Wrote the report to [path] and checked [quoted text].',
      summaryWithheld: false
    })
  })

  it('withholds a summary the scan still flags and keeps a masked title', () => {
    const task = inconclusiveAttempt(harness, { verdict: 'pending' })
    createTaskValidationPort(harness.owner).recordVerdict({
      validationId: task.validationId,
      verdict: 'inconclusive',
      checks: [
        check(
          'artifact_exists',
          'inconclusive',
          'Key Q7wErTyUiOpAsDfGhJkLzXcVbNm1234567890QwEr was printed.'
        )
      ],
      evidenceRefs: [],
      timestamp: fixtureTime(9)
    })
    expect(buildDotValidationView(harness.owner, pendingEntry(), DOT_REQUEST)).toMatchObject({
      summary: null,
      summaryWithheld: true
    })
  })
})
