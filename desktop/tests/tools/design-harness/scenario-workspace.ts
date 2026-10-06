import type { PreloadApi } from '../../../src/preload/api-types'
import type { Repo } from '../../../src/shared/repo-types'
import type {
  DetectedWorktree,
  DetectedWorktreeListResult,
  Worktree
} from '../../../src/shared/worktree/types'
import type { TerminalTab } from '../../../src/shared/terminal-tab-types'
import type { WorkspaceSessionState } from '../../../src/shared/workspace-session-state-types'
import { getDefaultWorkspaceSession } from '../../../src/shared/constants'
import type { RuntimeRpcResponse } from '../../../src/shared/runtime-rpc-envelope'
import { FEATURE_TIP_IDS } from '../../../src/shared/feature-tips'
import {
  SETTINGS_STORAGE_KEY,
  UI_STORAGE_KEY
} from '../../../src/renderer/src/web/preload-api/web-storage'
import { createWorkbenchFixture, readWorkbenchFixtureVariant } from './scenario-workbench'

// FIXTURE_ONLY workspace scenario shared by every design direction. Identical
// content keeps direction captures comparable; nothing here is live state.
const FIXTURE_EPOCH = Date.UTC(2026, 9, 3, 10, 40, 0)

const repos: Repo[] = [
  {
    id: 'fixture-repo-autopilot',
    path: 'C:/fixtures/autopilot',
    displayName: 'autopilot',
    badgeColor: '#a9472d',
    addedAt: FIXTURE_EPOCH,
    externalWorktreeVisibility: 'show'
  },
  {
    id: 'fixture-repo-field-notes',
    path: 'C:/fixtures/field-notes',
    displayName: 'field-notes',
    badgeColor: '#5f6f52',
    addedAt: FIXTURE_EPOCH,
    externalWorktreeVisibility: 'show'
  }
]

function worktree(repo: Repo, branch: string, overrides: Partial<Worktree> = {}): Worktree {
  const path = `${repo.path}/${branch.replaceAll('/', '-')}`
  return {
    id: `${repo.id}::${path}`,
    repoId: repo.id,
    path,
    head: '4f1c2a9d0b7e6c5a4f3e2d1c0b9a8f7e6d5c4b3a',
    branch,
    isBare: false,
    isMainWorktree: branch === 'main',
    displayName: branch,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: FIXTURE_EPOCH,
    createdAt: FIXTURE_EPOCH,
    ...overrides
  }
}

const worktreesByRepo: Record<string, Worktree[]> = {
  'fixture-repo-autopilot': [
    worktree(repos[0], 'feature/evidence-contracts', {
      comment: 'Fixture note: protected validation pending',
      isPinned: true,
      sortOrder: 0
    }),
    worktree(repos[0], 'fix/receipt-parser', { isUnread: true, sortOrder: 1 }),
    worktree(repos[0], 'main', { sortOrder: 2 })
  ],
  'fixture-repo-field-notes': [worktree(repos[1], 'main')]
}

export const ACTIVE_FIXTURE_WORKTREE_ID = worktreesByRepo['fixture-repo-autopilot'][0].id

function terminalTab(id: string, title: string, sortOrder: number): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId: ACTIVE_FIXTURE_WORKTREE_ID,
    title,
    customTitle: null,
    color: null,
    sortOrder,
    createdAt: FIXTURE_EPOCH
  }
}

// Why a harness session: the web client's own session API strips terminal tabs.
function createFixtureSession(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    activeRepoId: 'fixture-repo-autopilot',
    activeWorktreeId: ACTIVE_FIXTURE_WORKTREE_ID,
    activeTabId: 'fixture-tab-coordinator',
    tabsByWorktree: {
      [ACTIVE_FIXTURE_WORKTREE_ID]: [
        terminalTab('fixture-tab-coordinator', 'Coordinator (fixture)', 0),
        terminalTab('fixture-tab-tests', 'Tests (fixture)', 1)
      ]
    },
    activeTabTypeByWorktree: { [ACTIVE_FIXTURE_WORKTREE_ID]: 'terminal' }
  }
}

const ESC = '\u001b['
// Plain shell transcript with fixture labeling; no provider CLI is imitated.
const TERMINAL_SCRIPT = [
  `${ESC}2mFIXTURE_ONLY transcript - no process is running${ESC}0m`,
  `${ESC}32mPS C:\\fixtures\\autopilot>${ESC}0m git diff --stat`,
  // Why: git colors --stat bars on a TTY (green additions, red deletions).
  ` contracts/receipt.ts        | 18 ${ESC}32m+++++++++++++${ESC}m${ESC}31m-----${ESC}m`,
  ` tests/receipt.fixture.ts    | 12 ${ESC}32m++++++++++++${ESC}m`,
  ' 2 files changed, 25 insertions(+), 5 deletions(-)',
  `${ESC}32mPS C:\\fixtures\\autopilot>${ESC}0m pnpm test contracts/receipt`,
  ` ${ESC}32m✓${ESC}0m rejects completion claims without a receipt ${ESC}2m(4 ms)${ESC}0m`,
  ` ${ESC}32m✓${ESC}0m preserves original source bytes ${ESC}2m(2 ms)${ESC}0m`,
  ` ${ESC}33m!${ESC}0m protected validation pending - acceptance not recorded`,
  ' Source preserved: 用户请求：保留原始证据和中文路径。',
  `${ESC}32mPS C:\\fixtures\\autopilot>${ESC}0m `
].join('\r\n')

