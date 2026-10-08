import { describe, expect, it } from 'vitest'
import type { EditableRoute } from './routing-table-editor-model'
import {
  editForSameAsCoordinator,
  editForTarget,
  settingsEditSubmission
} from './routing-table-inline-edit'
import { FIXTURE_SHA_V3 } from './routing-table-view.test-fixture'

const COORDINATOR = { agent: 'claude', model: 'claude-opus-5-5', reasoningLevel: 'max' } as const

function row(overrides: Partial<EditableRoute> = {}): EditableRoute {
  const base = {
    taskType: 'software_engineering',
    target: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    reasoningLevel: 'max',
    requirement: 'required'
  } as const
  return {
    ...base,
    original: {
      task_type: base.taskType,
      execution_target: base.target,
      model: base.model,
      reasoning_level: base.reasoningLevel,
      reasoning_requirement: base.requirement
    },
    ...overrides
  }
}

describe('editForTarget', () => {
  it('runs the primary session with the coordinator settings', () => {
    expect(editForTarget(row(), 'claude_primary')).toEqual({
      target: 'claude_primary',
      model: 'inherit',
      reasoningLevel: 'inherit',
      requirement: 'required'
    })
  })

  it('asks for a model when the new agent cannot share the coordinator settings', () => {
    const inheriting = row({
      target: 'claude_workflow',
      model: 'inherit',
      reasoningLevel: 'inherit'
    })
    expect(editForTarget(inheriting, 'codex_cli')).toEqual({
      target: 'codex_cli',
      model: '',
      reasoningLevel: 'high',
      requirement: 'required'
    })
  })

  it('keeps the model and effort otherwise', () => {
    expect(editForTarget(row(), 'codex_cli')).toEqual({
      target: 'codex_cli',
      reasoningLevel: 'max'
    })
  })
})

describe('editForSameAsCoordinator', () => {
  it('inherits both values when on, and starts from the coordinator when off', () => {
    expect(editForSameAsCoordinator(true, COORDINATOR)).toEqual({
      model: 'inherit',
      reasoningLevel: 'inherit',
      requirement: 'required'
    })
    expect(editForSameAsCoordinator(false, COORDINATOR)).toEqual({
      model: 'claude-opus-5-5',
      reasoningLevel: 'max'
    })
  })
})

describe('settingsEditSubmission', () => {
  it('fences the edit to the version shown', () => {
    const submission = settingsEditSubmission(
      {
        changes: [
          {
            task_type: 'software_engineering',
            execution_target: 'codex_cli',
            model: 'gpt-6-astra',
            reasoning_level: 'max',
            reasoning_requirement: 'required'
          }
        ]
      },
      { version: 3, sha256: FIXTURE_SHA_V3 }
    )

    expect(submission?.base).toEqual({ table_version: 3, sha256: FIXTURE_SHA_V3 })
  })
})
