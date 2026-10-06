// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { DotIngressSection } from './dot-ingress-section'
import {
  FIXTURE_DOT_REFS,
  FIXTURE_DOT_WORKSPACE_IDS,
  fixtureListeningDotSettings,
  fixtureMixedDotWorkspaces
} from './dot-ingress-settings.test-fixture'

const rpc = vi.hoisted(() =>
  vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
)

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const actual = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: actual.RuntimeRpcCallError }
})

const ENABLE = 'workbench.dotIngress.workspaces.enable'
const DISABLE = 'workbench.dotIngress.workspaces.disable'
const initialStore = useAppStore.getState()

function answer(byMethod: Record<string, unknown>): void {
  rpc.mockImplementation(async (_target, method) => {
    const value = byMethod[method]
    if (value === undefined) {
      throw new Error(`unexpected method ${method}`)
    }
    if (value instanceof RuntimeRpcCallError) {
      throw value
    }
    return value
  })
}

function callsTo(method: string): unknown[] {
  return rpc.mock.calls.filter((call) => call[1] === method).map((call) => call[2])
}

function worktree(path: string, branch: string): Worktree {
  return {
    id: `fixture-repo-autopilot::${path}`,
    repoId: 'fixture-repo-autopilot',
    path,
    head: '0'.repeat(40),
    branch,
    isBare: false,
    isMainWorktree: false,
    displayName: branch,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    createdAt: 0
  }
}

function seedStore(): void {
  const repo: Repo = {
    id: 'fixture-repo-autopilot',
    path: 'C:/fixtures/autopilot',
    displayName: 'autopilot',
    badgeColor: '#000000',
    addedAt: 0
  }
  useAppStore.setState({
    repos: [repo],
    worktreesByRepo: {
      'fixture-repo-autopilot': [
        worktree('C:/fixtures/autopilot/feature-evidence-contracts', 'feature/evidence-contracts'),
        worktree('C:/fixtures/autopilot/dev', 'dev')
      ]
    },
    folderWorkspaces: []
  })
}

async function renderSection(): Promise<HTMLElement> {
  render(<DotIngressSection />)
  await act(async () => {})
  const shell = screen
    .getByText('Workspaces for dot', { selector: 'p' })
    .closest('[data-settings-section]')
  if (!(shell instanceof HTMLElement)) {
    throw new Error('workspaces card is missing')
  }
  return shell
}

function row(shell: HTMLElement, label: string): HTMLElement {
  return within(shell).getByRole('listitem', { name: label })
}

const mixed = (): ReturnType<typeof fixtureListeningDotSettings> =>
  fixtureListeningDotSettings({ workspaces: fixtureMixedDotWorkspaces() })

