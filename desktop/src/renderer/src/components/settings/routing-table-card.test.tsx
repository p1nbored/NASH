// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { RoutingTableCard } from './routing-table-card'
import {
  FIXTURE_SHA_V3,
  FIXTURE_SHA_V4,
  fixtureListResult,
  fixtureProposal
} from './routing-table-view.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

function answer(byMethod: Record<string, unknown>): void {
  rpc.mockImplementation(async (_target, method) => {
    const value = byMethod[method]
    if (value === undefined) {
      throw new Error(`unexpected method ${method}`)
    }
    return value
  })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

async function renderCard(): Promise<void> {
  render(<RoutingTableCard />)
  await act(async () => {})
}

function pendingProposal(): HTMLElement {
  return screen.getByRole('group', { name: /App update proposal/ })
}

describe('RoutingTableCard', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('reads the table through the local desktop runtime only', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.routingTable.list', {})
  })

  it('shows each task type with its target, model and reasoning, plus the reviewers', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    expect(screen.getByText('Version 3 active')).toBeTruthy()
    const routes = screen.getByRole('table', { name: 'Routes in version 3' })
    const engineering = within(routes).getByText('Software engineering').closest('tr')
    expect(engineering?.textContent).toContain('Claude subagent')
    expect(engineering?.textContent).toContain('claude-sonnet-5-5')
    expect(engineering?.textContent).toContain('Max')
    const workflow = within(routes).getByText('Configured project workflow').closest('tr')
    expect(workflow?.textContent).toContain('Inherits coordinator')
    const agy = within(routes).getByText('Fast writing or alternative draft').closest('tr')
    expect(agy?.textContent).toContain('when supported')
    const reviewers = screen.getByRole('list', { name: 'Validation reviewers' })
    expect(
      within(reviewers)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([expect.stringContaining('gpt-6.1-sol'), expect.stringContaining('claude-opus-5-5')])
  })

  it('shows a pending proposal as a before and after diff with its reason', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    const proposal = pendingProposal()
    expect(within(proposal).getByText(/Newer benchmark evidence/)).toBeTruthy()
    const change = within(proposal).getByRole('listitem')
    expect(change.textContent).toContain('Software engineering')
    expect(change.textContent).toContain('Claude subagent · claude-sonnet-5-5 · Max')
    expect(change.textContent).toContain('Codex CLI · gpt-6-astra · Max')
  })

  it('accepts a proposal, reports the new version and reads the table again', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.accept': {
        ok: true,
        version: 4,
        sha256: FIXTURE_SHA_V4,
        proposalId: 'proposal-0001'
      }
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Accept' }))
    })

    expect(callsTo('workbench.routingTable.accept')).toEqual([{ proposalId: 'proposal-0001' }])
    expect(screen.getByRole('status').textContent).toBe('Version 4 is now active.')
    expect(callsTo('workbench.routingTable.list')).toHaveLength(2)
  })

  it('rejects a proposal through the desktop RPC', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.reject': {
        ok: true,
        version: null,
        sha256: null,
        proposalId: 'proposal-0001'
      }
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Reject' }))
    })

    expect(callsTo('workbench.routingTable.reject')).toEqual([{ proposalId: 'proposal-0001' }])
    expect(screen.getByRole('status').textContent).toBe('Proposal rejected.')
  })

  it('explains a refusal in plain English, never as a code', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.accept': {
        ok: false,
        reason: 'proposal_superseded',
        detail: null,
        existingProposalId: null
      }
    })
    await renderCard()

    await act(async () => {
      fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Accept' }))
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/older version/i)
    expect(alert.textContent).not.toContain('proposal_superseded')
  })

  it('accepts an edited proposal with the edited rows as the modification', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.accept': {
        ok: true,
        version: 4,
        sha256: FIXTURE_SHA_V4,
        proposalId: 'proposal-0001'
      }
    })
    await renderCard()

    fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Edit and accept' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Model for Software engineering'), {
      target: { value: 'gpt-6.1-sol' }
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept with changes' }))
    })

    expect(callsTo('workbench.routingTable.accept')).toEqual([
      {
        proposalId: 'proposal-0001',
        modification: {
          changes: [
            {
              task_type: 'software_engineering',
              execution_target: 'codex_cli',
              model: 'gpt-6.1-sol',
              reasoning_level: 'max',
              reasoning_requirement: 'required'
            }
          ]
        }
      }
    ])
  })

  it('refuses an alias in the editor and sends nothing', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Edit and accept' }))
    const dialog = await screen.findByRole('dialog')
    const model = within(dialog).getByLabelText('Model for Software engineering')
    fireEvent.change(model, { target: { value: 'opus' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept with changes' }))

    expect(within(dialog).getByRole('alert').textContent).toMatch(/exact model ID/i)
    expect(model.getAttribute('aria-invalid')).toBe('true')
    expect(callsTo('workbench.routingTable.accept')).toHaveLength(0)
  })

  it('saves edited routes as a pending proposal that still needs accepting', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({ proposals: [] }),
      'workbench.routingTable.import': {
        ok: true,
        version: null,
        sha256: null,
        proposalId: 'proposal-0002'
      }
    })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit routes' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Model for Routine analysis batch'), {
      target: { value: 'gpt-6-astra' }
    })
    fireEvent.change(within(dialog).getByLabelText('Reason for the change'), {
      target: { value: 'Astra for batches.' }
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save as proposal' }))
    })

    expect(callsTo('workbench.routingTable.import')).toEqual([
      {
        proposal: {
          schema_version: 1,
          proposer: 'user_import',
          base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
          changes: [
            {
              task_type: 'routine_analysis_batch',
              execution_target: 'codex_cli',
              model: 'gpt-6-astra',
              reasoning_level: 'high',
              reasoning_requirement: 'required'
            }
          ],
          rationale: 'Astra for batches.',
          evidence: []
        }
      }
    ])
    expect(screen.getByRole('status').textContent).toMatch(/accept it to activate/i)
  })

  it('imports a pasted change set as a pending proposal', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({ proposals: [] }),
      'workbench.routingTable.import': {
        ok: false,
        reason: 'duplicate_content',
        detail: null,
        existingProposalId: 'proposal-0001'
      }
    })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Change set (JSON)'), {
      target: { value: JSON.stringify({ changes: [fixtureProposal().changes[0]] }) }
    })
    fireEvent.change(within(dialog).getByLabelText('Reason for the change'), {
      target: { value: 'Imported.' }
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Import as proposal' }))
    })

    expect(callsTo('workbench.routingTable.import')).toHaveLength(1)
    expect(screen.getByRole('alert').textContent).toContain('proposal-0001')
  })

  it('reverts to an earlier version only after an in-page confirmation', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.revert': {
        ok: true,
        version: 4,
        sha256: FIXTURE_SHA_V4,
        proposalId: null
      }
    })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Revert to version 2' }))
    const dialog = await screen.findByRole('dialog')
    expect(callsTo('workbench.routingTable.revert')).toHaveLength(0)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Revert' }))
    })

    expect(callsTo('workbench.routingTable.revert')).toEqual([{ version: 2 }])
    expect(screen.getByRole('status').textContent).toMatch(/Version 4 is now active/)
  })

  it('cannot accept a stale proposal and says why', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({
        proposals: [
          {
            proposal: fixtureProposal({ base: { table_version: 2, sha256: '2'.repeat(64) } }),
            decision: null,
            stale: true
          }
        ]
      })
    })
    await renderCard()

    const proposal = pendingProposal()
    expect(within(proposal).getByRole('button', { name: 'Accept' })).toHaveProperty(
      'disabled',
      true
    )
    expect(within(proposal).getByText(/based on version 2/i)).toBeTruthy()
  })

  it('shows a damaged store as blocked and never draws a default table', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({
        active: {
          ok: false,
          reason: 'routing_table_integrity_failed',
          detail: 'version_hash_mismatch',
          existingProposalId: null
        },
        activeVersion: null,
        versions: [],
        proposals: [],
        unreadableProposalIds: ['proposal-0009']
      })
    })
    await renderCard()

    expect(screen.getByText('Blocked')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Routing is blocked' }).textContent).toMatch(
      /does not match its recorded hash/
    )
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/Unreadable proposal files: 1\./)).toBeTruthy()
  })

  it('says the Routing Table is not connected when this build has no such method', async () => {
    rpc.mockRejectedValue(
      new RuntimeRpcCallError({
        id: 'rpc-1',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method' }
      })
    )
    await renderCard()

    expect(screen.getByText('Unavailable')).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not connected/i))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
