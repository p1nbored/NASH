// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoutingTableTaskList } from './routing-table-active-view'
import { RoutingModelsContext } from './routing-table-model-select'
import { fixtureTable } from './routing-table-view.test-fixture'

afterEach(cleanup)
const MODELS = {
  claude: [{ id: 'claude-sonnet-5-5', label: 'Sonnet CLI', efforts: ['low', 'high'] }],
  codex: [{ id: 'gpt-6-astra', label: 'Codex CLI', efforts: ['high', 'ultra'] }],
  agy: null
}

describe('CLI model choices in routing', () => {
  it('uses the Claude model list and its effort choices for the workflow', async () => {
    const save = vi.fn(async () => true)
    render(
      <RoutingModelsContext.Provider value={MODELS}>
        <RoutingTableTaskList
          table={fixtureTable()}
          availability={null}
          busy={false}
          onSave={save}
        />
      </RoutingModelsContext.Provider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Configured project workflow' }))
    expect(
      screen.queryByRole('combobox', { name: 'Agent for Configured project workflow' })
    ).toBeNull()
    fireEvent.click(screen.getByRole('combobox', { name: 'Model for Configured project workflow' }))
    expect(screen.queryByRole('option', { name: 'Codex CLI' })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Sonnet CLI' }))
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Effort for Configured project workflow' })
    )
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Low',
      'High'
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Low' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(save).toHaveBeenCalledWith({
      changes: [
        expect.objectContaining({
          task_type: 'configured_project_workflow',
          execution_target: 'claude_workflow',
          model: 'claude-sonnet-5-5',
          reasoning_level: 'low'
        })
      ]
    })
  })
})
