import { vi } from 'vitest'

/**
 * The store double `launchAgentInNewTab` reads, shared by the caller-behaviour suite.
 *
 * Kept beside the funnel rather than copied per file: the caller net spans several test files and
 * every one of them needs the same store surface, so a field the funnel starts reading is added
 * once here instead of drifting between copies.
 */
export type LaunchFunnelSettings = {
  agentCmdOverrides: Record<string, string>
  agentDefaultArgs: Record<string, string>
  agentDefaultEnv: Record<string, Record<string, string>>
  activeRuntimeEnvironmentId: string | null
  terminalWindowsShell?: string
  experimentalNativeChat?: boolean
  experimentalStructuredNativeChat?: boolean
  openAgentTabsInChatByDefault?: boolean
  nativeChatSessionOptions?: Record<
    string,
    { model?: string; valuesByModel?: Record<string, Record<string, string>> }
  >
}

export function launchFunnelSettings(
  overrides: Partial<LaunchFunnelSettings> = {}
): LaunchFunnelSettings {
  return {
    agentCmdOverrides: {},
    agentDefaultArgs: {},
    agentDefaultEnv: {},
    activeRuntimeEnvironmentId: null,
    ...overrides
  }
}

export function createLaunchFunnelStore(): {
  settings: LaunchFunnelSettings
  repos: { id: string; connectionId: string | null; path: string }[]
  allWorktrees: ReturnType<typeof vi.fn>
  tabsByWorktree: Record<string, { id: string }[]>
  openFiles: { id: string; worktreeId: string }[]
  browserTabsByWorktree: Record<string, { id: string }[]>
  tabBarOrderByWorktree: Record<string, string[]>
  createTab: ReturnType<typeof vi.fn>
  queueTabInitialCwd: ReturnType<typeof vi.fn>
  queueTabStartupCommand: ReturnType<typeof vi.fn>
  setActiveTabType: ReturnType<typeof vi.fn>
  setTabBarOrder: ReturnType<typeof vi.fn>
  setAgentStatus: ReturnType<typeof vi.fn>
  seedNativeChatLaunchPrompt: ReturnType<typeof vi.fn>
  seedNativeChatLaunchDraft: ReturnType<typeof vi.fn>
  markNativeChatLaunchPromptFailed: ReturnType<typeof vi.fn>
  setTabAgentLaunchPane: ReturnType<typeof vi.fn>
  closeTab: ReturnType<typeof vi.fn>
} {
  const store = {
    settings: launchFunnelSettings(),
    repos: [],
    allWorktrees: vi.fn(() => []),
    tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
    openFiles: [],
    browserTabsByWorktree: {},
    tabBarOrderByWorktree: {},
    createTab: vi.fn(),
    queueTabInitialCwd: vi.fn(),
    queueTabStartupCommand: vi.fn(),
    setActiveTabType: vi.fn(),
    setTabBarOrder: vi.fn(),
    setAgentStatus: vi.fn(),
    seedNativeChatLaunchPrompt: vi.fn(),
    seedNativeChatLaunchDraft: vi.fn(),
    markNativeChatLaunchPromptFailed: vi.fn(),
    setTabAgentLaunchPane: vi.fn(),
    closeTab: vi.fn()
  }
  store.createTab.mockImplementation(createTabInto(store))
  return store
}

/** A tab made with its own id joins the workspace, as the real store's does; launches read it back. */
function createTabInto(store: { tabsByWorktree: Record<string, { id: string }[]> }) {
  return (worktreeId: string, _groupId?: string, _x?: unknown, opts?: { id?: string }) => {
    if (!opts?.id) {
      return { id: 'tab-1' }
    }
    const tab = { id: opts.id }
    store.tabsByWorktree[worktreeId] = [...(store.tabsByWorktree[worktreeId] ?? []), tab]
    return tab
  }
}

export type LaunchFunnelStore = ReturnType<typeof createLaunchFunnelStore>

export function resetLaunchFunnelStore(
  store: LaunchFunnelStore,
  settingsOverrides: Partial<LaunchFunnelSettings> = {}
): void {
  store.settings = launchFunnelSettings(settingsOverrides)
  store.repos = []
  store.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
  store.openFiles = []
  store.browserTabsByWorktree = {}
  store.tabBarOrderByWorktree = {}
  store.createTab.mockImplementation(createTabInto(store))
}

/** The startup command `queueTabStartupCommand` received, or undefined when no tab was queued. */
export function queuedStartupCommand(store: LaunchFunnelStore): string | undefined {
  return store.queueTabStartupCommand.mock.calls[0]?.[1]?.command
}

/** The whole startup-command payload, for callers that assert more than the command string. */
export function queuedStartupPayload(
  store: LaunchFunnelStore
): Record<string, unknown> | undefined {
  return store.queueTabStartupCommand.mock.calls[0]?.[1]
}

/** The tab-creation options object (`createTab`'s 4th argument). */
export function createdTabOptions(store: LaunchFunnelStore): Record<string, unknown> | undefined {
  return store.createTab.mock.calls[0]?.[3]
}

/** The tab group `createTab` was asked to place the new tab in (its 2nd argument). */
export function createdTabGroupId(store: LaunchFunnelStore): string | undefined {
  return store.createTab.mock.calls[0]?.[1]
}

/** The `agent.launch` request a launch sent its host, or undefined when the window planned it. */
export function hostLaunchRequest(
  callRuntimeRpc: ReturnType<typeof vi.fn>
): Record<string, unknown> | undefined {
  return callRuntimeRpc.mock.calls.find(([, method]) => method === 'agent.launch')?.[2]
}
