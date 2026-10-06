// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deferred,
  listResult,
  lookup,
  publishScope,
  request,
  resetQueueFixture,
  rpc,
  storeState,
  uuid
} from './workbench-request-test-fixture'
import WorkbenchRequestQueue from './WorkbenchRequestQueue'

beforeEach(resetQueueFixture)
afterEach(cleanup)

async function openQueue(): Promise<void> {
  render(<WorkbenchRequestQueue />)
  await screen.findByText('Request intake available')
}

describe('Workbench request response and scope guards', () => {
  it('does not mistake an active local host stamp for a known catalog workspace', () => {
    lookup.mockReturnValue(undefined)
    render(<WorkbenchRequestQueue />)
    expect(
      screen.getByText('Select a known local workspace to register or list requests.')
    ).toBeDefined()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('blocks remote folder intake even when the stale active worktree has a local host', () => {
    storeState.activeWorkspaceKey = 'folder:notes'
    storeState.folderWorkspaces = [{ id: 'notes', executionHostId: 'runtime:remote' }]
    render(<WorkbenchRequestQueue />)
    expect(screen.getByText('Request intake is unavailable for remote workspaces.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('renders request IDs with separator-only wrapping and exact copied text', async () => {
    const requestId = 'fixture:2026/10/request-7'
    rpc.mockResolvedValueOnce(listResult([{ ...request(7), requestId }]))
    await openQueue()
    const identifier = screen.getByText(requestId)
    expect(identifier.querySelectorAll('wbr')).toHaveLength(3)
    expect(identifier.textContent).toBe(requestId)
    expect(document.querySelector('.break-all')).toBeNull()
    expect(screen.getByRole('button', { name: `Cancel request ${requestId}` })).toBeDefined()
  })

  it('leads with the queue and its states, then the demoted intake form', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    const note = screen.getByText(
      'Each registered request starts a run with one Claude Code session in this workspace.'
    )
    const list = screen.getByRole('list')
    const objective = screen.getByLabelText('Objective')
    expect(note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.compareDocumentPosition(objective) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('rechecks canonical scope before a submit event even before React is notified', async () => {
    await openQueue()
    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Old workspace objective' }
    })
    storeState.activeWorkspaceKey = 'worktree:elsewhere'
    storeState.activeWorktreeId = 'elsewhere'
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(uuid).not.toHaveBeenCalled()
  })

  it('rechecks canonical scope before a cancellation event', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    storeState.activeWorkspaceExecutionHostId = 'ssh:remote'
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-workspace records rather than displaying or enabling their cancellation', async () => {
    rpc.mockResolvedValueOnce(listResult([request(7, 'wrong-workspace')]))
    render(<WorkbenchRequestQueue />)
    await screen.findByText('invalid_response')
    expect(screen.queryByText('request-7')).toBeNull()
    expect(screen.queryByText('Request intake available')).toBeNull()
    expect(screen.getByRole('button', { name: 'Register request' }).hasAttribute('disabled')).toBe(
      true
    )
  })

  it('keeps the original page and error when refresh fails', async () => {
    rpc.mockResolvedValueOnce(listResult([request(5)]))
    await openQueue()
    rpc.mockRejectedValueOnce(new Error('Request store is offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Request store is offline')
    const failure = screen.getByRole('alert', { name: 'Request store error' })
    expect(failure.querySelector('svg.lucide-triangle-alert')).not.toBeNull()
    expect(screen.getByText('request-5')).toBeDefined()
    expect(screen.getByText('Displayed requests may be out of date.')).toBeDefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('rejects a nondecreasing older-page boundary and preserves existing rows', async () => {
    rpc.mockResolvedValueOnce(listResult([request(10)], 10))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request(11)], 11))
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    await screen.findByText('invalid_response')
    expect(screen.getByText('request-10')).toBeDefined()
    expect(screen.queryByText('request-11')).toBeNull()
  })

  it.each([
    { label: 'duplicate sequences', page: listResult([request(2), request(2)]) },
    {
      label: 'duplicate request IDs',
      page: listResult([request(2), { ...request(1), requestId: 'request-2' }])
    },
    { label: 'ascending sequences', page: listResult([request(1), request(2)]) },
    {
      label: 'cursor beyond the last included sequence',
      page: listResult([request(2), request(1)], 2)
    },
    { label: 'cursor without a record', page: listResult([], 1) }
  ])('rejects $label', async ({ page }) => {
    rpc.mockResolvedValueOnce(page)
    render(<WorkbenchRequestQueue />)
    await screen.findByText('invalid_response')
    expect(screen.queryByText('Request intake available')).toBeNull()
  })

  it('fences pending responses and clears rows when the same workspace ID is remapped', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    const pending = deferred()
    rpc.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    lookup.mockImplementation((id: string, hostId?: string) => ({
      id,
      displayName: id,
      path: '/remapped',
      hostId,
      repoId: 'new-repo',
      projectId: 'new-project'
    }))
    act(publishScope)
    expect(screen.queryByText('request-1')).toBeNull()
    await screen.findByText('No registered requests on this page.')
    await act(async () =>
      pending.resolve({ request: request(1, 'local-workspace', 'CANCELED'), changed: true })
    )
    expect(screen.queryByText('Canceled')).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('does not accept a cancellation receipt for a different request', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request()]))
    rpc.mockResolvedValueOnce({ request: request(2, 'local-workspace', 'CANCELED'), changed: true })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    await screen.findByText('invalid_response')
    expect(screen.getByText('Launch blocked')).toBeDefined()
    expect(screen.queryByText('request-2')).toBeNull()
  })

  it('does not accept a fresh record that rewrote the request before cancelling', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    rpc.mockResolvedValueOnce(
      listResult([request(1, 'local-workspace', 'ROUTING_BLOCKED', 'Rewritten objective')])
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    await screen.findByText('invalid_response')
    expect(rpc.mock.calls.map((call) => call[1])).not.toContain('workbench.requests.cancel')
    expect(screen.getByText('Inspect the request store')).toBeDefined()
  })

  it('rejects a rewritten objective receipt while retaining the original retry payload', async () => {
    await openQueue()
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', 'Rewritten text'),
      duplicate: false
    })
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Original text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    await screen.findByText('invalid_response')
    expect(screen.getByLabelText('Objective')).toHaveProperty('value', 'Original text')
    expect(screen.queryByText('request-2')).toBeNull()
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', 'Original text'),
      duplicate: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register request' }))
    await screen.findByText('request-2')
    expect(uuid).toHaveBeenCalledTimes(1)
  })

  it('never exposes cancellation for canceled records or registers blank objectives', async () => {
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'CANCELED')]))
    await openQueue()
    expect(screen.queryByRole('button', { name: 'Cancel request request-1' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: ' \n ' } })
    expect(screen.getByRole('button', { name: 'Register request' }).hasAttribute('disabled')).toBe(
      true
    )
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('clears previous records on switching remote and ignores a late cancellation', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    const result = deferred()
    rpc.mockReturnValueOnce(result.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request request-1' }))
    storeState.activeWorkspaceExecutionHostId = 'runtime:other-host'
    act(publishScope)
    expect(screen.queryByText('request-1')).toBeNull()
    await act(async () => result.resolve(listResult([request(1, 'local-workspace', 'CANCELED')])))
    expect(screen.queryByText('Canceled')).toBeNull()
    expect(screen.getByText('Request intake is unavailable for remote workspaces.')).toBeDefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('ignores late failures after unmount without launching a retry', async () => {
    const result = deferred()
    rpc.mockReturnValueOnce(result.promise)
    const { unmount } = render(<WorkbenchRequestQueue />)
    unmount()
    await act(async () => result.reject(new Error('Late failure')))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(uuid).not.toHaveBeenCalled()
  })
})
