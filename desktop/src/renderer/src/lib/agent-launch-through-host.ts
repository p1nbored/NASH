/**
 * A desktop launch started through the host's `agent.launch`, with no prompt.
 *
 * This window owns the workspace's tab layout, so it makes the agent's tab at the click, in the
 * split it was asked for, as any new agent tab is made. The host starts the agent into that tab's
 * pane and writes no launch record: nothing reads one for a click, and a record store that cannot
 * open must not stop it. The pane's spawn waits until the host has taken it
 * (`agent-launch-pane-spawn-hold`), then attaches to the agent. The prompt stays this window's to
 * paste, as main pastes it, once the agent has started.
 */

import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { persistAgentLaunchTabOrder } from '@/lib/launch-agent-tab-order'
import {
  holdAgentLaunchPaneSpawn,
  isAgentLaunchPaneSpawnHeld
} from '@/lib/agent-launch-pane-spawn-hold'
import { seedNativeChatAppliedSessionOptions } from '@/components/native-chat/native-chat-session-option-cache'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { isAgentLaunchResult } from '../../../shared/agent-launch-intent'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { isNativeChatEnabled } from '../../../shared/structured-native-chat-launch-route'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { Tab } from '../../../shared/tab-types'
import type { SessionOptionValue } from '../../../shared/native-chat-session-options'

export type HostAgentLaunchArgs = {
  agent: TuiAgent
  worktreeId: string
  /** The split the launch was made from; the tab joins it. */
  groupId?: string
  /** Kept by the window: a pane whose agent could not start offers to copy it. */
  prompt: string
  /** Absent uses the settings default; `null` means no arguments. */
  agentArgs?: string | null
  cwd?: string
  /** The launch's session options; only string values reach the host, which reads no others. */
  sessionOptions?: Record<string, SessionOptionValue>
  launchSource?: LaunchSource
  quickCommandLabel?: string | null
  /** The launch seeds a workspace being opened, so its spawn must not reshuffle Recent. */
  pendingActivationSpawn?: boolean
  /** The view the tab opens in, decided as for any new agent tab. */
  viewMode?: Tab['viewMode']
}

/** What became of the launch, as this window must tell it. */
export type HostAgentLaunchOutcome =
  /** The agent was started in this tab's pane, which is attached to it. */
  | { kind: 'started' }
  /** The user closed the tab while it started, and with it the launch: nothing more to say. */
  | { kind: 'closed-by-user' }
  /** The window says it: nothing started (its tab is gone), or the host took the pane and then
   *  failed, so whether its agent runs there is unknown. */
  | { kind: 'not-started'; unconfirmed: boolean; code?: string }

function tabExists(worktreeId: string, tabId: string): boolean {
  return (useAppStore.getState().tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)
}

function closeLaunchTab(worktreeId: string, tabId: string): void {
  if (tabExists(worktreeId, tabId)) {
    // Not the user's close, so not reopenable; its tombstone still stops an agent that starts late.
    useAppStore.getState().closeTab(tabId, {
      reason: 'cleanup',
      recordInteraction: false,
      captureRecentlyClosed: false
    })
  }
}

// Only a terminal in this pane is one the window can paste into.
function outcomeFromResult(result: unknown): HostAgentLaunchOutcome {
  return isAgentLaunchResult(result) && result.outcome.kind === 'terminal'
    ? { kind: 'started' }
    : { kind: 'not-started', unconfirmed: true }
}

function stringSessionOptions(options: Record<string, SessionOptionValue> | undefined): {
  sessionOptions?: Record<string, string>
} {
  const strings = Object.entries(options ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )
  return strings.length > 0 ? { sessionOptions: Object.fromEntries(strings) } : {}
}

function launchParams(args: HostAgentLaunchArgs) {
  return {
    agent: args.agent,
    target: { kind: 'existing', worktree: `id:${args.worktreeId}` },
    ...(args.agentArgs !== undefined ? { agentArgs: args.agentArgs } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...stringSessionOptions(args.sessionOptions),
    ...(args.launchSource ? { launchSource: args.launchSource } : {}),
    ...(args.groupId ? { placement: { groupId: args.groupId } } : {}),
    presentation: 'focused'
  }
}

async function settleLaunch(
  args: HostAgentLaunchArgs,
  pane: { tabId: string; leafId: string },
  send: Promise<unknown>,
  releaseHold: () => void
): Promise<HostAgentLaunchOutcome> {
  const closedByUser = (): boolean => !tabExists(args.worktreeId, pane.tabId)
  try {
    const result = await send
    // Closed while it started: the window stopped its agent as the tab's reveal arrived.
    return closedByUser() ? { kind: 'closed-by-user' } : outcomeFromResult(result)
  } catch (error) {
    if (closedByUser()) {
      return { kind: 'closed-by-user' }
    }
    const code = error instanceof RuntimeRpcCallError ? error.code : undefined
    // The host revealed the pane once its agent spawned; a pane it never took would open as a
    // shell, so its tab goes. A taken pane holds whatever runs there.
    const hostTookPane = !isAgentLaunchPaneSpawnHeld(pane.tabId, pane.leafId)
    if (!hostTookPane) {
      closeLaunchTab(args.worktreeId, pane.tabId)
    }
    return { kind: 'not-started', unconfirmed: hostTookPane, ...(code ? { code } : {}) }
  } finally {
    releaseHold()
    // The launch is over: its tab is an ordinary one, as a settled verdict leaves it.
    if (!closedByUser()) {
      useAppStore.getState().setTabAgentLaunchPane(pane.tabId, undefined)
    }
  }
}

/** Where the host could turn a launch into a chat (chat is the default), this window's paste has no
 *  terminal to go to, so such a launch keeps main's own path. */
export function windowMakesHostLaunchTab(): boolean {
  return !isNativeChatEnabled(useAppStore.getState().settings)
}

export function launchAgentThroughHost(args: HostAgentLaunchArgs): {
  tabId: string
  outcome: Promise<HostAgentLaunchOutcome>
} {
  const store = useAppStore.getState()
  const tabId = createBrowserUuid()
  const leafId = createBrowserUuid()
  // Before the tab exists, so its first mount already waits.
  const releaseHold = holdAgentLaunchPaneSpawn(tabId, leafId)
  const send = callRuntimeRpc<unknown>({ kind: 'local' }, 'agent.launch', {
    ...launchParams(args),
    // The pane is this click's.
    paneKey: makePaneKey(tabId, leafId)
  })
  store.createTab(args.worktreeId, args.groupId, undefined, {
    id: tabId,
    initialLeafId: leafId,
    agentLaunchPane: { leafId },
    launchAgent: args.agent,
    quickCommandLabel: args.quickCommandLabel,
    ...(args.pendingActivationSpawn ? { pendingActivationSpawn: true } : {}),
    ...(args.viewMode ? { viewMode: args.viewMode } : {})
  })
  seedNativeChatAppliedSessionOptions(tabId, args.agent, args.sessionOptions)
  // Why: without it an activated launch can stay hidden behind an editor.
  store.setActiveTabType('terminal', args.worktreeId)
  persistAgentLaunchTabOrder(args.worktreeId, tabId)
  return { tabId, outcome: settleLaunch(args, { tabId, leafId }, send, releaseHold) }
}
