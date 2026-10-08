// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRoutingTable } from './use-routing-table'
import { RoutingTableTaskList } from './routing-table-active-view'
import { fixtureListResult, fixtureProposal, fixtureTable } from './routing-table-view.test-fixture'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('routing edits under concurrent changes and failed activation', () => {
  it.each(['refused', 'disconnected'])(
    'rejects its imported edit if activation is %s',
    async (mode) => {
      rpc.mockImplementation(async (_target: unknown, method: string) => {
        if (method === 'workbench.routingTable.list') {
          return fixtureListResult()
        }
        if (method === 'workbench.routingTable.accept') {
          if (mode === 'disconnected') {
            throw new Error('connection lost')
          }
          return {
            ok: false,
            reason: 'proposal_superseded',
            detail: null,
            existingProposalId: null
          }
        }
        return { ok: true, version: null, sha256: null, proposalId: 'proposal-local' }
      })
      const { result } = renderHook(() => useRoutingTable())
      await act(async () => {})
      await act(async () => {
        expect(await result.current.applyEdit(fixtureProposal())).toBe(false)
      })
      expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.routingTable.reject', {
        proposalId: 'proposal-local'
      })
      expect(result.current.notice?.kind).toBe('error')
    }
  )

  it('closes an old draft when a newer active table arrives, so it cannot overwrite concurrent edits', () => {
    const onSave = vi.fn(async () => true)
    const { rerender } = render(
      <RoutingTableTaskList
        table={fixtureTable()}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit Routine analysis batch' }))
    fireEvent.change(screen.getByLabelText('Model for Routine analysis batch'), {
      target: { value: 'gpt-6-astra' }
    })
    rerender(
      <RoutingTableTaskList
        table={fixtureTable({ table_version: 4 })}
        availability={null}
        busy={false}
        onSave={onSave}
      />
    )
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(onSave).not.toHaveBeenCalled()
  })
})
