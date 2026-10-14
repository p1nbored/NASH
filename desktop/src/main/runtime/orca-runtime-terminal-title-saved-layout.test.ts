import './orca-runtime-test-lifecycle.spec'
import type { RuntimeStore } from './runtime-store-contract'
import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import { OrcaRuntimeService } from './orca-runtime-test-mocks.spec'
import {
  TEST_REPO_ID,
  TEST_WORKTREE_ID,
  makeRuntimeStoreWithWorkspaceSession
} from './orca-runtime-test-fixtures.spec'

function headlessRuntime() {
  const { runtimeStore, getSession } = makeRuntimeStoreWithWorkspaceSession({
    ...getDefaultWorkspaceSession(),
    activeRepoId: TEST_REPO_ID,
    activeWorktreeId: TEST_WORKTREE_ID
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The shared fixture supplies RuntimeStore methods; its legacy Mock return type loses callable signatures.
  const runtime = new OrcaRuntimeService(runtimeStore as RuntimeStore)
  runtime.setPtyController({
    spawn: vi.fn(async () => ({ id: 'titled-pty' })),
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null
  })
  return { runtime, getSession }
}

describe('a titled terminal on a host with no window', () => {
  it('saves the title as the tab name', async () => {
    const { runtime, getSession } = headlessRuntime()

    const created = await runtime.createTerminal(`id:${TEST_WORKTREE_ID}`, {
      title: 'cli-created'
    })

    const saved = getSession().tabsByWorktree[TEST_WORKTREE_ID]
    expect(saved?.find((tab) => tab.id === created.tabId)?.customTitle).toBe('cli-created')
  })

  // A window reads a saved name on hydration and shows it over the agent's live title, so a tab
  // the window never revealed (a background worker) must not get one.
  it('saves no name for a background terminal', async () => {
    const { runtime, getSession } = headlessRuntime()

    const created = await runtime.createTerminal(`id:${TEST_WORKTREE_ID}`, {
      title: 'worker-1',
      presentation: 'background'
    })

    const saved = getSession().tabsByWorktree[TEST_WORKTREE_ID]
    expect(saved?.find((tab) => tab.id === created.tabId)?.customTitle ?? null).toBeNull()
  })

  it('lists the saved name once the terminal itself has no title, as after a restart', async () => {
    const { runtime } = headlessRuntime()
    const created = await runtime.createTerminal(`id:${TEST_WORKTREE_ID}`, {
      title: 'cli-created'
    })
    // A restarted host rebuilds the terminal's record from the process list, without a title.
    const pty = runtime['ptysById'].get('titled-pty')!
    pty.title = null
    pty.titleUpdatedAt = null

    const listed = await runtime.listTerminals(`id:${TEST_WORKTREE_ID}`)

    expect(listed.terminals.find((terminal) => terminal.handle === created.handle)?.title).toBe(
      'cli-created'
    )
  })
})
