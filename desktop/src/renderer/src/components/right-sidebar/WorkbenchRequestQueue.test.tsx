// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deferred,
  listResult,
  publishScope,
  request,
  requestObjective,
  requestRow,
  resetQueueFixture,
  rpc,
  storeState,
  uuid,
  waitForIntake
} from './workbench-request-test-fixture'
import { runView } from './workbench-run-test-fixture'
import {
  copyDetailsText,
  installClipboard,
  removeClipboard,
  type ClipboardWrite
} from './workbench-clipboard-test-fixture'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import WorkbenchRequestQueue from './WorkbenchRequestQueue'

let clipboard: ClipboardWrite

beforeEach(() => {
  resetQueueFixture()
  clipboard = installClipboard()
})
afterEach(() => {
  cleanup()
  removeClipboard()
})

async function openQueue(): Promise<void> {
  render(<WorkbenchRequestQueue />)
  await waitForIntake()
}

function cancelButton(sequence: number): HTMLElement {
  return within(requestRow(requestObjective(sequence))).getByRole('button', {
    name: 'Cancel request'
  })
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
    expect(within(row).getByText('Inspect request 1')).toBeDefined()
    expect(within(row).getByText('Launch blocked')).toBeDefined()
    expect(row.textContent).not.toContain('request-1')
    expect(
      screen.getByText('Starts a run with a Claude Code session in this workspace.')
    ).toBeDefined()
    expect(screen.queryByText(/Routing|Routed|Retry|Request intake/)).toBeNull()
  })

  it('shows a blocked request with an icon chip, one sentence and no store internals', async () => {
    rpc.mockResolvedValue(listResult([request(4)]))
    await openQueue()
    const row = screen.getByRole('listitem')
    const chip = within(row).getByText('Launch blocked').closest('[data-kind]')
    expect(chip?.getAttribute('data-kind')).toBe('blocked')
    expect(chip?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(within(row).getByText('The run could not be started.')).toBeDefined()
    for (const hidden of ['launch_blocked', 'launch_refused', '#4', 'Revision', 'request-4']) {
      expect(row.textContent).not.toContain(hidden)
    }
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-03T12:00:00.000Z')
    expect(row.textContent).not.toContain('2026-10-03T12:00:00.000Z')
    const copied = await copyDetailsText(row, clipboard)
    expect(copied.split('\n')).toEqual(
      expect.arrayContaining([
        'NASH Workbench: request',
        'request_id: request-4',
        'sequence: 4',
        'revision: 3',
        'workspace_id: local-workspace',
        'blocker_reason: launch_blocked',
        'blocker_detail: launch_refused'
      ])
    )
  })

  it('keeps starting a run as the only primary action and every other action secondary', async () => {
    rpc.mockResolvedValueOnce(listResult([request(2), request(1, 'local-workspace', 'ROUTING')], 1))
    await openQueue()
    const primary = screen
      .getAllByRole('button')
      .filter((button) => button.dataset.variant === 'default')
    expect(primary.map((button) => button.textContent)).toEqual(['Start run'])
    const secondary = [
      screen.getByRole('button', { name: 'Refresh' }),
      screen.getByRole('button', { name: 'Load older' }),
      ...screen.getAllByRole('button', { name: 'Cancel request' }),
      ...screen.getAllByRole('button', { name: 'Copy details' })
    ]
    for (const button of secondary) {
      expect(['outline', 'ghost']).toContain(button.dataset.variant)
    }
  })

  it('does not query or expose registration for remote, missing or unresolved owners', () => {
    storeState.activeWorkspaceExecutionHostId = 'runtime:remote'
    const { rerender } = render(<WorkbenchRequestQueue />)
    expect(screen.getByText('Request intake is unavailable for remote workspaces.')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Start run' })).toBeNull()
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
    await screen.findByText('The app returned an unexpected response.')
    expect(screen.queryByText('invalid_response')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start run' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(true)
  })

  it('preserves the original objective and retry UUID after an ambiguous submit failure', async () => {
    await openQueue()
    const objective = '  Inspect this\nwithout rewriting  '
    const result = deferred()
    rpc.mockReturnValueOnce(result.promise)
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: objective } })
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(true)
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.submit', {
      workspaceId: 'local-workspace',
      objective,
      idempotencyKey: '3a642de6-28cc-41b7-bc05-8fa216d92977'
    })
    await act(async () => result.reject(new Error('Connection lost after registration')))
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Something went wrong.')
    expect(alert.textContent).not.toContain('Connection lost')
    expect(await copyDetailsText(alert, clipboard)).toContain(
      'error_message: Connection lost after registration'
    )
    expect(screen.getByLabelText('Objective').getAttribute('disabled')).toBeNull()
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', objective),
      duplicate: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
    await screen.findByText('Inspect this without rewriting')
    expect(screen.getByRole('status').textContent).toBe('Request registered.')
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
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
    await screen.findByText('Something went wrong.')
    uuid.mockReturnValueOnce('9a294399-6bc4-49c8-b55e-05a5a09a687b')
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', 'Edited objective'),
      duplicate: false
    })
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Edited objective' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
    await screen.findByText('Edited objective')
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
    fireEvent.click(cancelButton(1))
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
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull()
  })

  it('does not cancel when the fresh record is no longer cancellable', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'CANCELED')]))
    fireEvent.click(cancelButton(1))
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
    expect(requestRow(requestObjective(2)).textContent).not.toContain('run-2')
    expect(screen.queryByText('The run could not be started.')).toBeNull()
    expect(cancelButton(2)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Stop run/ })).toBeNull()
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'ROUTING')]))
    rpc.mockResolvedValueOnce({ request: request(1, 'local-workspace', 'CANCELED'), changed: true })
    fireEvent.click(cancelButton(1))
    await screen.findByText('Canceled')
    expect(rpc).toHaveBeenLastCalledWith({ kind: 'local' }, 'workbench.requests.cancel', {
      workspaceId: 'local-workspace',
      requestId: 'request-1',
      expectedRevision: 3
    })
  })

  it('shows the state of each request run and stops the run of a blocked request', async () => {
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
    expect(row.textContent).not.toContain('run-5')
    const runState = within(row).getByText('Cannot be verified').closest('[data-kind]')
    expect(runState?.getAttribute('data-kind')).toBe('disconnected')
    fireEvent.click(within(row).getByRole('button', { name: 'Stop run' }))
    expect(stop).toHaveBeenCalledExactlyOnceWith('run-5')
    expect(within(row).getByRole('button', { name: 'Cancel request' })).toBeDefined()
    expect(await copyDetailsText(row, clipboard)).toContain('run_id: run-5')
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
    fireEvent.click(cancelButton(1))
    rerender(<WorkbenchRequestQueue runs={{ ...runs, stopCount: 1 }} />)
    rpc.mockResolvedValue(listResult([request(1, 'local-workspace', 'CANCELED')]))
    await act(async () => {
      freshRead.resolve(listResult([request(1, 'local-workspace', 'CANCELED')]))
    })
    const lists = () => rpc.mock.calls.filter((call) => call[1] === 'workbench.requests.list')
    await waitFor(() => expect(lists()).toHaveLength(3))
    expect(rpc.mock.calls.map((call) => call[1])).not.toContain('workbench.requests.cancel')
  })

  it('preserves rows and words a refused cancellation', async () => {
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
    fireEvent.click(cancelButton(1))
    await screen.findByText('This window is not allowed to do that.')
    expect(screen.queryByText('forbidden')).toBeNull()
    expect(screen.queryByText('Desktop permission is required')).toBeNull()
    expect(screen.getByText('Launch blocked')).toBeDefined()
    expect(screen.getByText('Displayed requests may be out of date.')).toBeDefined()
  })

  it('loads bounded older pages and returns to latest only on explicit refresh', async () => {
    rpc.mockResolvedValueOnce(listResult([request(10)], 10))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request(9)], 9))
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    await screen.findByText(requestObjective(9))
    expect(screen.queryByText(requestObjective(10))).toBeNull()
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
    await screen.findByText(requestObjective(11))
    expect(screen.queryByText(requestObjective(9))).toBeNull()
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
    await screen.findByText(requestObjective(2))
    await act(async () => oldList.resolve(listResult([request(1)])))
    expect(screen.queryByText(requestObjective(1))).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }))
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
    expect(screen.queryByText('Old scope objective')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByLabelText('Objective')).toHaveProperty('value', '')
  })
})