describe('DotIngressSection workspaces', () => {
  beforeEach(() => {
    rpc.mockReset()
    seedStore()
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialStore, true)
  })

  it('says dot cannot start a task while no workspace is enabled', async () => {
    answer({ 'workbench.dotIngress.settings.get': fixtureListeningDotSettings({ workspaces: [] }) })
    const shell = await renderSection()

    expect(within(shell).getByText('None enabled')).toBeTruthy()
    expect(shell.textContent).toMatch(/dot cannot start any task/)
  })

  it('lists each workspace with its maximum access, and turned-off ones as off', async () => {
    answer({ 'workbench.dotIngress.settings.get': mixed() })
    const shell = await renderSection()

    expect(within(shell).getByText('2 enabled')).toBeTruthy()
    const readOnly = row(shell, 'autopilot: feature-evidence-contracts')
    expect(
      within(readOnly).getByRole('radio', { name: 'Read only' }).getAttribute('aria-checked')
    ).toBe('true')
    const write = row(shell, 'autopilot: fix-receipt-parser')
    expect(
      within(write).getByRole('radio', { name: 'Workspace write' }).getAttribute('aria-checked')
    ).toBe('true')
    const off = row(shell, 'field-notes: main')
    expect(within(off).queryAllByRole('radio')).toHaveLength(0)
    expect(within(off).getByText('Off')).toBeTruthy()
    expect(shell.textContent).toMatch(/start at read only/)
  })

  it('asks once, stating what workspace write allows, before raising the access', async () => {
    answer({ 'workbench.dotIngress.settings.get': mixed(), [ENABLE]: mixed() })
    const shell = await renderSection()

    fireEvent.click(
      within(row(shell, 'autopilot: feature-evidence-contracts')).getByRole('radio', {
        name: 'Workspace write'
      })
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(
      /Allow workspace write for autopilot: feature-evidence-contracts\?/
    )
    expect(dialog.textContent).toMatch(/file edits allowed/)
    expect(dialog.textContent).toMatch(/approve command prompts/)
    expect(callsTo(ENABLE)).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(callsTo(ENABLE)).toHaveLength(0)
  })

  it('treats Escape as cancel and keeps the workspace at read only', async () => {
    answer({ 'workbench.dotIngress.settings.get': mixed(), [ENABLE]: mixed() })
    const shell = await renderSection()
    const target = (): HTMLElement => row(shell, 'autopilot: feature-evidence-contracts')

    fireEvent.click(within(target()).getByRole('radio', { name: 'Workspace write' }))
    const dialog = screen.getByRole('dialog')
    // Why hidden: the open modal hides the page behind it from the accessibility tree.
    const behind = within(shell).getByRole('listitem', {
      name: 'autopilot: feature-evidence-contracts',
      hidden: true
    })
    expect(
      within(behind)
        .getByRole('radio', { name: 'Read only', hidden: true })
        .getAttribute('aria-checked')
    ).toBe('true')
    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' })
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(callsTo(ENABLE)).toHaveLength(0)
    expect(
      within(target()).getByRole('radio', { name: 'Read only' }).getAttribute('aria-checked')
    ).toBe('true')
  })

  it('shows a refused raise in plain English', async () => {
    answer({
      'workbench.dotIngress.settings.get': mixed(),
      [ENABLE]: new RuntimeRpcCallError({
        id: 't',
        ok: false,
        error: { code: 'workbench_workspace_unavailable', message: 'raw unavailable' }
      })
    })
    const shell = await renderSection()

    fireEvent.click(
      within(row(shell, 'autopilot: feature-evidence-contracts')).getByRole('radio', {
        name: 'Workspace write'
      })
    )
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Allow workspace write' })
      )
    })

    expect(within(shell).getByRole('alert').textContent).toMatch(/could not confirm this workspace/)
    expect(callsTo(ENABLE)).toHaveLength(1)
  })

  it('raises the access only after the confirmation', async () => {
    answer({ 'workbench.dotIngress.settings.get': mixed(), [ENABLE]: mixed() })
    const shell = await renderSection()

    fireEvent.click(
      within(row(shell, 'autopilot: feature-evidence-contracts')).getByRole('radio', {
        name: 'Workspace write'
      })
    )
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Allow workspace write' })
      )
    })

    expect(callsTo(ENABLE)).toEqual([
      {
        workspaceId: FIXTURE_DOT_WORKSPACE_IDS.evidence,
        label: 'autopilot: feature-evidence-contracts',
        maxAccess: 'workspace_write'
      }
    ])
  })

  it('lowers the access to read only without a confirmation', async () => {
    answer({ 'workbench.dotIngress.settings.get': mixed(), [ENABLE]: mixed() })
    const shell = await renderSection()

    await act(async () => {
      fireEvent.click(
        within(row(shell, 'autopilot: fix-receipt-parser')).getByRole('radio', {
          name: 'Read only'
        })
      )
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(callsTo(ENABLE)).toEqual([
      {
        workspaceId: FIXTURE_DOT_WORKSPACE_IDS.receipt,
        label: 'autopilot: fix-receipt-parser',
        maxAccess: 'read_only'
      }
    ])
  })

  it('turns a workspace off by its reference', async () => {
    answer({ 'workbench.dotIngress.settings.get': mixed(), [DISABLE]: mixed() })
    const shell = await renderSection()

    await act(async () => {
      fireEvent.click(
        within(shell).getByRole('switch', { name: 'Enable autopilot: fix-receipt-parser for dot' })
      )
    })

    expect(callsTo(DISABLE)).toEqual([{ workspaceRef: FIXTURE_DOT_REFS.receipt }])
  })

  it('turns a workspace that had workspace write back on at read only', async () => {
    const off = fixtureMixedDotWorkspaces().find((entry) => !entry.enabled)
    expect(off?.maxAccess).toBe('workspace_write')
    answer({ 'workbench.dotIngress.settings.get': mixed(), [ENABLE]: mixed() })
    const shell = await renderSection()

    await act(async () => {
      fireEvent.click(
        within(shell).getByRole('switch', { name: 'Enable field-notes: main for dot' })
      )
    })

    expect(callsTo(ENABLE)).toEqual([
      {
        workspaceId: FIXTURE_DOT_WORKSPACE_IDS.notes,
        label: 'field-notes: main',
        maxAccess: 'read_only'
      }
    ])
  })

  it('adds a local workspace that is not listed yet, at read only', async () => {
    answer({
      'workbench.dotIngress.settings.get': fixtureListeningDotSettings(),
      [ENABLE]: mixed()
    })
    const shell = await renderSection()

    fireEvent.click(within(shell).getByRole('combobox', { name: 'Workspace to enable for dot' }))
    expect(screen.queryByText('autopilot: feature-evidence-contracts ·')).toBeNull()
    fireEvent.click(screen.getByText('autopilot: dev ·'))
    await act(async () => {
      fireEvent.click(within(shell).getByRole('button', { name: 'Enable for dot' }))
    })

    expect(callsTo(ENABLE)).toEqual([
      {
        workspaceId: 'fixture-repo-autopilot::C:/fixtures/autopilot/dev',
        label: 'autopilot: dev',
        maxAccess: 'read_only'
      }
    ])
  })

  it('shows a refused workspace change in plain English', async () => {
    answer({
      'workbench.dotIngress.settings.get': mixed(),
      [ENABLE]: new RuntimeRpcCallError({
        id: 't',
        ok: false,
        error: { code: 'unsupported_host', message: 'raw unsupported_host' }
      })
    })
    const shell = await renderSection()

    await act(async () => {
      fireEvent.click(
        within(shell).getByRole('switch', { name: 'Enable field-notes: main for dot' })
      )
    })

    const alert = within(shell).getByRole('alert')
    expect(alert.textContent).toMatch(/Only local workspaces on this computer/)
    expect(alert.textContent).not.toContain('raw')
  })
})
