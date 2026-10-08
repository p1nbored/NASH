import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_VALIDATION_DECISIONS_MAX_LIMIT,
  WorkbenchValidationDecideParams,
  WorkbenchValidationDecideResultSchema,
  WorkbenchValidationListDecisionsParams,
  WorkbenchValidationListDecisionsResultSchema
} from './workbench-validation-decision-params'

// FIXTURE_ONLY: synthetic in-session task ids.
const VIEW = {
  validationId: 'validation_0123456789ab',
  runId: 'run_0123456789ab',
  taskId: 'task_0123456789ab',
  dispatchId: 'ctx_0123456789ab',
  title: 'Summarize the repository layout.',
  executorKind: 'claude_primary',
  model: null,
  reason: 'The task report could not be verified.',
  inconclusiveAt: '2026-10-06T08:00:00.000Z'
}

describe('workbench validation decision contract', () => {
  it('lists with an optional bounded limit and nothing else', () => {
    expect(WorkbenchValidationListDecisionsParams.safeParse({}).success).toBe(true)
    expect(
      WorkbenchValidationListDecisionsParams.safeParse({
        limit: WORKBENCH_VALIDATION_DECISIONS_MAX_LIMIT
      }).success
    ).toBe(true)
    for (const params of [
      { limit: 0 },
      { limit: WORKBENCH_VALIDATION_DECISIONS_MAX_LIMIT + 1 },
      { origin: 'dot' }
    ]) {
      expect(WorkbenchValidationListDecisionsParams.safeParse(params).success).toBe(false)
    }
  })

  it('decides waive or reject for one validation and lets no caller name the decider', () => {
    const base = { validationId: VIEW.validationId }
    expect(WorkbenchValidationDecideParams.safeParse({ ...base, decision: 'waive' }).success).toBe(
      true
    )
    expect(WorkbenchValidationDecideParams.safeParse({ ...base, decision: 'reject' }).success).toBe(
      true
    )
    for (const params of [
      { ...base, decision: 'pass' },
      { ...base, decision: 'waive', by: 'dot' },
      { validationId: 'has space', decision: 'waive' }
    ]) {
      expect(WorkbenchValidationDecideParams.safeParse(params).success).toBe(false)
    }
  })

  it('accepts a view of a newer executor name instead of failing the list', () => {
    const newer = { ...VIEW, executorKind: 'future_cli' }
    expect(
      WorkbenchValidationListDecisionsResultSchema.safeParse({
        decisions: [VIEW, newer],
        hasMore: true
      }).success
    ).toBe(true)
  })

  it('describes a decision outcome by its result words', () => {
    const outcome = {
      validationId: VIEW.validationId,
      taskId: VIEW.taskId,
      runId: VIEW.runId,
      decision: 'waived',
      taskStatus: 'completed',
      noticeFiled: true
    }
    expect(WorkbenchValidationDecideResultSchema.safeParse(outcome).success).toBe(true)
    expect(
      WorkbenchValidationDecideResultSchema.safeParse({ ...outcome, decision: 'waive' }).success
    ).toBe(false)
  })
})
