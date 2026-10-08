import { describe, expect, it } from 'vitest'
import { diffProposal } from './routing-table-diff'
import { fixtureProposal, fixtureTable } from './routing-table-view.test-fixture'

describe('diffProposal', () => {
  it('pairs each proposed row with the active row it replaces', () => {
    const diff = diffProposal(fixtureTable(), fixtureProposal())

    expect(diff.routes).toHaveLength(1)
    const [row] = diff.routes
    expect(row.taskType).toBe('software_engineering')
    expect(row.before).toMatchObject({
      execution_target: 'claude_subagent',
      model: 'claude-sonnet-5-5',
      reasoning_level: 'max'
    })
    expect(row.after).toMatchObject({ execution_target: 'codex_cli', model: 'gpt-6-astra' })
    expect(row.policyChanged).toBe(true)
    expect(diff.coordinator).toBeNull()
    expect(diff.validation).toBeNull()
  })

  it('marks a row whose routing fields are unchanged', () => {
    const proposal = fixtureProposal({
      changes: [
        {
          task_type: 'software_engineering',
          execution_target: 'claude_subagent',
          model: 'claude-sonnet-5-5',
          reasoning_level: 'max',
          notes: 'Same route with a new note.'
        }
      ]
    })

    expect(diffProposal(fixtureTable(), proposal).routes[0].policyChanged).toBe(false)
  })

  it('reports coordinator and reviewer replacements against the active values', () => {
    const proposal = fixtureProposal({
      changes: [],
      coordinator: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'xhigh' },
      validation: {
        reviewers: [
          { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' }
        ]
      }
    })

    const diff = diffProposal(fixtureTable(), proposal)

    expect(diff.coordinator).toEqual({
      before: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'max' },
      after: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'xhigh' }
    })
    expect(diff.validation?.before?.reviewers).toHaveLength(2)
    expect(diff.validation?.after.reviewers).toHaveLength(1)
  })

  it('has nothing to compare against when no table is active', () => {
    const diff = diffProposal(null, fixtureProposal())

    expect(diff.routes[0].before).toBeNull()
    expect(diff.routes[0].policyChanged).toBe(true)
  })
})
