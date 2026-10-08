// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoutingTableChanges } from '../../../../shared/routing-table/routing-table-edit-schema'
import { RoutingTableTaskList } from './routing-table-active-view'
import { fixtureTable } from './routing-table-view.test-fixture'

afterEach(cleanup)

function renderTable(): void {
  render(
    <RoutingTableTaskList
      table={fixtureTable()}
      availability={null}
      busy={false}
      onSave={vi.fn(async () => true)}
    />
  )
}

describe('routing CLI choices', () => {
  it('shows Claude effort levels for a Claude primary', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinator effort' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Low',
      'Medium',
      'High',
      'Extra high',
      'Max'
    ])
  })

  it('updates the available task effort levels when its CLI changes', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Software engineering' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Agent for Software engineering' }))
    fireEvent.click(screen.getByRole('option', { name: 'agy CLI' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Effort for Software engineering' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Low',
      'Medium',
      'High'
    ])
  })

  it('uses the selected Codex model effort ceiling', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer 1' }))
    fireEvent.change(screen.getByLabelText('Model for Reviewer 1'), {
      target: { value: 'gpt-5.6-luna' }
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Effort for Reviewer 1' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Minimal',
      'Low',
      'Medium',
      'High',
      'Extra high',
      'Max'
    ])
  })

  it('replaces a now-unsupported primary effort when changing CLI', async () => {
    const onSave = vi
      .fn<(changes: RoutingTableChanges) => Promise<boolean>>()
      .mockResolvedValue(true)
    render(
      <RoutingTableTaskList
        table={fixtureTable({
          coordinator: { agent: 'codex', model: 'gpt-6-astra', reasoning_level: 'ultra' }
        })}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinator CLI' }))
    fireEvent.click(screen.getByRole('option', { name: 'Claude Code' }))
    fireEvent.change(screen.getByLabelText('Coordinator model'), {
      target: { value: 'claude-opus-5-5' }
    })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      changes: [],
      coordinator: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'high' }
    })
  })

  it('hides the effort selector for a model without a configurable effort', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    fireEvent.change(screen.getByLabelText('Coordinator model'), {
      target: { value: 'claude-haiku-4-5' }
    })
    expect(screen.queryByRole('combobox', { name: 'Coordinator effort' })).toBeNull()
  })

  it('edits only the workflow model and keeps the workflow on Claude', async () => {
    const onSave = vi
      .fn<(changes: RoutingTableChanges) => Promise<boolean>>()
      .mockResolvedValue(true)
    render(
      <RoutingTableTaskList
        table={fixtureTable()}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Configured project workflow' }))
    const row = screen.getByRole('listitem', { name: 'Configured project workflow' })
    expect(within(row).queryByRole('combobox')).toBeNull()
    expect(within(row).queryByRole('checkbox')).toBeNull()
    fireEvent.change(within(row).getByLabelText('Model for Configured project workflow'), {
      target: { value: 'claude-sonnet-5-5' }
    })
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      changes: [
        {
          task_type: 'configured_project_workflow',
          execution_target: 'claude_workflow',
          model: 'claude-sonnet-5-5',
          reasoning_level: 'inherit',
          reasoning_requirement: 'required'
        }
      ]
    })
  })
})
