// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoutingTableChanges } from '../../../../shared/routing-table/routing-table-edit-schema'
import { RoutingTableTaskList } from './routing-table-active-view'
import { fixtureTable } from './routing-table-view.test-fixture'

afterEach(cleanup)

function reviewerRow(): HTMLElement {
  return within(screen.getByRole('list', { name: 'Reviewers' })).getByRole('listitem', {
    name: 'Reviewer 1'
  })
}

describe('inline reviewer editing', () => {
  it('saves the edited reviewer while preserving the other reviewers and policy notes', async () => {
    const onSave = vi
      .fn<(changes: RoutingTableChanges) => Promise<boolean>>()
      .mockResolvedValue(true)
    const base = fixtureTable()
    const table = fixtureTable({ validation: { ...base.validation, notes: 'Independent review.' } })
    render(<RoutingTableTaskList table={table} availability={null} busy={false} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer 1' }))
    const row = reviewerRow()
    fireEvent.change(within(row).getByLabelText('Model for Reviewer 1'), {
      target: { value: 'gpt-6-astra' }
    })
    fireEvent.click(within(row).getByRole('combobox', { name: 'Effort for Reviewer 1' }))
    fireEvent.click(screen.getByRole('option', { name: 'Max' }))
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      changes: [],
      validation: {
        ...table.validation,
        reviewers: [
          { target: 'codex_cli', model: 'gpt-6-astra', reasoning_level: 'max' },
          table.validation.reviewers[1]
        ]
      }
    })
    expect(screen.queryByLabelText('Model for Reviewer 1')).toBeNull()
  })

  it('requires an explicit model when switching reviewer CLI and keeps invalid edits open', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer 1' }))
    const row = reviewerRow()
    fireEvent.click(within(row).getByRole('combobox', { name: 'Agent for Reviewer 1' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Codex CLI',
      'Claude headless review'
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Claude headless review' }))
    const model = within(row).getByLabelText('Model for Reviewer 1')
    expect(model).toHaveProperty('value', '')
    fireEvent.change(model, { target: { value: 'opus' } })
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(within(row).getByRole('alert').textContent).toMatch(/exact model ID/i)
    expect(model.getAttribute('aria-invalid')).toBe('true')
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(model, { target: { value: 'claude-opus-5-5' } })
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      validation: {
        reviewers: [
          { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' },
          fixtureTable().validation.reviewers[1]
        ]
      }
    })
  })

  it.each(['Save', 'Cancel'])(
    'closes an untouched reviewer using %s without saving',
    async (action) => {
      const onSave = vi.fn(async () => true)
      render(
        <RoutingTableTaskList
          table={fixtureTable()}
          availability={null}
          busy={false}
          onSave={onSave}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer 1' }))
      await act(async () =>
        fireEvent.click(within(reviewerRow()).getByRole('button', { name: action }))
      )
      expect(onSave).not.toHaveBeenCalled()
      expect(screen.queryByLabelText('Model for Reviewer 1')).toBeNull()
    }
  )

  it('keeps a refused reviewer edit open and discards it when a newer table arrives', async () => {
    const onSave = vi.fn(async () => false)
    const { rerender } = render(
      <RoutingTableTaskList
        table={fixtureTable()}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer 1' }))
    fireEvent.change(screen.getByLabelText('Model for Reviewer 1'), {
      target: { value: 'gpt-6-astra' }
    })
    await act(async () =>
      fireEvent.click(within(reviewerRow()).getByRole('button', { name: 'Save' }))
    )
    expect(screen.getByLabelText('Model for Reviewer 1')).toHaveProperty('value', 'gpt-6-astra')
    expect(screen.getByRole('button', { name: 'Edit Reviewer 2' })).toHaveProperty('disabled', true)
    rerender(
      <RoutingTableTaskList
        table={fixtureTable({ table_version: 4 })}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    expect(screen.queryByLabelText('Model for Reviewer 1')).toBeNull()
    expect(reviewerRow().textContent).toContain('gpt-6.1-sol')
  })
})