function detectedListing(repoId: string, providerRequestId?: string): unknown {
  const worktrees: DetectedWorktree[] = (worktreesByRepo[repoId] ?? []).map((row) => ({
    ...row,
    ownership: 'orca-managed',
    selectedCheckout: row.isMainWorktree,
    visible: true
  }))
  const result: DetectedWorktreeListResult = {
    repoId,
    authoritative: true,
    source: 'git',
    worktrees
  }
  if (!providerRequestId) {
    return result
  }
  return {
    status: 'complete',
    providerRequestId,
    repoId,
    authority: { kind: 'local', executionHostId: 'local' },
    result
  }
}

// Why only workbench RPCs: other runtime methods report unavailability truthfully.
function createFixtureRuntimeCall(): (args: {
  method: string
  params?: unknown
}) => Promise<RuntimeRpcResponse<unknown>> {
  const workbench = createWorkbenchFixture(
    ACTIVE_FIXTURE_WORKTREE_ID,
    readWorkbenchFixtureVariant(window.location.search)
  )
  return (args) => {
    const reply = workbench(args.method, args.params)
    if (reply?.ok) {
      return Promise.resolve({
        id: 'fixture-rpc',
        ok: true,
        result: reply.result,
        _meta: { runtimeId: 'fixture-runtime' }
      })
    }
    if (reply) {
      return Promise.resolve({
        id: 'fixture-rpc',
        ok: false,
        error: { code: reply.code, message: reply.message }
      })
    }
    return fixtureUnavailable(args.method)
  }
}

function fixtureUnavailable(method: string): Promise<RuntimeRpcResponse<unknown>> {
  return Promise.resolve({
    id: 'fixture-rpc',
    ok: false,
    error: {
      code: 'fixture_unavailable',
      message: `${method} is not available in the design harness`
    }
  })
}

type DataListener = Parameters<PreloadApi['pty']['onData']>[0]

function createScriptedPty(): Partial<PreloadApi['pty']> {
  const listeners = new Set<DataListener>()
  let spawned = 0
  return {
    spawn: async () => {
      spawned += 1
      const id = `fixture-pty-${spawned}`
      setTimeout(() => {
        for (const listener of listeners) {
          listener({ id, data: TERMINAL_SCRIPT })
        }
        const marker = window as { __harnessTerminalScripts?: number }
        marker.__harnessTerminalScripts = (marker.__harnessTerminalScripts ?? 0) + 1
      }, 400)
      return { id }
    },
    onData: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export function createWorkspaceScenarioFixtures(): Partial<PreloadApi> {
  return {
    repos: {
      list: () => Promise.resolve(repos)
    } as unknown as PreloadApi['repos'],
    worktrees: {
      list: ({ repoId }: { repoId: string }) => Promise.resolve(worktreesByRepo[repoId] ?? []),
      listDetected: (args: { repoId: string; providerRequestId?: string }) =>
        Promise.resolve(detectedListing(args.repoId, args.providerRequestId))
    } as unknown as PreloadApi['worktrees'],
    pty: createScriptedPty() as PreloadApi['pty'],
    runtime: {
      call: createFixtureRuntimeCall()
    } as unknown as PreloadApi['runtime'],
    hooks: {
      check: () =>
        Promise.resolve({
          status: 'ok',
          hasHooks: true,
          hooks: { scripts: { setup: 'pnpm install --frozen-lockfile' } },
          mayNeedUpdate: false
        }),
      inspectSetupScriptImports: () => Promise.resolve([])
    } as unknown as PreloadApi['hooks'],
    session: {
      get: () => Promise.resolve(createFixtureSession()),
      listHostIds: () => Promise.resolve(['local']),
      set: async () => {},
      patch: async () => {},
      setSync: () => {},
      flush: async () => {},
      closeTerminalSurface: async () => {},
      readTerminalScrollback: () => null
    } as unknown as PreloadApi['session']
  }
}

export type HarnessTheme = 'light' | 'dark'

export type HarnessTerminalColors = Record<string, string>

export type HarnessDirection = {
  id: string
  css: string
  appFontFamily: string
  terminal: { light: HarnessTerminalColors; dark: HarnessTerminalColors }
}

function terminalSettings(direction: HarnessDirection | null): Record<string, unknown> {
  if (!direction) {
    return {}
  }
  const theme = (mode: 'light' | 'dark') => ({
    id: `manual:${direction.id.toLowerCase()}-${mode}`,
    name: `${direction.id} ${mode} (exploration)`,
    source: 'manual',
    mode,
    terminal: direction.terminal[mode],
    importedAt: new Date(FIXTURE_EPOCH).toISOString()
  })
  // Why the manual: prefix: normalization scopes custom theme ids by source.
  return {
    appFontFamily: direction.appFontFamily,
    terminalCustomThemes: [theme('light'), theme('dark')],
    terminalThemeLight: `custom:manual:${direction.id.toLowerCase()}-light`,
    terminalThemeDark: `custom:manual:${direction.id.toLowerCase()}-dark`,
    terminalUseSeparateLightTheme: true
  }
}

// Why localStorage: the reused web settings/UI APIs read their state from it.
export function seedWorkspaceScenarioStorage(
  theme: HarnessTheme,
  direction: HarnessDirection | null = null
): void {
  window.localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      featureTipsSeenIds: FEATURE_TIP_IDS,
      rightSidebarOpen: true,
      rightSidebarTab: 'workbench'
    })
  )
  window.localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ theme, ...terminalSettings(direction) })
  )
}
