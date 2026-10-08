// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { useRoutingTable } from './use-routing-table'
import { RoutingTableTaskList } from './routing-table-active-view'
import { RoutingTableCard } from './routing-table-card'
import {
  FIXTURE_SHA_V3,
  FIXTURE_SHA_V4,
  fixtureListResult,
  fixtureProposal,
  fixtureTable
} from './routing-table-view.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)
const clipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>())

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

function taskRow(name: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Agent for each task' })
  return within(list).getByRole('listitem', { name })
}

function openAdvanced(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
}

function pendingProposal(): HTMLElement {
  return screen.getByRole('group', { name: 'App update' })
}

async function copiedDetails(): Promise<string> {
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy details' })[0])
  })
  return clipboard.mock.calls.at(-1)?.[0] ?? ''
}

describe('RoutingTableCard', () => {
  beforeEach(() => {
    rpc.mockReset()
    clipboard.mockReset()
    clipboard.mockResolvedValue(undefined)
    Object.assign(window, { api: { ui: { writeClipboardText: clipboard } } })
  })

  afterEach(() => {
    cleanup()
  })

  it('reads the table through the local desktop runtime only', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.routingTable.list', {})
  })

  it('shows each kind of task with its agent, model and effort, then the reviewers', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    const engineering = taskRow('Software engineering')
    expect(engineering.textContent).toContain('Claude subagent')
    expect(engineering.textContent).toContain('claude-sonnet-5-5')
    expect(engineering.textContent).toContain('Max')
    expect(taskRow('Configured project workflow').textContent).toContain('Same as primary')
    expect(taskRow('Fast writing or alternative draft').textContent).toContain('when supported')
    expect(taskRow('Primary').textContent).toContain('Claude Code')
    expect(screen.queryByRole('listitem', { name: 'Primary reasoning' })).toBeNull()
    const reviewers = screen.getByRole('list', { name: 'Reviewers' })
    expect(
      within(reviewers)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([expect.stringContaining('gpt-6.1-sol'), expect.stringContaining('claude-opus-5-5')])
  })

  it('keeps versions, hashes and suggestion ids out of the visible text until Advanced opens', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    const text = document.body.textContent ?? ''
    expect(text).not.toContain(FIXTURE_SHA_V3.slice(0, 12))
    expect(text).not.toContain('proposal-0001')
    expect(text).not.toMatch(/Version 3/)
    expect(screen.queryByRole('group', { name: 'App update' })).toBeNull()

    openAdvanced()

    expect(screen.getByText('Version 3 active')).toBeTruthy()
    expect(document.body.textContent).not.toContain(FIXTURE_SHA_V3.slice(0, 12))
    expect(document.body.textContent).not.toContain('proposal-0001')
    const details = await copiedDetails()
    expect(details).toContain(FIXTURE_SHA_V3)
    expect(details).toContain('proposal-0001')
  })

  it('says how many suggested changes wait and opens them for review', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    expect(screen.getByText('Suggested changes to review: 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    const proposal = pendingProposal()
    expect(within(proposal).getByText(/Newer benchmark evidence/)).toBeTruthy()
    const change = within(proposal).getByRole('listitem')
    expect(change.textContent).toContain('Software engineering')
    expect(change.textContent).toContain('Claude subagent · claude-sonnet-5-5 · Max')
    expect(change.textContent).toContain('Codex CLI · gpt-6-astra · Max')
  })

  it('accepts a suggested change, reports the new version and reads the table again', async () => {
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
    openAdvanced()

    await act(async () => {
      fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Accept' }))
    })

    expect(callsTo('workbench.routingTable.accept')).toEqual([{ proposalId: 'proposal-0001' }])
    expect(screen.getByRole('status').textContent).toBe('Version 4 is now active.')
    expect(callsTo('workbench.routingTable.list')).toHaveLength(2)
  })

  it('rejects a suggested change through the desktop RPC', async () => {
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
    openAdvanced()

    await act(async () => {
      fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Reject' }))
    })

    expect(callsTo('workbench.routingTable.reject')).toEqual([{ proposalId: 'proposal-0001' }])
    expect(screen.getByRole('status').textContent).toBe('Suggested change rejected.')
  })

  it('explains a refusal in plain English and keeps its code behind Copy details', async () => {
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
    openAdvanced()

    await act(async () => {
      fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Accept' }))
    })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/older choices/i)
    expect(alert.textContent).not.toContain('proposal_superseded')
    expect(await copiedDetails()).toContain('reason: proposal_superseded')
  })

  it('accepts an edited suggestion with the edited rows as the modification', async () => {
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
    openAdvanced()

    fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Edit and accept' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).not.toContain('proposal-0001')
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

  it('refuses an alias in the suggestion editor and sends nothing', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()
    openAdvanced()

    fireEvent.click(within(pendingProposal()).getByRole('button', { name: 'Edit and accept' }))
    const dialog = await screen.findByRole('dialog')
    const model = within(dialog).getByLabelText('Model for Software engineering')
    fireEvent.change(model, { target: { value: 'opus' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept with changes' }))

    expect(within(dialog).getByRole('alert').textContent).toMatch(/exact model ID/i)
    expect(model.getAttribute('aria-invalid')).toBe('true')
    expect(callsTo('workbench.routingTable.accept')).toHaveLength(0)
  })

  it('saves an edit made in place as the user change and puts it into use', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({ proposals: [] }),
      'workbench.routingTable.import': {
        ok: true,
        version: null,
        sha256: null,
        proposalId: 'proposal-0002'
      },
      'workbench.routingTable.accept': {
        ok: true,
        version: 4,
        sha256: FIXTURE_SHA_V4,
        proposalId: 'proposal-0002'
      }
    })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Routine analysis batch' }))
    const row = taskRow('Routine analysis batch')
    fireEvent.change(within(row).getByLabelText('Model for Routine analysis batch'), {
      target: { value: 'gpt-6-astra' }
    })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
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
          rationale: 'Edited in Settings.',
          evidence: []
        }
      }
    ])
    expect(callsTo('workbench.routingTable.accept')).toEqual([{ proposalId: 'proposal-0002' }])
    expect(screen.getByRole('status').textContent).toBe('Saved.')
    expect(screen.queryByLabelText('Model for Routine analysis batch')).toBeNull()
  })

  it('refuses an alias in place and sends nothing', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult({ proposals: [] }) })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Software engineering' }))
    const row = taskRow('Software engineering')
    const model = within(row).getByLabelText('Model for Software engineering')
    fireEvent.change(model, { target: { value: 'opus' } })
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
    })

    expect(within(row).getByRole('alert').textContent).toMatch(/exact model ID/i)
    expect(model.getAttribute('aria-invalid')).toBe('true')
    expect(callsTo('workbench.routingTable.import')).toHaveLength(0)
  })

  it('closes an unchanged edit without sending anything', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult({ proposals: [] }) })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Primary' }))
    await act(async () => {
      fireEvent.click(within(taskRow('Primary')).getByRole('button', { name: 'Save' }))
    })

    expect(screen.queryByLabelText('Primary model')).toBeNull()
    expect(callsTo('workbench.routingTable.import')).toHaveLength(0)
  })

  it('requires a new model when switching the primary CLI and saves through a versioned proposal', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({ proposals: [] }),
      'workbench.routingTable.import': {
        ok: true,
        version: null,
        sha256: null,
        proposalId: 'proposal-0002'
      },
      'workbench.routingTable.accept': {
        ok: true,
        version: 4,
        sha256: FIXTURE_SHA_V4,
        proposalId: 'proposal-0002'
      }
    })
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Primary' }))
    const row = taskRow('Primary')
    fireEvent.click(within(row).getByRole('combobox', { name: 'Primary CLI' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Claude Code',
      'Codex'
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }))
    const model = within(row).getByLabelText('Primary model')
    expect(model).toHaveProperty('value', '')
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(within(row).getByRole('alert').textContent).toContain('selected CLI')
    expect(callsTo('workbench.routingTable.import')).toHaveLength(0)
    fireEvent.change(model, { target: { value: 'gpt-6-astra' } })
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(callsTo('workbench.routingTable.import')).toEqual([
      {
        proposal: expect.objectContaining({
          base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
          coordinator: { agent: 'codex', model: 'gpt-6-astra', reasoning_level: 'max' },
          changes: []
        })
      }
    ])
    expect(callsTo('workbench.routingTable.accept')).toEqual([{ proposalId: 'proposal-0002' }])
  })

  it('shows the saved primary CLI and its model', () => {
    render(
      <RoutingTableTaskList
        table={fixtureTable({
          coordinator: { agent: 'codex', model: 'gpt-6-astra', reasoning_level: 'high' }
        })}
        availability={null}
        busy={false}
        onSave={vi.fn().mockResolvedValue(true)}
      />
    )
    expect(taskRow('Primary').textContent).toContain('Codex · gpt-6-astra · High')
  })

  it('imports a pasted change set and names a waiting duplicate without its id', async () => {
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
    openAdvanced()

    fireEvent.click(screen.getByRole('button', { name: 'Import…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Change set (JSON)'), {
      target: { value: JSON.stringify({ changes: [fixtureProposal().changes[0]] }) }
    })
    fireEvent.change(within(dialog).getByLabelText('Reason for the change'), {
      target: { value: 'Imported.' }
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))
    })

    expect(callsTo('workbench.routingTable.import')).toHaveLength(1)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/already waiting/)
    expect(alert.textContent).not.toContain('proposal-0001')
    expect(await copiedDetails()).toContain('existing_proposal: proposal-0001')
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
    openAdvanced()

    fireEvent.click(screen.getByRole('button', { name: 'Revert to version 2' }))
    const dialog = await screen.findByRole('dialog')
    expect(callsTo('workbench.routingTable.revert')).toHaveLength(0)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Revert' }))
    })

    expect(callsTo('workbench.routingTable.revert')).toEqual([{ version: 2 }])
    expect(screen.getByRole('status').textContent).toMatch(/Version 4 is now active/)
  })

  it('cannot accept a stale suggestion and says why', async () => {
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
    openAdvanced()

    const proposal = pendingProposal()
    expect(within(proposal).getByRole('button', { name: 'Accept' })).toHaveProperty(
      'disabled',
      true
    )
    expect(within(proposal).getByText(/based on version 2/i)).toBeTruthy()
  })

  it('shows a damaged store as blocked in plain words and never draws a default table', async () => {
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
    const blocked = screen.getByRole('group', { name: 'Routing is blocked' })
    expect(blocked.textContent).toMatch(/could not be read/)
    expect(blocked.textContent).not.toMatch(/hash|index/)
    expect(screen.queryByRole('list', { name: 'Agent for each task' })).toBeNull()
    expect(await copiedDetails()).toContain('detail: version_hash_mismatch')
    openAdvanced()
    expect(screen.getByText(/could not be read: 1/)).toBeTruthy()
  })

  it('says task routing is not available when this build has no such method', async () => {
    rpc.mockRejectedValue(
      new RuntimeRpcCallError({
        id: 'rpc-1',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method' }
      })
    )
    await renderCard()

    expect(screen.getByText('Unavailable')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/not available in this build/i)
    )
    expect(screen.queryByRole('list', { name: 'Agent for each task' })).toBeNull()
  })
})

describe('routing edits under concurrent changes and failed activation', () => {
  afterEach(() => {
    cleanup()
    rpc.mockReset()
  })
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
