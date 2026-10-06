// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deferred,
  listResult,
  publishScope,
  request,
  resetQueueFixture,
  rpc,
  storeState,
  uuid
} from './workbench-request-test-fixture'
import { runView } from './workbench-run-test-fixture'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import WorkbenchRequestQueue from './WorkbenchRequestQueue'

beforeEach(resetQueueFixture)
afterEach(cleanup)

async function openQueue(): Promise<void> {
  render(<WorkbenchRequestQueue />)
  await screen.findByText('Request intake available')
}

describe('WorkbenchRequestQueue', () => {
  it('opens passively, displays real records and says that a request starts a run', async () => {
    rpc.mockResolvedValue(listResult([request()]))
    await openQueue()
    expect(rpc).toHaveBeenCalledExactlyOnceWith({ kind: 'local' }, 'workbench.requests.list', {
      workspaceId: 'local-workspace',
      limit: 50
    })
    expect(uuid).not.toHaveBeenCalled()
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('request-1')).toBeDefined()
    expect(within(row).getByText('Launch blocked')).toBeDefined()
    expect(within(row).getByText('Run').nextElementSibling?.textContent).toBe('No run')
    expect(
      screen.getByText(
        'Each registered request starts a run with one Claude Code session in this workspace.'
      )
    ).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Execution blocked' })).toBeNull()
    expect(screen.queryByText(/Routing|Routed|Retry/)).toBeNull()
  })

  it('shows a blocked request as a labelled warning callout with an icon and compact metadata', async () => {
    rpc.mockResolvedValue(listResult([request(4)]))
    await openQueue()
    const row = screen.getByRole('listitem')
    const callout = within(row).getByRole('group', { name: 'Launch blocker' })
    expect(within(callout).getByText('The run could not be started.')).toBeDefined()
    expect(within(callout).getByText('launch_blocked / launch_refused')).toBeDefined()
    expect(callout.querySelector('svg.lucide-triangle-alert')?.getAttribute('aria-hidden')).toBe(
      'true'
    )
    // Why: the warning hue is under 4.5:1 on its own tint, so it marks only the icon and border.
    expect([...callout.classList]).toEqual(
      expect.arrayContaining([
        'border-status-warning-border',
        'bg-status-warning-background',
        'text-foreground'
      ])
    )
    expect(callout.classList).not.toContain('text-status-warning')
    expect(within(row).getByText('#4')).toBeDefined()
    expect(within(row).getByText('Revision').nextElementSibling?.textContent).toBe('3')
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-03T12:00:00.000Z')
    expect(row.textContent).not.toContain('2026-10-03T12:00:00.000Z')
  })

  it('keeps registration as the only primary action and every other action secondary', async () => {
    rpc.mockResolvedValueOnce(listResult([request(2), request(1, 'local-workspace', 'ROUTING')], 1))
    await openQueue()
    const primary = screen
      .getAllByRole('button')
      .filter((button) => button.dataset.variant === 'default')
    expect(primary.map((button) => button.textContent)).toEqual(['Register request'])
    for (const name of [
      'Refresh',
      'Load older',
      'Cancel request request-2',
      'Cancel request request-1'
    ]) {
      expect(['outline', 'ghost']).toContain(screen.getByRole('button', { name }).dataset.variant)
    }
  })

  it('does not query or expose registration for remote, missing or unresolved owners', () => {
    storeState.activeWorkspaceExecutionHostId = 'runtime:remote'
    const { rerender } = render(<WorkbenchRequestQueue />)
    expect(screen.getByText('Request intake is unavailable for remote workspaces.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Register request' })).toBeNull()
    storeState.activeWorkspaceExecutionHostId = null
    rerender(<WorkbenchRequestQueue />)
    expect(
      screen.getByText('Select a known local workspace to register or list requests.')
    ).toBeDefined()
    storeState.activeWorkspaceKey = null
    storeState.activeWorktreeId = null
    rerender(<WorkbenchRequestQueue />)
    expect(rpc).not.toHaveBeenCalled()
    expect(uuid).not.toHaveBeenCalled()
  })

  it('uses the canonical folder scope instead of a stale active worktree', async () => {
    storeState.activeWorkspaceKey = 'folder:notes'
    storeState.folderWorkspaces = [{ id: 'notes', executionHostId: 'local' }]
    await openQueue()
    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.requests.list', {
      workspaceId: 'folder:notes',
      limit: 50
    })
  })

  it('requires valid capability evidence before enabling intake', async () => {
    rpc.mockResolvedValue({
      ...listResult(),
      capabilities: { submit: true, cancelPending: true, dispatch: true }
    })
    render(<WorkbenchRequestQueue />)
    await screen.findByText('invalid_response')
    expect(screen.getByText('Request intake not verified')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Register request' }).hasAttribute('disabled')).toBe(
      true
    )
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(true)
  })

  it('preserves the original objective and retry UUID after an ambiguous submit failure', async () => {
    await openQueue()
    const objective = '  Inspect this\nwithout rewriting  '
    const result = deferred()
    rpc.mockReturnValueOnce(result.promise)
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: objective } })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.submit', {
      workspaceId: 'local-workspace',
      objective,
      idempotencyKey: '3a642de6-28cc-41b7-bc05-8fa216d92977'
    })
    await act(async () => result.reject(new Error('Connection lost after registration')))
    expect(screen.getByRole('alert').textContent).toContain('Connection lost after registration')
    expect(screen.getByLabelText('Objective').getAttribute('disabled')).toBeNull()
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', objective),
      duplicate: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    await screen.findByText('request-2')
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[2]?.[2]).toEqual(rpc.mock.calls[1]?.[2])
    expect(screen.getByLabelText('Objective')).toHaveProperty('value', '')
  })

  it('generates a fresh UUID after an edited payload instead of reusing a failed identity', async () => {
    await openQueue()
    rpc.mockRejectedValueOnce(new Error('Ambiguous response'))
    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Original objective' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    await screen.findByText('Ambiguous response')
    uuid.mockReturnValueOnce('9a294399-6bc4-49c8-b55e-05a5a09a687b')
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', 'Edited objective'),
      duplicate: false
    })
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Edited objective' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    await screen.findByText('request-2')
    expect(uuid).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.submit', {
      workspaceId: 'local-workspace',
      objective: 'Edited objective',
      idempotencyKey: '9a294399-6bc4-49c8-b55e-05a5a09a687b'
    })
  })

  it('reads the current revision before cancelling and keeps the server receipt', async () => {
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'ROUTING')]))
    await openQueue()
    const launched = { ...request(1, 'local-workspace', 'ROUTED', undefined, 'run-1'), revision: 5 }
    rpc.mockResolvedValueOnce(listResult([launched]))
    rpc.mockResolvedValueOnce({
      request: { ...request(1, 'local-workspace', 'CANCELED', undefined, 'run-1'), revision: 6 },
      changed: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    await screen.findByText('Canceled')
    expect(rpc.mock.calls.map((call) => call[1])).toEqual([
      'workbench.requests.list',
      'workbench.requests.list',
      'workbench.requests.cancel'
    ])
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.cancel', {
      workspaceId: 'local-workspace',
      requestId: 'request-1',
      expectedRevision: 5
    })
    expect(screen.queryByRole('button', { name: 'Cancel request request-1' })).toBeNull()
  })

  it('does not cancel when the fresh record is no longer cancellable', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'CANCELED')]))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    await screen.findByText('Canceled')
    expect(rpc.mock.calls.map((call) => call[1])).not.toContain('workbench.requests.cancel')
  })

  it('offers cancellation before and after the launch, with run wording', async () => {
    rpc.mockResolvedValueOnce(
      listResult([
        request(2, 'local-workspace', 'ROUTED', undefined, 'run-2'),
        request(1, 'local-workspace', 'ROUTING')
      ])
    )
    await openQueue()
    expect(screen.getByText('Starting')).toBeDefined()
    expect(screen.getByText('Run started')).toBeDefined()
    expect(screen.getByText('run-2')).toBeDefined()
    expect(screen.queryByRole('group', { name: 'Launch blocker' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel request request-2' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /Stop run/ })).toBeNull()
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'ROUTING')]))
    rpc.mockResolvedValueOnce({ request: request(1, 'local-workspace', 'CANCELED'), changed: true })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    await screen.findByText('Canceled')
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.cancel', {
      workspaceId: 'local-workspace',
      requestId: 'request-1',
      expectedRevision: 3
    })
  })

  it('shows the run of each request and stops the run of a blocked request', async () => {
    const stop = vi.fn(async () => undefined)
    const runs = {
      findRun: (runId: string | null) =>
        runId === 'run-5' ? runView(5, { status: 'unverifiable' }) : null,
      stop,
      refresh: vi.fn(async () => undefined),
      stopCount: 0
    }
    rpc.mockResolvedValue(
      listResult([request(5, 'local-workspace', 'ROUTING_BLOCKED', undefined, 'run-5')])
    )
    const { rerender } = render(<WorkbenchRequestQueue runs={runs} />)
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('run-5')).toBeDefined()
    expect(within(row).getByText('Cannot be verified')).toBeDefined()
    fireEvent.click(within(row).getByRole('button', { name: 'Stop run run-5' }))
    expect(stop).toHaveBeenCalledExactlyOnceWith('run-5')
    expect(within(row).getByRole('button', { name: 'Cancel request request-5' })).toBeDefined()
    rerender(<WorkbenchRequestQueue runs={{ ...runs, stopCount: 1 }} />)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.list', {
      workspaceId: 'local-workspace',
      limit: 50
    })
  })

  it('re-reads after a run stop that lands while another queue operation is running', async () => {
    const runs = {
      findRun: () => null,
      stop: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      stopCount: 0
    }
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'ROUTING')]))
    const { rerender } = render(<WorkbenchRequestQueue runs={runs} />)
    await screen.findByRole('listitem')
    const freshRead = deferred()
    rpc.mockImplementationOnce(() => freshRead.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    rerender(<WorkbenchRequestQueue runs={{ ...runs, stopCount: 1 }} />)
    rpc.mockResolvedValue(listResult([request(1, 'local-workspace', 'CANCELED')]))
    await act(async () => {
      freshRead.resolve(listResult([request(1, 'local-workspace', 'CANCELED')]))
    })
    const lists = () => rpc.mock.calls.filter((call) => call[1] === 'workbench.requests.list')
    await waitFor(() => expect(lists()).toHaveLength(3))
    expect(rpc.mock.calls.map((call) => call[1])).not.toContain('workbench.requests.cancel')
  })

  it('preserves rows and typed permission errors when cancellation fails', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request()]))
    rpc.mockRejectedValueOnce(
      new RuntimeRpcCallError({
        id: 'call',
        ok: false,
        error: { code: 'forbidden', message: 'Desktop permission is required' }
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    await screen.findByText('forbidden')
    expect(screen.getByText('Desktop permission is required')).toBeDefined()
    expect(screen.getByText('Launch blocked')).toBeDefined()
    expect(screen.getByText('Displayed requests may be out of date.')).toBeDefined()
  })

  it('loads bounded older pages and returns to latest only on explicit refresh', async () => {
    rpc.mockResolvedValueOnce(listResult([request(10)], 10))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request(9)], 9))
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    await screen.findByText('request-9')
    expect(screen.queryByText('request-10')).toBeNull()
    expect(
      screen.getByText('Showing an older page. Refresh returns to the latest requests.')
    ).toBeDefined()
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.list', {
      workspaceId: 'local-workspace',
      limit: 50,
      beforeSequence: 10
    })
    rpc.mockResolvedValueOnce(listResult([request(11)]))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('request-11')
    expect(screen.queryByText('request-9')).toBeNull()
    expect(
      screen.queryByText('Showing an older page. Refresh returns to the latest requests.')
    ).toBeNull()
  })

  it('ignores a late listing after a scope switch and never replays registration', async () => {
    const oldList = deferred()
    rpc.mockReturnValueOnce(oldList.promise)
    render(<WorkbenchRequestQueue />)
    storeState.activeWorkspaceKey = 'worktree:new-workspace'
    storeState.activeWorktreeId = 'new-workspace'
    rpc.mockResolvedValueOnce(listResult([request(2, 'new-workspace')]))
    act(publishScope)
    await screen.findByText('request-2')
    await act(async () => oldList.resolve(listResult([request(1)])))
    expect(screen.queryByText('request-1')).toBeNull()
    expect(rpc.mock.calls.every((call) => call[1] === 'workbench.requests.list')).toBe(true)
    expect(uuid).not.toHaveBeenCalled()
  })

  it('drops a late registration receipt and draft after switching away and back', async () => {
    await openQueue()
    const pending = deferred()
    rpc.mockReturnValueOnce(pending.promise)
    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Old scope objective' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    storeState.activeWorkspaceKey = 'worktree:other'
    storeState.activeWorktreeId = 'other'
    act(publishScope)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3))
    storeState.activeWorkspaceKey = 'worktree:local-workspace'
    storeState.activeWorktreeId = 'local-workspace'
    act(publishScope)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(4))
    await act(async () =>
      pending.resolve({
        request: request(99, 'local-workspace', 'ROUTING_BLOCKED', 'Old scope objective'),
        duplicate: false
      })
    )
    expect(screen.queryByText('request-99')).toBeNull()
    expect(screen.getByLabelText('Objective')).toHaveProperty('value', '')
  })
})
