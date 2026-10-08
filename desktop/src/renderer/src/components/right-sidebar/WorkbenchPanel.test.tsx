// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'

const { storeState, lookup, rpc } = vi.hoisted(() => {
  const lookup = vi.fn()
  const storeState: {
    activeWorkspaceKey: string | null
    activeWorktreeId: string | null
    activeWorkspaceExecutionHostId: string | null
    folderWorkspaces: { id: string; executionHostId: string }[]
    worktreesByRepo: Record<string, { id: string; repoId: string; hostId: string }[]>
    getKnownWorktreeById: typeof lookup
  } = {
    activeWorkspaceKey: null,
    activeWorktreeId: null,
    activeWorkspaceExecutionHostId: null,
    folderWorkspaces: [],
    worktreesByRepo: {},
    getKnownWorktreeById: lookup
  }
  return { storeState, lookup, rpc: vi.fn() }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))
vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en-US'
}))

import WorkbenchPanel from './WorkbenchPanel'

const apiAccess = vi.fn(() => {
  throw new Error('Workbench must not access execution or permission APIs')
})

beforeEach(() => {
  storeState.activeWorkspaceKey = null
  storeState.activeWorktreeId = null
  storeState.activeWorkspaceExecutionHostId = null
  storeState.folderWorkspaces = []
  storeState.worktreesByRepo = {}
  lookup.mockReset()
  rpc.mockReset().mockRejectedValue(new Error('Request store unavailable'))
  apiAccess.mockClear()
  Object.defineProperty(window, 'api', { configurable: true, get: apiAccess })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'api')
})

describe('WorkbenchPanel', () => {
  it('shows missing-domain blockers without actions, model guesses or execution side effects', () => {
    const { container, unmount } = render(<WorkbenchPanel />)

    expect(screen.getByText('Select a workspace from the workspace list.')).toBeDefined()
    expect(screen.getByText('Select a known local workspace to see its runs.')).toBeDefined()
    // Why removed (D-038): RSI is not part of the Workbench; its entries live in the left navigation.
    expect(screen.queryByText('Not connected')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'RSI Lab' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Improvements' })).toBeNull()
    expect(screen.queryByText('Not configured')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Managed workflow' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Permission prompts' })).toBeDefined()
    // Why removed (D-016): Clef only classifies; routes live in the Routing Table and each run shows its coordinator.
    expect(screen.queryByRole('heading', { name: 'Routing / model / surface' })).toBeNull()
    expect(container.textContent).not.toContain('Clef routing')
    expect(container.textContent).not.toContain('promotion evidence')
    expect(container.querySelector('button, a, input, form')).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
    unmount()
    expect(apiAccess).not.toHaveBeenCalled()
  })

  // Why: matches settings-typography-hierarchy.test.tsx so section heads outrank 14px labels.
  it('sets every section heading in the display serif one step above field labels', () => {
    render(<WorkbenchPanel />)
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Selected workspace',
      'Permission prompts',
      'Waiting for your decision',
      'Runs',
      'Local requests'
    ])
    for (const heading of headings) {
      expect([...heading.classList]).toEqual(
        expect.arrayContaining(['font-display', 'text-base', 'font-normal'])
      )
      expect(heading.classList).not.toContain('font-semibold')
    }
  })

  it('reads the selected host-qualified workspace and updates when a folder is selected', () => {
    storeState.activeWorktreeId = 'repo::/work/app'
    storeState.activeWorkspaceExecutionHostId = 'ssh:build-host'
    lookup.mockImplementation((id: string, hostId: string) => {
      if (id === 'repo::/work/app' && hostId === 'ssh:build-host') {
        return { displayName: 'Remote app', path: '/work/app', hostId }
      }
      if (id === 'folder:notes' && hostId === 'runtime:notes-host') {
        return { displayName: 'Notes folder', path: '/srv/notes', hostId }
      }
      return undefined
    })

    const { container, rerender } = render(<WorkbenchPanel />)
    expect(lookup).toHaveBeenCalledWith('repo::/work/app', 'ssh:build-host')
    expect(screen.getByText('Remote app')).toBeDefined()
    // Why: the workspace ID and execution host are internal; only "Copy details" carries them.
    expect(container.textContent).not.toContain('repo::/work/app')
    expect(container.textContent).not.toContain('ssh:build-host')
    expect(screen.getByText('/work/app').querySelectorAll('wbr')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeDefined()
    expect(container.querySelector('.break-all')).toBeNull()

    storeState.activeWorkspaceKey = 'folder:notes'
    storeState.folderWorkspaces = [{ id: 'notes', executionHostId: 'runtime:notes-host' }]
    storeState.activeWorkspaceExecutionHostId = 'runtime:notes-host'
    rerender(<WorkbenchPanel />)

    expect(lookup).toHaveBeenLastCalledWith('folder:notes', 'runtime:notes-host')
    expect(screen.getByText('Notes folder')).toBeDefined()
    expect(container.textContent).not.toContain('folder:notes')
    expect(screen.getByText('/srv/notes')).toBeDefined()
    expect(screen.queryByText('Remote app')).toBeNull()
    expect(screen.queryByText('/work/app')).toBeNull()
    expect(apiAccess).not.toHaveBeenCalled()
    // Why: only the local permission relay and decisions are read; remote workspaces list no requests or runs.
    expect(rpc.mock.calls.map((call) => call[1])).toEqual([
      'workbench.permission.list',
      'workbench.validation.listDecisions'
    ])
  })

  it('keeps an unresolved workspace identity for Copy details without inventing a path or host', () => {
    storeState.activeWorktreeId = 'repo::/catalog-missing'
    lookup.mockReturnValue(undefined)

    const { container } = render(<WorkbenchPanel />)

    expect(container.textContent).not.toContain('repo::/catalog-missing')
    expect(screen.getByText('Workspace details are unavailable.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeDefined()
    expect(screen.queryByText('local')).toBeNull()
    expect(lookup).toHaveBeenCalledWith('repo::/catalog-missing', undefined)
    expect(apiAccess).not.toHaveBeenCalled()
  })

  it('uses a catalog-stamped host and attempts only passive local listings', async () => {
    storeState.activeWorktreeId = 'repo::/work/local'
    storeState.worktreesByRepo = {
      repo: [{ id: 'repo::/work/local', repoId: 'repo', hostId: 'local' }]
    }
    lookup.mockReturnValue({ displayName: 'Local app', path: '/work/local', hostId: 'local' })

    render(<WorkbenchPanel />)

    expect(screen.getByText('Local app')).toBeDefined()
    expect(screen.queryByText('local')).toBeNull()
    // Why generic: a raw runtime error is never shown; "Copy details" carries its text.
    expect(await screen.findAllByText('Something went wrong.')).toHaveLength(4)
    expect(screen.queryByText('Request store unavailable')).toBeNull()
    expect(rpc).toHaveBeenCalledTimes(4)
    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.requests.list', {
      workspaceId: 'repo::/work/local',
      limit: 50
    })
    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.runs.list', {
      workspaceId: 'repo::/work/local',
      limit: 50
    })
    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.permission.list', {
      statuses: ['pending'],
      limit: 50
    })
    expect(rpc).toHaveBeenCalledWith({ kind: 'local' }, 'workbench.validation.listDecisions', {
      limit: 50
    })
    expect(apiAccess).not.toHaveBeenCalled()
  })
})
