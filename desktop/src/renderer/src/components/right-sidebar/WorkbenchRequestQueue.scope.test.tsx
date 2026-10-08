// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deferred,
  listResult,
  lookup,
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
import {
  copyDetailsText,
  installClipboard,
  removeClipboard,
  type ClipboardWrite
} from './workbench-clipboard-test-fixture'
import WorkbenchRequestQueue from './WorkbenchRequestQueue'

const UNEXPECTED = 'The app returned an unexpected response.'
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

function startRun(): HTMLElement {
  return screen.getByRole('button', { name: 'Start run' })
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

  it('keeps a request ID out of the row and copies it exactly', async () => {
    const requestId = 'fixture:2026/10/request-7'
    rpc.mockResolvedValueOnce(listResult([{ ...request(7), requestId }]))
    await openQueue()
    const row = requestRow(requestObjective(7))
    expect(row.textContent).not.toContain(requestId)
    expect(document.querySelector('.break-all')).toBeNull()
    expect(await copyDetailsText(row, clipboard)).toContain(`request_id: ${requestId}`)
    expect(cancelButton(7)).toBeDefined()
  })

  it('leads with the queue and its states, then the demoted intake form', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    const list = screen.getByRole('list')
    const objective = screen.getByLabelText('Objective')
    const help = screen.getByText('Starts a run with a Claude Code session in this workspace.')
    expect(list.compareDocumentPosition(objective) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(objective.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('rechecks canonical scope before a submit event even before React is notified', async () => {
    await openQueue()
    fireEvent.change(screen.getByLabelText('Objective'), {
      target: { value: 'Old workspace objective' }
    })
    storeState.activeWorkspaceKey = 'worktree:elsewhere'
    storeState.activeWorktreeId = 'elsewhere'
    fireEvent.click(startRun())
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(uuid).not.toHaveBeenCalled()
  })

  it('rechecks canonical scope before a cancellation event', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    storeState.activeWorkspaceExecutionHostId = 'ssh:remote'
    fireEvent.click(cancelButton(1))
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-workspace records rather than displaying or enabling their cancellation', async () => {
    rpc.mockResolvedValueOnce(listResult([request(7, 'wrong-workspace')]))
    render(<WorkbenchRequestQueue />)
    await screen.findByText(UNEXPECTED)
    expect(screen.queryByText(requestObjective(7))).toBeNull()
    expect(startRun().hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(true)
  })

  it('keeps the original page and words the error when refresh fails', async () => {
    rpc.mockResolvedValueOnce(listResult([request(5)]))
    await openQueue()
    rpc.mockRejectedValueOnce(new Error('Request store is offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    const failure = await screen.findByRole('alert', { name: 'Requests could not be updated' })
    expect(failure.querySelector('svg.lucide-circle-alert')).not.toBeNull()
    expect(failure.textContent).toContain('Something went wrong.')
    expect(failure.textContent).not.toContain('Request store is offline')
    expect(await copyDetailsText(failure, clipboard)).toContain(
      'error_message: Request store is offline'
    )
    expect(screen.getByText(requestObjective(5))).toBeDefined()
    expect(screen.getByText('Displayed requests may be out of date.')).toBeDefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('rejects a nondecreasing older-page boundary and preserves existing rows', async () => {
    rpc.mockResolvedValueOnce(listResult([request(10)], 10))
    await openQueue()
    rpc.mockResolvedValueOnce(listResult([request(11)], 11))
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }))
    await screen.findByText(UNEXPECTED)
    expect(screen.getByText(requestObjective(10))).toBeDefined()
    expect(screen.queryByText(requestObjective(11))).toBeNull()
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
    await screen.findByText(UNEXPECTED)
    expect(screen.getByLabelText('Objective').hasAttribute('disabled')).toBe(true)
  })

  it('fences pending responses and clears rows when the same workspace ID is remapped', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    const pending = deferred()
    rpc.mockReturnValueOnce(pending.promise)
    fireEvent.click(cancelButton(1))
    lookup.mockImplementation((id: string, hostId?: string) => ({
      id,
      displayName: id,
      path: '/remapped',
      hostId,
      repoId: 'new-repo',
      projectId: 'new-project'
    }))
    act(publishScope)
    expect(screen.queryByText(requestObjective(1))).toBeNull()
    await screen.findByText('No requests yet.')
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
    fireEvent.click(cancelButton(1))
    await screen.findByText(UNEXPECTED)
    expect(screen.getByText('Launch blocked')).toBeDefined()
    expect(screen.queryByText(requestObjective(2))).toBeNull()
  })

  it('does not accept a fresh record that rewrote the request before cancelling', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    rpc.mockResolvedValueOnce(
      listResult([request(1, 'local-workspace', 'ROUTING_BLOCKED', 'Rewritten objective')])
    )
    fireEvent.click(cancelButton(1))
    await screen.findByText(UNEXPECTED)
    expect(rpc.mock.calls.map((call) => call[1])).not.toContain('workbench.requests.cancel')
    expect(screen.getByText(requestObjective(1))).toBeDefined()
  })

  it('rejects a rewritten objective receipt while retaining the original retry payload', async () => {
    await openQueue()
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', 'Rewritten text'),
      duplicate: false
    })
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Original text' } })
    fireEvent.click(startRun())
    await screen.findByText(UNEXPECTED)
    expect(screen.getByLabelText('Objective')).toHaveProperty('value', 'Original text')
    expect(screen.queryByText('Rewritten text')).toBeNull()
    rpc.mockResolvedValueOnce({
      request: request(2, 'local-workspace', 'ROUTING_BLOCKED', 'Original text'),
      duplicate: true
    })
    fireEvent.click(startRun())
    await screen.findByText('Request registered.')
    expect(requestRow('Original text')).toBeDefined()
    expect(uuid).toHaveBeenCalledTimes(1)
  })

  it('never exposes cancellation for canceled records or registers blank objectives', async () => {
    rpc.mockResolvedValueOnce(listResult([request(1, 'local-workspace', 'CANCELED')]))
    await openQueue()
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Objective'), { target: { value: ' \n ' } })
    expect(startRun().hasAttribute('disabled')).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('clears previous records on switching remote and ignores a late cancellation', async () => {
    rpc.mockResolvedValueOnce(listResult([request()]))
    await openQueue()
    const result = deferred()
    rpc.mockReturnValueOnce(result.promise)
    fireEvent.click(cancelButton(1))
    storeState.activeWorkspaceExecutionHostId = 'runtime:other-host'
    act(publishScope)
    expect(screen.queryByText(requestObjective(1))).toBeNull()
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
