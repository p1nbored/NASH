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
  fixtureEdit,
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

  it('shows direct route editing without Advanced, import, history or suggested-change controls', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()
    expect(screen.queryByRole('button', { name: 'Advanced' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Reviewer 1' })).toBeTruthy()
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
    expect(taskRow('Configured project workflow').textContent).toContain('Same as coordinator')
    expect(taskRow('Fast writing or alternative draft').textContent).toContain('when supported')
    expect(taskRow('Coordinator').textContent).toContain('Claude Code')
    expect(screen.queryByRole('listitem', { name: 'Coordinator reasoning' })).toBeNull()
    const reviewers = screen.getByRole('list', { name: 'Reviewers' })
    expect(
      within(reviewers)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual([expect.stringContaining('gpt-6.1-sol'), expect.stringContaining('claude-opus-5-5')])
  })

  it('saves an edit made in place as the user change and puts it into use', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.save': { ok: true, version: 4, sha256: FIXTURE_SHA_V4 }
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

    expect(callsTo('workbench.routingTable.save')).toEqual([
      {
        base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
        changes: [
          {
            task_type: 'routine_analysis_batch',
            execution_target: 'codex_cli',
            model: 'gpt-6-astra',
            reasoning_level: 'high',
            reasoning_requirement: 'required'
          }
        ]
      }
    ])
    expect(screen.getByRole('status').textContent).toBe('Saved.')
    expect(screen.queryByLabelText('Model for Routine analysis batch')).toBeNull()
  })

  it('refuses an alias in place and sends nothing', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
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
    expect(callsTo('workbench.routingTable.save')).toHaveLength(0)
  })

  it('activates a reviewer edit through the same versioned save flow as task routes', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.save': { ok: true, version: 4, sha256: FIXTURE_SHA_V4 }
    })
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Reviewer 1' }))
    fireEvent.change(screen.getByLabelText('Model for Reviewer 1'), {
      target: { value: 'gpt-6-astra' }
    })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })))
    expect(callsTo('workbench.routingTable.save')).toEqual([
      expect.objectContaining({
        base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
        changes: [],
        validation: {
          reviewers: [
            { target: 'codex_cli', model: 'gpt-6-astra', reasoning_level: 'high' },
            { target: 'claude_headless', model: 'claude-opus-5-5', reasoning_level: 'high' }
          ]
        }
      })
    ])
    expect(screen.getByRole('status').textContent).toBe('Saved.')
  })

  it('closes an unchanged edit without sending anything', async () => {
    answer({ 'workbench.routingTable.list': fixtureListResult() })
    await renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    await act(async () => {
      fireEvent.click(within(taskRow('Coordinator')).getByRole('button', { name: 'Save' }))
    })

    expect(screen.queryByLabelText('Coordinator model')).toBeNull()
    expect(callsTo('workbench.routingTable.save')).toHaveLength(0)
  })

  it('requires a new model when switching the primary CLI and saves through a versioned save', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult(),
      'workbench.routingTable.save': { ok: true, version: 4, sha256: FIXTURE_SHA_V4 }
    })
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Coordinator' }))
    const row = taskRow('Coordinator')
    fireEvent.click(within(row).getByRole('combobox', { name: 'Coordinator CLI' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Claude Code',
      'Codex'
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }))
    const model = within(row).getByLabelText('Coordinator model')
    expect(model).toHaveProperty('value', '')
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(within(row).getByRole('alert').textContent).toContain('selected CLI')
    expect(callsTo('workbench.routingTable.save')).toHaveLength(0)
    fireEvent.change(model, { target: { value: 'gpt-6-astra' } })
    await act(async () => fireEvent.click(within(row).getByRole('button', { name: 'Save' })))
    expect(callsTo('workbench.routingTable.save')).toEqual([
      expect.objectContaining({
        base: { table_version: 3, sha256: FIXTURE_SHA_V3 },
        coordinator: { agent: 'codex', model: 'gpt-6-astra', reasoning_level: 'max' },
        changes: []
      })
    ])
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
    expect(taskRow('Coordinator').textContent).toContain('Codex · gpt-6-astra · High')
  })

  it('shows a damaged store as blocked in plain words and never draws a default table', async () => {
    answer({
      'workbench.routingTable.list': fixtureListResult({
        active: {
          ok: false,
          reason: 'routing_table_integrity_failed',
          detail: 'version_hash_mismatch'
        }
      })
    })
    await renderCard()

    expect(screen.getByText('Blocked')).toBeTruthy()
    const blocked = screen.getByRole('group', { name: 'Routing is blocked' })
    expect(blocked.textContent).toMatch(/could not be read/)
    expect(blocked.textContent).not.toMatch(/hash|index/)
    expect(screen.queryByRole('list', { name: 'Agent for each task' })).toBeNull()
    expect(await copiedDetails()).toContain('detail: version_hash_mismatch')
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
  it.each(['refused', 'disconnected'])('reports an inline save that is %s', async (mode) => {
    rpc.mockImplementation(async (_target: unknown, method: string) => {
      if (method === 'workbench.routingTable.list') {
        return fixtureListResult()
      }
      if (mode === 'disconnected') {
        throw new Error('connection lost')
      }
      return { ok: false, reason: 'base_not_active', detail: null }
    })
    const { result } = renderHook(() => useRoutingTable())
    await act(async () => {})
    await act(async () => expect(await result.current.applyEdit(fixtureEdit())).toBe(false))
    expect(result.current.notice?.kind).toBe('error')
    expect(callsTo('workbench.routingTable.save')).toHaveLength(1)
  })

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
