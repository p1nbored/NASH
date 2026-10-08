// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  copyDetailsText,
  installClipboard,
  removeClipboard,
  type ClipboardWrite
} from './workbench-clipboard-test-fixture'

const { storeState, lookup } = vi.hoisted(() => {
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
  return { lookup, storeState }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback,
  getIntlLocale: () => 'en-US'
}))

import WorkbenchWorkspaceSection from './WorkbenchWorkspaceSection'

let clipboard: ClipboardWrite

beforeEach(() => {
  storeState.activeWorkspaceKey = null
  storeState.activeWorktreeId = null
  storeState.activeWorkspaceExecutionHostId = null
  lookup.mockReset()
  clipboard = installClipboard()
})
afterEach(() => {
  cleanup()
  removeClipboard()
})

describe('WorkbenchWorkspaceSection', () => {
  it('shows only the name and path, and copies the ID, path and host exactly', async () => {
    storeState.activeWorktreeId = 'repo::/work/app'
    storeState.activeWorkspaceExecutionHostId = 'ssh:build-host'
    lookup.mockReturnValue({
      displayName: 'Remote app',
      path: '/work/app',
      hostId: 'ssh:build-host'
    })

    const { container } = render(<WorkbenchWorkspaceSection />)

    expect(screen.getByText('Remote app')).toBeDefined()
    expect(screen.getByText('/work/app')).toBeDefined()
    expect(container.textContent).not.toMatch(/repo::|ssh:build-host|Workspace ID|Execution host/)
    expect((await copyDetailsText(container, clipboard)).split('\n')).toEqual([
      'NASH Workbench: workspace',
      'workspace_id: repo::/work/app',
      'path: /work/app',
      'execution_host: ssh:build-host'
    ])
  })

  it('leaves an unknown path and host out of the details rather than guessing them', async () => {
    storeState.activeWorktreeId = 'repo::/catalog-missing'
    lookup.mockReturnValue(undefined)

    const { container } = render(<WorkbenchWorkspaceSection />)

    expect(screen.getByText('Workspace details are unavailable.')).toBeDefined()
    expect(await copyDetailsText(container, clipboard)).toBe(
      ['NASH Workbench: workspace', 'workspace_id: repo::/catalog-missing'].join('\n')
    )
  })

  it('has no Copy details action before a workspace is selected', () => {
    render(<WorkbenchWorkspaceSection />)
    expect(screen.getByText('Select a workspace from the workspace list.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
