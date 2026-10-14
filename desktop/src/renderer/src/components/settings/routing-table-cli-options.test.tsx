// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoutingTableChanges } from '../../../../shared/routing-table/routing-table-edit-schema'
import { ROUTING_AGENTS } from '../../../../shared/routing-table/routing-cli-registry'
import { primaryAgentLabel } from './routing-table-labels'
import { RoutingTableTaskList } from './routing-table-active-view'
import {
  fixtureTable,
  renderRouting as render,
  selectModel
} from './routing-table-view.test-fixture'

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
  it('offers every routable CLI for the coordinator', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinator CLI' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(
      ROUTING_AGENTS.map(primaryAgentLabel)
    )
  })

  it('clears a provider model and saves a Gemini model with CLI default effort', async () => {
    const onSave = vi.fn(async () => true)
    render(
      <RoutingTableTaskList
        table={fixtureTable()}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Software engineering' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Agent for Software engineering' }))
    fireEvent.click(screen.getByRole('option', { name: 'Gemini' }))
    expect(screen.getByLabelText('Model for Software engineering').textContent).not.toContain(
      'gpt-'
    )
    selectModel(screen.getByLabelText('Model for Software engineering'), 'gemini-3.1-pro-preview')
    expect(screen.queryByRole('combobox', { name: 'Effort for Software engineering' })).toBeNull()
    expect(screen.getByText('CLI default')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledWith({
      changes: [
        expect.objectContaining({
          execution_target: 'gemini_cli',
          model: 'gemini-3.1-pro-preview',
          reasoning_level: 'none'
        })
      ]
    })
  })

  it('keeps the selected Antigravity effort and model suffix aligned', async () => {
    const onSave = vi.fn(async () => true)
    render(
      <RoutingTableTaskList
        table={fixtureTable()}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Software engineering' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Agent for Software engineering' }))
    fireEvent.click(screen.getByRole('option', { name: 'agy CLI' }))
    selectModel(screen.getByLabelText('Model for Software engineering'), 'gemini-3.8-flash-high')
    fireEvent.click(screen.getByRole('combobox', { name: 'Effort for Software engineering' }))
    fireEvent.click(screen.getByRole('option', { name: 'Low' }))
    expect(screen.getByLabelText('Model for Software engineering').textContent).toContain(
      'gemini-3.8-flash-low'
    )
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledWith({
      changes: [
        expect.objectContaining({
          execution_target: 'agy_cli',
          model: 'gemini-3.8-flash-low',
          reasoning_level: 'low'
        })
      ]
    })
  })

  it('accepts an exact Muse model when no discovery list exists', async () => {
    const onSave = vi.fn(async () => true)
    render(
      <RoutingTableTaskList
        table={fixtureTable()}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Coordinator CLI' }))
    fireEvent.click(screen.getByRole('option', { name: 'Muse' }))
    const model = screen.getByRole('textbox', { name: 'Coordinator model' })
    expect(model.getAttribute('value')).toBe('')
    fireEvent.change(model, { target: { value: 'muse-reasoner-v1' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledWith({
      changes: [],
      coordinator: { agent: 'muse', model: 'muse-reasoner-v1', reasoning_level: 'max' }
    })
  })

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
    selectModel(screen.getByLabelText('Model for Reviewer 1'), 'gpt-5.6-luna')
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
    selectModel(screen.getByLabelText('Coordinator model'), 'claude-opus-5-5')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      changes: [],
      coordinator: { agent: 'claude', model: 'claude-opus-5-5', reasoning_level: 'high' }
    })
  })

  it('hides the effort selector for a model without a configurable effort', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    selectModel(screen.getByLabelText('Coordinator model'), 'claude-haiku-4-5')
    expect(screen.queryByRole('combobox', { name: 'Coordinator effort' })).toBeNull()
  })

  it('edits workflow model and effort while keeping its CLI fixed to Claude', async () => {
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
    expect(
      within(row).queryByRole('combobox', { name: 'Agent for Configured project workflow' })
    ).toBeNull()
    expect(within(row).queryByRole('checkbox')).toBeNull()
    selectModel(
      within(row).getByLabelText('Model for Configured project workflow'),
      'claude-sonnet-5-5'
    )
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      changes: [
        {
          task_type: 'configured_project_workflow',
          execution_target: 'claude_workflow',
          model: 'claude-sonnet-5-5',
          reasoning_level: 'high',
          reasoning_requirement: 'required'
        }
      ]
    })
  })
})
